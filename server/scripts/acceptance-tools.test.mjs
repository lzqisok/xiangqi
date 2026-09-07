import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'

async function run(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/staging-read-load.mjs'], {
      env: { ...process.env, ...env },
      cwd: new URL('..', import.meta.url),
    })
    let output = ''
    child.stdout.on('data', (d) => (output += d))
    child.stderr.resume()
    child.on('error', reject)
    child.on('exit', (code) => resolve({ code, output }))
  })
}
test('read load fails 401,403,429, semantic anonymous and malformed bodies; valid reads pass', async () => {
  let status = 200,
    body = {}
  const server = createServer((req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(
      body === 'valid'
        ? JSON.stringify(
            req.url === '/api/auth/session'
              ? { authenticated: true, user: { id: 'isolated' } }
              : { matches: [] },
          )
        : JSON.stringify(body),
    )
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const env = {
    STAGING_ORIGIN: `http://127.0.0.1:${server.address().port}`,
    ALLOW_HTTP_STAGING: '1',
    STAGING_SESSION_COOKIE: 'isolated=test',
    LOAD_CONCURRENCY: '1',
    LOAD_ROUNDS: '3',
    LOAD_P95_TARGET_MS: '60000',
  }
  try {
    for (const value of [401, 403, 429, 200]) {
      status = value
      body = { authenticated: false }
      const result = await run(env)
      assert.equal(result.code, 1)
      assert.equal(JSON.parse(result.output).ok, false)
    }
    status = 200
    body = 'valid'
    const result = await run(env)
    assert.equal(result.code, 0)
    assert.equal(JSON.parse(result.output).ok, true)
    assert.equal((await run({ ...env, LOAD_CONCURRENCY: 'NaN' })).code, 1)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('business load exercises login, concurrent matching, spectator chat, moves, history and logout', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { WebSocketServer } = await import('ws')
  const dir = await mkdtemp(join(tmpdir(), 'xiangqi-load-'))
  const accounts = join(dir, 'accounts.json')
  await writeFile(
    accounts,
    JSON.stringify([1, 2, 3].map((i) => ({ email: `p${i}@example.test`, password: 'fixture' }))),
  )
  const id = '00000000-0000-4000-8000-000000000001'
  let revision = 1,
    phase = 'playing',
    turn = 'red',
    moves = 0,
    chat = 0,
    logouts = 0,
    joins = 0
  const snapshot = (user) => ({
    id,
    revision,
    phase,
    turn,
    side: user === 'p1' ? 'red' : user === 'p2' ? 'black' : null,
  })
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = raw ? JSON.parse(raw) : {}
    const user = req.headers.cookie?.match(/session=(p\d)/)?.[1]
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/api/auth/login') {
      const user = body.email.split('@')[0]
      res.setHeader('Set-Cookie', `session=${user}; Path=/`)
      res.end(JSON.stringify({ user: { id: user }, csrfToken: 'fixture' }))
      return
    }
    if (!user) {
      res.writeHead(401)
      res.end('{}')
      return
    }
    if (req.method === 'POST') assert.equal(req.headers['x-csrf-token'], 'fixture')
    if (req.url === '/api/online/quick-match') {
      assert.ok(body.requestKey)
      joins++
      res.statusCode = joins === 1 ? 201 : 200
      res.end(JSON.stringify({ match: snapshot(user) }))
      return
    }
    if (req.url === `/api/online/matches/${id}`) {
      res.end(JSON.stringify({ match: snapshot(user) }))
      return
    }
    if (req.url.startsWith('/api/me/matches')) {
      res.end(JSON.stringify({ matches: phase === 'finished' ? [{ id }] : [] }))
      return
    }
    if (req.url === '/api/auth/logout') {
      logouts++
      res.writeHead(204)
      res.end()
      return
    }
    res.writeHead(404)
    res.end('{}')
  })
  const wss = new WebSocketServer({ server, path: '/ws' })
  const clients = []
  wss.on('connection', (ws, req) => {
    const user = req.headers.cookie.match(/session=(p\d)/)[1]
    clients.push({ ws, user })
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString())
      if (m.type === 'match-subscribe') {
        ws.send(JSON.stringify({ type: 'match-snapshot', match: snapshot(user) }))
        return
      }
      assert.equal(m.matchId, id)
      assert.equal(m.expectedRevision, revision)
      if (m.type === 'match-chat-send') {
        chat++
        clients.forEach((c) =>
          c.ws.send(
            JSON.stringify({ type: 'match-chat-message', message: { content: m.content } }),
          ),
        )
        return
      }
      if (m.type === 'match-move') {
        assert.equal(snapshot(user).side, turn)
        moves++
        turn = turn === 'red' ? 'black' : 'red'
      } else if (m.type === 'match-resign') phase = 'finished'
      else assert.fail(`unexpected command ${m.type}`)
      revision++
      clients.forEach((c) =>
        c.ws.send(JSON.stringify({ type: 'match-snapshot', match: snapshot(c.user) })),
      )
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/staging-business-load.mjs'], {
        cwd: new URL('..', import.meta.url),
        env: {
          ...process.env,
          STAGING_ORIGIN: `http://127.0.0.1:${server.address().port}`,
          ALLOW_HTTP_STAGING: '1',
          ALLOW_STAGING_BUSINESS_LOAD: '1',
          STAGING_ACCOUNTS_FILE: accounts,
          LOAD_PAIRS: '1',
          LOAD_ROUNDS: '1',
          LOAD_P95_TARGET_MS: '60000',
        },
      })
      let output = ''
      child.stdout.on('data', (d) => (output += d))
      child.stderr.on('data', (d) => (output += d))
      child.on('error', reject)
      child.on('exit', (code) => resolve({ code, output }))
    })
    assert.equal(result.code, 0, result.output)
    assert.deepEqual({ moves, chat, logouts, joins }, { moves: 4, chat: 1, logouts: 3, joins: 2 })
    phase = 'playing'
    revision = 1
    turn = 'red'
    clients.length = 0
    const hookFile = join(dir, 'hooks.json')
    await writeFile(
      hookFile,
      JSON.stringify(
        Object.fromEntries(
          ['database-outage', 'slow-query', 'pool-pressure', 'application-restart'].map((name) => [
            name,
            {
              apply: [process.execPath, '-e', 'process.exit(7)'],
              verify: [process.execPath, '-e', 'process.exit(0)'],
              recover: [process.execPath, '-e', 'process.exit(0)'],
            },
          ]),
        ),
      ),
    )
    const faultExit = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/staging-faults.mjs'], {
        cwd: new URL('..', import.meta.url),
        env: {
          ...process.env,
          STAGING_ORIGIN: `http://127.0.0.1:${server.address().port}`,
          ALLOW_HTTP_STAGING: '1',
          ALLOW_STAGING_BUSINESS_LOAD: '1',
          STAGING_ACCOUNTS_FILE: accounts,
          STAGING_FAULT_HOOKS_FILE: hookFile,
          LOAD_P95_TARGET_MS: '60000',
        },
      })
      child.stdout.resume()
      child.stderr.resume()
      child.on('error', reject)
      child.on('exit', resolve)
    })
    assert.equal(faultExit, 1, 'A failed fault adapter must block acceptance')
  } finally {
    wss.clients.forEach((ws) => ws.terminate())
    await new Promise((resolve) => wss.close(resolve))
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await rm(dir, { recursive: true })
  }
})

