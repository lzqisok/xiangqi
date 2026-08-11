import assert from 'node:assert/strict'
import test from 'node:test'
import { INITIAL_FEN } from '../engine/board'
import { PersistedGameState } from '../types'
import { createVariationTree } from '../variations/tree'
import { retainNewestPendingState } from './useGamePersistence'

function stateAt(index: number): PersistedGameState {
  return {
    initialFen: INITIAL_FEN,
    historyRecords: [],
    currentMoveIndex: index,
    variationTree: createVariationTree(INITIAL_FEN, [], -1),
    gameStatus: 'playing',
  }
}

test('a failed save retains a newer snapshot queued while the request was in flight', () => {
  const failed = stateAt(-1)
  const newer = stateAt(0)
  assert.equal(retainNewestPendingState(newer, failed), newer)
})

test('a failed save remains retryable when no newer snapshot exists', () => {
  const failed = stateAt(-1)
  assert.equal(retainNewestPendingState(null, failed), failed)
})
