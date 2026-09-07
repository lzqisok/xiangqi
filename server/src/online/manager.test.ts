import assert from 'node:assert/strict'
import test from 'node:test'
import type { WebSocket } from 'ws'
import type { UserActor } from '../auth/types.js'
import type { OnlineMatchRecord } from './types.js'
import { OnlineMatchManager } from './manager.js'
import type { OnlineMatchService } from './service.js'

class FakeSocket {
  readonly OPEN = 1
  readyState = this.OPEN
  readonly sent: string[] = []
  readonly closes: Array<{ code?: number; reason?: string }> = []

  send(value: string) {
    this.sent.push(value)
  }

  close(code?: number, reason?: string) {
    this.readyState = 3
    this.closes.push({ code, reason })
  }
}

function actor(userId: string): UserActor {
  return {
    kind: 'user',
    requestId: 'request',
    ipKey: 'ip',
    userId,
    sessionId: `session-${userId}`,
    authEpoch: 1,
    expiresAt: new Date(Date.now() + 60_000),
    status: 'active',
    capabilities: ['online:play', 'online:watch'],
  }
}

function record(id: string, userIds = ['red-user', 'black-user']): OnlineMatchRecord {
  const now = new Date()
  return {
    match: {
      id,
      variant: 'xiangqi',
      gomokuRule: null,
      matchmaking: false,
      competitionMode: 'casual',
      clockPreset: 'none',
      visibility: 'public',
      phase: 'playing',
      status: 'playing',
      statusReason: null,
      revision: 1,
      previousMatchId: null,
      createdByUserId: userIds[0],
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      finishedAt: null,
      expiresAt: new Date(now.getTime() + 86_400_000),
    },
    participants: userIds.map((userId, index) => ({
      id: `participant-${id}-${index}`,
      userId,
      side: index === 0 ? ('red' as const) : ('black' as const),
      isOwner: index === 0,
      displayNameSnapshot: `棋手${index + 1}`,
      ready: true,
      hintsUsed: 0,
      joinedAt: now,
      disconnectedAt: null,
      disconnectDeadline: null,
    })),
    state: { schemaVersion: 1, name: '连接恢复测试', moves: [] },
    proposal: null,
  }
}

function fakeService(records: OnlineMatchRecord[]) {
  const presence: Array<{
    matchId: string
    userId: string
    connected: boolean
    deadline?: Date
  }> = []
  const byId = new Map(records.map((item) => [item.match.id, item]))
  const clockAdjudications: Array<{ matchId: string; deadlineAt: string }> = []
  const repository = {
    recoverActiveMatches: async () => records,
    setPresence: async (matchId: string, userId: string, connected: boolean, deadline?: Date) => {
      presence.push({ matchId, userId, connected, deadline })
      return true
    },
    adjudicateDisconnect: async () => null,
    adjudicateClock: async (matchId: string, deadlineAt: string) => {
      clockAdjudications.push({ matchId, deadlineAt })
      const current = byId.get(matchId)
      if (!current) return null
      current.match.phase = 'finished'
      current.match.status = 'black-wins'
      current.match.statusReason = 'timeout'
      current.state.clock = current.state.clock
        ? { ...current.state.clock, redRemainingMs: 0, activeSide: null, deadlineAt: null }
        : undefined
      return current
    },
  }
  const service = {
    repository,
    safe: async <T>(action: () => Promise<T>) => action(),
    get: async (_actor: UserActor, matchId: string) => byId.get(matchId)!,
    chatHistory: async () => [],
    snapshot: (item: OnlineMatchRecord, userId: string) => ({ id: item.match.id, userId }),
  } as unknown as OnlineMatchService
  return { service, presence, clockAdjudications }
}

test('a newer account connection takes over the seat and the stale socket cannot mark it offline', async () => {
  const source = record('00000000-0000-4000-8000-000000000101')
  const { service, presence } = fakeService([source])
  const manager = new OnlineMatchManager(service, 60_000)
  const first = new FakeSocket()
  const second = new FakeSocket()
  const currentActor = actor('red-user')

  manager.bind(first as unknown as WebSocket, currentActor)
  await manager.handle(first as unknown as WebSocket, {
    type: 'match-subscribe',
    matchId: source.match.id,
  })
  manager.bind(second as unknown as WebSocket, {
    ...currentActor,
    sessionId: 'session-new-device',
  })
  await manager.handle(second as unknown as WebSocket, {
    type: 'match-subscribe',
    matchId: source.match.id,
  })

  assert.equal(first.closes[0]?.code, 4001)
  manager.disconnect(first as unknown as WebSocket)
  assert.equal(presence.filter((item) => !item.connected).length, 0)
  manager.disconnect(second as unknown as WebSocket)
  await eventually(() => presence.some((item) => !item.connected))
  assert.equal(presence.filter((item) => !item.connected).length, 1)
  manager.dispose()
})

