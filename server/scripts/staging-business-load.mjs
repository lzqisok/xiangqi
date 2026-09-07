import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import WebSocket from 'ws'
import { integer, stagingBase, LoadReport, request } from './load-support.mjs'

export async function businessLoad(onPlaying) {
  if (process.env.ALLOW_STAGING_BUSINESS_LOAD !== '1')
    throw new Error('Explicit isolated staging opt-in required')
  const base = stagingBase(),
    report = new LoadReport(),
    sockets = []
  const accounts = JSON.parse(await readFile(process.env.STAGING_ACCOUNTS_FILE, 'utf8'))
  const pairs = integer('LOAD_PAIRS', 5, 25),
    rounds = integer('LOAD_ROUNDS', 2, 100)
  assert.ok(accounts.length >= pairs * 3, 'Need three distinct isolated verified accounts per pair')
  assert.equal(
    new Set(accounts.map((a) => a.email)).size,
    accounts.length,
    'Accounts must be distinct',
  )
  let failed = false
  const sessions = []
  try {
    for (const account of accounts.slice(0, pairs * 3)) {
      const { data, response } = await request(base, report, '/api/auth/login', {
        method: 'POST',
        body: {
          email: account.email,
          password: account.password,
          deviceLabel: 'isolated-business-load',
        },
      })
      assert.ok(data.user?.id && data.csrfToken)
      const cookie = response.headers
        .getSetCookie()
        .map((c) => c.split(';', 1)[0])
        .join('; ')
      assert.ok(cookie)
      sessions.push({ cookie, csrf: data.csrfToken, userId: data.user.id })
    }
    const http = async (session, path, options = {}) =>
      (await request(base, report, path, { ...session, ...options })).data
    async function connect(session, id) {
      const url = new URL('/ws', base)
      url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(url, { headers: { Cookie: session.cookie, Origin: base.origin } })
      sockets.push(ws)
      const messages = []
      ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())))
      ws.on('error', () => {})
      const wait = async (predicate) => {
        const end = Date.now() + 10000
        while (Date.now() < end) {
          const error = messages.find((m) => m.type === 'error' || m.type === 'match-error')
          if (error) throw new Error('WebSocket command rejected')
          const found = messages.find(predicate)
          if (found) return found
          if (ws.readyState === WebSocket.CLOSED) throw new Error('WebSocket closed')
          await new Promise((r) => setTimeout(r, 10))
        }
        throw new Error('WebSocket response timeout')
      }
      await report.measure('ws-connect', async () => {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('WebSocket open timeout')), 10000)
          ws.once('open', () => {
            clearTimeout(timer)
            resolve()
          })
          ws.once('error', (e) => {
            clearTimeout(timer)
            reject(e)
          })
        })
      })
      ws.send(JSON.stringify({ type: 'match-subscribe', matchId: id }))
      await report.measure('ws-subscribe', () =>
        wait((m) => m.type === 'match-snapshot' && m.match.id === id),
      )
      return { ws, wait }
    }
    for (let round = 0; round < rounds; round++) {
      const players = sessions.slice(0, pairs * 2)
      const joined = await Promise.all(
        players.map(async (session) => ({
          session,
          match: (
            await http(session, '/api/online/quick-match', {
              method: 'POST',
              expected: [200, 201],
              body: {
                requestKey: randomUUID(),
                variant: 'gomoku',
                gomokuRule: 'freestyle',
                competitionMode: 'casual',
                clockPreset: 'none',
                name: '隔离负载验收',
              },
            })
          ).match,
        })),
      )
      const groups = new Map()
      for (const item of joined) {
        assert.ok(item.match?.id)
        const group = groups.get(item.match.id) ?? []
        group.push(item.session)
        groups.set(item.match.id, group)
      }
      assert.equal(groups.size, pairs, 'Unexpected matchmaking pairs (use an empty isolated queue)')
      const results = await Promise.allSettled(
        [...groups].map(async ([id, participants], index) => {
          assert.equal(participants.length, 2)
          const observer = sessions[pairs * 2 + index]
          let links = await Promise.all([...participants, observer].map((s) => connect(s, id)))
          const read = async (s) => (await http(s, `/api/online/matches/${id}`)).match
          const command = async (i, type, extra = {}) => {
            const current = await read(participants[i])
            const commandId = randomUUID()
            await report.measure(type, async () => {
              links[i].ws.send(
                JSON.stringify({
                  type,
                  matchId: id,
                  commandId,
                  expectedRevision: current.revision,
                  ...extra,
                }),
              )
              if (type === 'match-chat-send')
                await links[2].wait(
                  (m) => m.type === 'match-chat-message' && m.message?.content === extra.content,
                )
              else
                await links[i].wait(
                  (m) =>
                    m.type === 'match-snapshot' &&
                    m.match.id === id &&
                    m.match.revision > current.revision,
                )
            })
          }
          const active = await read(participants[0])
          assert.equal(active.phase, 'playing')
          await command(0, 'match-chat-send', { content: `负载验收 ${randomUUID()}` })
          for (let ply = 0; ply < 4; ply++) {
            const current = await read(participants[0])
            const i = current.side === current.turn ? 0 : 1
            await command(i, 'match-move', { row: 7, col: ply + 4 })
          }
          if (onPlaying) {
            // Hook owns disruption and recovery. No HTTP/WS command is sent while it runs.
            links.forEach((l) => l.ws.terminate())
            await onPlaying({ id, index, read: () => read(participants[0]) })
            const finished = await read(participants[0])
            assert.equal(finished.phase, 'finished')
            const stable = await read(participants[0])
            assert.equal(stable.revision, finished.revision)
          } else {
            await command(0, 'match-resign')
            assert.equal((await read(participants[0])).phase, 'finished')
          }
          for (const s of participants) {
            const history = await http(s, '/api/me/matches?limit=20')
            assert.ok(
              history.matches.some((m) => m.id === id),
              'Finished match missing from history',
            )
          }
          links.forEach((l) => l.ws.close())
        }),
      )
      if (results.some((result) => result.status === 'rejected'))
        throw new Error('Business flow failed')
    }
  } catch {
    failed = true
    console.error('Business load assertion failed; inspect staging logs using request IDs')
  } finally {
    sockets.forEach((s) => s.terminate())
    for (const s of sessions) {
      try {
        await request(base, report, '/api/auth/logout', { ...s, method: 'POST', expected: [204] })
      } catch {
        failed = true
      }
    }
  }
  return report.finish(
    {
      kind: 'business',
      pairs,
      rounds,
      accounts: pairs * 3,
      ...(process.env.LOAD_FAULT_SCENARIO
        ? {
            scenario: process.env.LOAD_FAULT_SCENARIO,
            disconnectGraceMs: Number(process.env.FAULT_DISCONNECT_GRACE_MS || 60000),
            recoveryWaitMs: Number(process.env.FAULT_RECOVERY_WAIT_MS || 65000),
          }
        : {}),
    },
    failed,
  )
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await businessLoad()