test('isolated fault proxy injects outage, delay and held handshakes, then recovers', async () => {
  const net = await import('node:net')
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'xiangqi-proxy-')),
    config = join(dir, 'config'),
    stats = join(dir, 'stats')
  await writeFile(config, JSON.stringify({ mode: 'normal', generation: 'initial' }))
  const upstream = net.createServer((socket) => {
    socket.on('error', () => {})
    socket.write('greeting')
    socket.on('data', (data) => socket.write(data))
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const reservation = net.createServer()
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve))
  const port = reservation.address().port
  await new Promise((resolve) => reservation.close(resolve))
  const proxy = spawn(process.execPath, ['scripts/staging-fault-proxy.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      ALLOW_STAGING_BUSINESS_LOAD: '1',
      FAULT_PROXY_CONFIG: config,
      FAULT_PROXY_STATS: stats,
      FAULT_PROXY_PORT: String(port),
      FAULT_MYSQL_PORT: String(upstream.address().port),
    },
  })
  proxy.stdout.resume()
  proxy.stderr.resume()
  const exited = new Promise((resolve) => proxy.once('exit', resolve))
  async function wait(predicate) {
    const end = Date.now() + 10000
    while (Date.now() < end) {
      try {
        if (predicate(JSON.parse(await readFile(stats, 'utf8')))) return
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.fail('Proxy telemetry timeout')
  }
  const sockets = []
  function connect() {
    const socket = net.connect({ host: '127.0.0.1', port })
    sockets.push(socket)
    socket.on('error', () => {})
    return socket
  }
  async function mode(value) {
    await writeFile(config, JSON.stringify({ mode: value, generation: value }))
    await wait((s) => s.mode === value)
  }
  try {
    await wait((s) => s.mode === 'normal')
    const normal = connect()
    assert.equal(
      await new Promise((resolve) => normal.once('data', (d) => resolve(d.toString()))),
      'greeting',
    )
    normal.destroy()
    await mode('database-outage')
    const down = connect()
    await new Promise((resolve) => down.once('close', resolve))
    await wait((s) => s.affected > 0)
    await mode('slow-query')
    const slow = connect()
    let delivered = false
    slow.on('data', () => (delivered = true))
    await wait((s) => s.affected > 0)
    assert.equal(delivered, false)
    slow.destroy()
    await mode('pool-pressure')
    const pressure = connect()
    let greeting = false
    pressure.on('data', () => (greeting = true))
    await wait((s) => s.affected > 0)
    assert.equal(greeting, false)
    pressure.destroy()
    await mode('normal')
    const recovered = connect()
    assert.equal(
      await new Promise((resolve) => recovered.once('data', (d) => resolve(d.toString()))),
      'greeting',
    )
  } finally {
    sockets.forEach((socket) => socket.destroy())
    proxy.kill('SIGTERM')
    await exited
    await new Promise((resolve) => upstream.close(resolve))
    await rm(dir, { recursive: true })
  }
})