test('restart recovery gives every offline player one shared, bounded disconnect deadline', async () => {
  const source = record('00000000-0000-4000-8000-000000000102')
  const { service, presence } = fakeService([source])
  const manager = new OnlineMatchManager(service, 60_000)

  await manager.restore()

  const offline = presence.filter((item) => !item.connected)
  assert.equal(offline.length, 2)
  assert.equal(offline[0].deadline?.getTime(), offline[1].deadline?.getTime())
  assert.ok((offline[0].deadline?.getTime() ?? 0) > Date.now())
  manager.dispose()
})

test('resubscribing one socket moves account presence between public matches', async () => {
  const firstRecord = record('00000000-0000-4000-8000-000000000103')
  const secondRecord = record('00000000-0000-4000-8000-000000000104')
  const { service, presence } = fakeService([firstRecord, secondRecord])
  const manager = new OnlineMatchManager(service, 60_000)
  const socket = new FakeSocket()
  manager.bind(socket as unknown as WebSocket, actor('red-user'))

  await manager.handle(socket as unknown as WebSocket, {
    type: 'match-subscribe',
    matchId: firstRecord.match.id,
  })
  await manager.handle(socket as unknown as WebSocket, {
    type: 'match-subscribe',
    matchId: secondRecord.match.id,
  })

  assert.equal(
    presence.some((item) => item.matchId === firstRecord.match.id && !item.connected),
    true,
  )
  assert.equal(
    presence.some((item) => item.matchId === secondRecord.match.id && item.connected),
    true,
  )
  manager.dispose()
})

