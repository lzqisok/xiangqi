import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ActiveMatchQuotaError,
  MatchmakingQueueFullError,
  type MySqlOnlineMatchRepository,
} from './repository.js'
import { OnlineMatchService } from './service.js'
import type { OnlineMatchRecord } from './types.js'
import { readOnlineRefereeState } from './state.js'

const layout = (() => {
  const pieces = [...'rraabbnnccppppprraabbnnccppppp']
  const forcePawn = (target: number, start: number, end: number) => {
    const source = pieces.findIndex(
      (type, index) => type === 'p' && index >= start && index < end && index !== target,
    )
    ;[pieces[target], pieces[source]] = [pieces[source], pieces[target]]
  }
  forcePawn(15, 15, 30)
  forcePawn(11, 0, 15)
  return pieces.join('')
})()
const moves: OnlineMatchRecord['state']['moves'] = [
  { uci: 'a3a4', color: 'red' },
  { uci: 'c6c5', color: 'black' },
  { uci: 'a4a5', color: 'red' },
  { uci: 'c5c4', color: 'black' },
  { uci: 'a5a6', color: 'red' },
  { uci: 'c4c3', color: 'black' },
]

function record(): OnlineMatchRecord {
  const now = new Date('2026-08-25T00:00:00.000Z')
  return {
    match: {
      id: '00000000-0000-4000-8000-000000000010',
      variant: 'jieqi',
      gomokuRule: null,
      matchmaking: false,
      competitionMode: 'casual',
      clockPreset: 'none',
      visibility: 'public',
      phase: 'finished',
      status: 'draw',
      statusReason: 'agreement',
      revision: 8,
      previousMatchId: null,
      createdByUserId: 'owner-user',
      createdAt: now,
      updatedAt: new Date(now.getTime() + 2_000),
      startedAt: new Date(now.getTime() + 500),
      finishedAt: new Date(now.getTime() + 1_500),
      expiresAt: new Date(now.getTime() + 86_400_000),
    },
    participants: [
      {
        id: 'owner-participant',
        userId: 'owner-user',
        side: null,
        isOwner: true,
        displayNameSnapshot: '未落座房主',
        ready: false,
        hintsUsed: 0,
        joinedAt: now,
        disconnectedAt: null,
        disconnectDeadline: null,
      },
      {
        id: 'red-participant',
        userId: 'red-user',
        side: 'red',
        isOwner: false,
        displayNameSnapshot: '红方棋手',
        ready: true,
        hintsUsed: 0,
        joinedAt: now,
        disconnectedAt: null,
        disconnectDeadline: null,
      },
      {
        id: 'black-participant',
        userId: 'black-user',
        side: 'black',
        isOwner: false,
        displayNameSnapshot: '黑方棋手',
        ready: true,
        hintsUsed: 0,
        joinedAt: now,
        disconnectedAt: null,
        disconnectDeadline: null,
      },
    ],
    state: readOnlineRefereeState(
      { schemaVersion: 1, name: '公网揭棋隐私测试', initialLayout: layout, moves },
      'jieqi',
    ),
    proposal: null,
  }
}

test('Jieqi online snapshots derive red, black, spectator and unseated-owner projections', () => {
  const service = new OnlineMatchService({} as MySqlOnlineMatchRepository)
  const source = record()
  const online = new Set(['red-user', 'black-user'])
  const red = service.snapshot(source, 'red-user', online)
  const black = service.snapshot(source, 'black-user', online)
  const spectator = service.snapshot(source, 'spectator-user', online)
  const owner = service.snapshot(source, 'owner-user', online)

  assert.ok(red.moves[4].captured)
  assert.equal(black.moves[4].captured, null)
  assert.equal(spectator.moves[4].captured, null)
  assert.equal(owner.moves[4].captured, null)
  assert.ok(black.moves[5].captured)
  assert.equal(red.moves[5].captured, null)
  assert.equal(red.jieqiRecord?.audience, 'red')
  assert.equal(black.jieqiRecord?.audience, 'black')
  assert.equal(spectator.jieqiRecord?.audience, 'public')
  assert.equal(owner.jieqiRecord?.audience, 'public')
  for (const snapshot of [red, black, spectator, owner]) {
    const serialized = JSON.stringify(snapshot)
    assert.equal(serialized.includes(layout), false)
    assert.equal(serialized.includes('referee_state'), false)
  }
})

test('active match quota becomes a stable retryable online error', async () => {
  const service = new OnlineMatchService({} as MySqlOnlineMatchRepository)
  await assert.rejects(
    service.safe(() => Promise.reject(new ActiveMatchQuotaError())),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'active_match_quota_exceeded' &&
      'retryAfterSeconds' in error &&
      error.retryAfterSeconds === 30,
  )
})

test('matchmaking partition capacity becomes a stable retryable online error', async () => {
  const service = new OnlineMatchService({} as MySqlOnlineMatchRepository)
  await assert.rejects(
    service.safe(() => Promise.reject(new MatchmakingQueueFullError())),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'matchmaking_queue_full' &&
      'retryAfterSeconds' in error &&
      error.retryAfterSeconds === 30,
  )
})