test('application restart adapter stops its owned process and recovers with a new PID', async () => {
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'xiangqi-supervisor-'))
  const config = join(dir, 'config'),
    stats = join(dir, 'stats'),
    command = join(dir, 'command')
  await writeFile(config, JSON.stringify({ mode: 'normal', generation: 'initial' }))
  await writeFile(command, JSON.stringify([process.execPath, '-e', 'setInterval(()=>{},1000)']))
  const env = {
    ...process.env,
    ALLOW_STAGING_BUSINESS_LOAD: '1',
    FAULT_APP_CONFIG: config,
    FAULT_APP_STATS: stats,
    FAULT_APP_COMMAND_FILE: command,
  }
  const supervisor = spawn(process.execPath, ['scripts/staging-app-supervisor.mjs'], {
    cwd: new URL('..', import.meta.url),
    env,
  })
  supervisor.stdout.resume()
  supervisor.stderr.resume()
  const exited = new Promise((resolve) => supervisor.once('exit', resolve))
  async function state() {
    const end = Date.now() + 10000
    while (Date.now() < end) {
      try {
        return JSON.parse(await readFile(stats, 'utf8'))
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.fail('No supervisor state')
  }
  async function control(phase) {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['scripts/staging-proxy-control.mjs', phase, 'application-restart'],
        { cwd: new URL('..', import.meta.url), env },
      )
      child.stdout.resume()
      child.stderr.resume()
      child.on('error', reject)
      child.on('exit', resolve)
    })
    assert.equal(code, 0)
  }
  try {
    const original = (await state()).pid
    assert.ok(original)
    await control('apply')
    await control('verify')
    assert.equal((await state()).pid, null)
    assert.throws(() => process.kill(original, 0))
    await control('recover')
    const next = (await state()).pid
    assert.ok(next)
    assert.notEqual(next, original)
  } finally {
    supervisor.kill('SIGTERM')
    await exited
    await rm(dir, { recursive: true })
  }
})
