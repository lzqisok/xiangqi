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
  const repository = {
    recoverActiveMatches: async () => records,
    setPresence: async (
      matchId: string,
      userId: string,
      connected: boolean,
      deadline?: Date,
    ) => {
      presence.push({ matchId, userId, connected, deadline })
      return true
    },
    adjudicateDisconnect: async () => null,
  }
  const service = {
    repository,
    safe: async <T>(action: () => Promise<T>) => action(),
    get: async (_actor: UserActor, matchId: string) => byId.get(matchId)!,
    chatHistory: async () => [],
    snapshot: (item: OnlineMatchRecord, userId: string) => ({ id: item.match.id, userId }),
  } as unknown as OnlineMatchService
  return { service, presence }
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