test('spectator quota rejects excess subscriptions with a retryable stable error', async () => {
  const source = record('00000000-0000-4000-8000-000000000105')
  const { service } = fakeService([source])
  const manager = new OnlineMatchManager(service, 60_000, 1)
  const first = new FakeSocket()
  const second = new FakeSocket()
  manager.bind(first as unknown as WebSocket, actor('spectator-one'))
  manager.bind(second as unknown as WebSocket, actor('spectator-two'))

  await manager.handle(first as unknown as WebSocket, {
    type: 'match-subscribe',
    matchId: source.match.id,
  })
  await assert.rejects(
    manager.handle(second as unknown as WebSocket, {
      type: 'match-subscribe',
      matchId: source.match.id,
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'spectator_quota_exceeded' &&
      'retryAfterSeconds' in error &&
      error.retryAfterSeconds === 30,
  )
  manager.dispose()
})

test('restart recovery reschedules a persisted deadline and adjudicates timeout once', async () => {
  const source = record('00000000-0000-4000-8000-000000000106')
  const deadlineAt = new Date(Date.now() + 10).toISOString()
  source.match.clockPreset = '10m'
  source.state.clock = {
    preset: '10m',
    redRemainingMs: 10,
    blackRemainingMs: 600_000,
    incrementMs: 0,
    delayMs: 0,
    activeSide: 'red',
    deadlineAt,
  }
  const { service, clockAdjudications } = fakeService([source])
  const manager = new OnlineMatchManager(service, 60_000)

  await manager.restore()
  await new Promise((resolve) => setTimeout(resolve, 30))

  assert.deepEqual(clockAdjudications, [{ matchId: source.match.id, deadlineAt }])
  assert.equal(source.match.statusReason, 'timeout')
  manager.dispose()
})

async function eventually(check: () => boolean) {
  const end = Date.now() + 1000
  while (!check() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 5))
  assert.ok(check(), 'background recovery did not complete')
}

function expiredClock(source: OnlineMatchRecord) {
  source.match.clockPreset = '10m'
  source.state.clock = {
    preset: '10m',
    redRemainingMs: 0,
    blackRemainingMs: 600000,
    incrementMs: 0,
    delayMs: 0,
    activeSide: 'red',
    deadlineAt: new Date(Date.now() - 100).toISOString(),
  }
}

test('deadline database outage retries and completes without client requests exactly once', async () => {
  const source = record('outage')
  expiredClock(source)
  const { service, clockAdjudications } = fakeService([source])
  const commit = service.repository.adjudicateClock.bind(service.repository)
  let attempts = 0
  service.repository.adjudicateClock = async (...args) => {
    if (++attempts <= 2) throw new Error('database unavailable')
    if (source.match.phase === 'finished') return null
    return commit(...args)
  }
  const manager = new OnlineMatchManager(service, 60000, 50, 2, 20, 5)
  try {
    await manager.restore()
    await eventually(() => source.match.phase === 'finished')
    await manager.restore()
    assert.equal(clockAdjudications.length, 1)
    assert.ok(attempts >= 3)
  } finally {
    manager.dispose()
  }
})

test('startup database failure is retried and expired disconnect is recovered without requests', async () => {
  const source = record('restart-outage')
  source.participants.forEach((p) => (p.disconnectDeadline = new Date(Date.now() - 100)))
  const { service } = fakeService([source])
  let reads = 0,
    finishes = 0
  service.repository.recoverActiveMatches = async () => {
    if (++reads < 3) throw new Error('offline')
    return source.match.phase === 'playing' ? [source] : []
  }
  service.repository.adjudicateDisconnect = async () => {
    if (source.match.phase !== 'playing') return null
    source.match.phase = 'finished'
    finishes++
    return source
  }
  const manager = new OnlineMatchManager(service, 60000, 50, 2, 20, 5)
  try {
    await manager.restore()
    await eventually(() => finishes === 1)
    assert.ok(reads >= 3)
  } finally {
    manager.dispose()
  }
})

test('failed offline persistence retries with the original deadline', async () => {
  const source = record('presence-outage'),
    { service } = fakeService([source])
  const deadlines: number[] = []
  let attempts = 0
  service.repository.setPresence = async (_id, _user, connected, deadline) => {
    if (connected) return true
    deadlines.push(deadline!.getTime())
    if (++attempts === 1) throw new Error('offline')
    return true
  }
  const manager = new OnlineMatchManager(service, 60000, 50, 2, 10000, 5)
  const socket = new FakeSocket() as unknown as WebSocket
  try {
    manager.bind(socket, actor('red-user'))
    await manager.handle(socket, { type: 'match-subscribe', matchId: source.match.id })
    manager.disconnect(socket)
    await eventually(() => attempts === 2)
    assert.equal(deadlines[0], deadlines[1])
  } finally {
    manager.dispose()
  }
})

test('reconnect waits for an in-flight offline write and cancels its retry', async () => {
  const source = record('presence-race'),
    { service } = fakeService([source])
  let release!: () => void
  const blocked = new Promise<void>((resolve) => (release = resolve))
  const writes: boolean[] = []
  service.repository.setPresence = async (_id, _user, connected) => {
    if (!connected) await blocked
    writes.push(connected)
    return true
  }
  const manager = new OnlineMatchManager(service, 60000, 50, 2, 10000, 5)
  const first = new FakeSocket() as unknown as WebSocket,
    second = new FakeSocket() as unknown as WebSocket
  try {
    manager.bind(first, actor('red-user'))
    await manager.handle(first, { type: 'match-subscribe', matchId: source.match.id })
    manager.disconnect(first)
    await new Promise((resolve) => setImmediate(resolve))
    manager.bind(second, actor('red-user'))
    const reconnect = manager.handle(second, { type: 'match-subscribe', matchId: source.match.id })
    release()
    await reconnect
    assert.deepEqual(writes, [true, false, true])
  } finally {
    release()
    manager.dispose()
  }
})

test('old timeout retry cannot replace a move with a new deadline', async () => {
  const source = record('move-race')
  expiredClock(source)
  const { service } = fakeService([source])
  const old = source.state.clock!.deadlineAt
  let calls = 0,
    finishes = 0
  service.repository.adjudicateClock = async (_id, deadline) => {
    calls++
    if (calls === 1) {
      source.state.clock!.deadlineAt = new Date(Date.now() + 60000).toISOString()
      throw new Error('concurrent move committed')
    }
    if (deadline !== source.state.clock!.deadlineAt) return null
    finishes++
    return source
  }
  const manager = new OnlineMatchManager(service, 60000, 50, 2, 10000, 5)
  try {
    await manager.restore()
    await eventually(() => calls >= 2)
    assert.notEqual(source.state.clock!.deadlineAt, old)
    assert.equal(finishes, 0)
  } finally {
    manager.dispose()
  }
})

test('a reconnected socket is not adjudicated by its old deadline while online persistence retries', async () => {
  const source = record('reconnect-db-outage')
  source.participants[0].disconnectDeadline = new Date(Date.now() - 1)
  const { service } = fakeService([source])
  let connectedWrites = 0,
    adjudications = 0
  service.repository.setPresence = async (_id, _user, connected) => {
    if (connected && ++connectedWrites === 1)
      throw new Error('transient online persistence failure')
    return true
  }
  service.repository.adjudicateDisconnect = async () => {
    adjudications++
    throw new Error('database unavailable at disconnect deadline')
  }
  const manager = new OnlineMatchManager(service, 60000, 50, 2, 10000, 50)
  const socket = new FakeSocket() as unknown as WebSocket
  try {
    await manager.restore()
    await eventually(() => adjudications === 1)
    manager.bind(socket, actor('red-user'))
    await manager.handle(socket, { type: 'match-subscribe', matchId: source.match.id })
    await eventually(() => connectedWrites === 2)
    assert.equal(adjudications, 1)
  } finally {
    manager.dispose()
  }
})
