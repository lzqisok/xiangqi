import assert from 'node:assert/strict'
import test from 'node:test'
import type { MatchEntity } from '../repositories/contracts.js'
import { calculateRating, isRatedMatchEligible, ratingPolicy, ratingPool } from './rating.js'

function match(overrides: Partial<MatchEntity> = {}): MatchEntity {
  const now = new Date('2026-08-28T00:00:00.000Z')
  return {
    id: '00000000-0000-4000-8000-000000000001',
    variant: 'xiangqi',
    gomokuRule: null,
    matchmaking: true,
    competitionMode: 'rated',
    clockPreset: '10m',
    visibility: 'public',
    phase: 'finished',
    status: 'red-wins',
    statusReason: 'checkmate',
    revision: 8,
    previousMatchId: null,
    createdByUserId: null,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    finishedAt: now,
    expiresAt: new Date(now.getTime() + 86_400_000),
    ...overrides,
  }
}

test('rating pools keep variants and Gomoku rules isolated', () => {
  assert.equal(ratingPool('xiangqi', null), 'xiangqi')
  assert.equal(ratingPool('jieqi', null), 'jieqi')
  assert.equal(ratingPool('gomoku', 'freestyle'), 'gomoku-freestyle')
  assert.equal(ratingPool('gomoku', 'renju'), 'gomoku-renju')
})

test('only normal timed rated matchmaking conclusions are eligible', () => {
  assert.equal(isRatedMatchEligible(match()), true)
  assert.equal(isRatedMatchEligible(match({ status: 'playing' })), false)
  assert.equal(isRatedMatchEligible(match({ competitionMode: 'casual' })), false)
  assert.equal(isRatedMatchEligible(match({ matchmaking: false })), false)
  assert.equal(isRatedMatchEligible(match({ clockPreset: 'none' })), false)
  assert.equal(isRatedMatchEligible(match({ statusReason: 'disconnect' })), false)
  assert.equal(isRatedMatchEligible(match({ statusReason: 'abandoned' })), false)
})

test('Elo calculation is zero-sum and uses a shared provisional K factor', () => {
  const provisional = calculateRating({
    redRating: ratingPolicy.initialRating,
    blackRating: ratingPolicy.initialRating,
    redGames: 0,
    blackGames: 0,
    status: 'red-wins',
  })
  assert.deepEqual(provisional, {
    redAfter: 1520,
    blackAfter: 1480,
    redDelta: 20,
    blackDelta: -20,
    kFactor: 40,
  })
  const established = calculateRating({
    redRating: 1600,
    blackRating: 1400,
    redGames: 12,
    blackGames: 20,
    status: 'draw',
  })
  assert.equal(established.kFactor, 24)
  assert.equal(established.redDelta + established.blackDelta, 0)
  assert.ok(established.redDelta < 0)
})
