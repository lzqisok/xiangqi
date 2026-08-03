import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyMoveLoss } from './moveReview.js'
import { buildMoveReviews } from './moveReview.js'
import { INITIAL_FEN } from '../engine/board.js'
import { buildMoveRecordsFromUci } from '../share/replayLink.js'
import { ReviewPosition } from '../types.js'

test('classifyMoveLoss follows review thresholds', () => {
  assert.equal(classifyMoveLoss(0, true), 'best')
  assert.equal(classifyMoveLoss(30), 'good')
  assert.equal(classifyMoveLoss(31), 'inaccuracy')
  assert.equal(classifyMoveLoss(99), 'inaccuracy')
  assert.equal(classifyMoveLoss(100), 'mistake')
  assert.equal(classifyMoveLoss(249), 'mistake')
  assert.equal(classifyMoveLoss(250), 'blunder')
})

test('an engine best move is best even when score noise is present', () => {
  assert.equal(classifyMoveLoss(45, true), 'best')
})

test('buildMoveReviews computes loss from each movers perspective', () => {
  const records = buildMoveRecordsFromUci(INITIAL_FEN, ['h2e2', 'h7e7'])
  const positions: ReviewPosition[] = [
    { moveIndex: -1, evaluation: 20, depth: 12, bestMove: 'h2e2', pv: ['h2e2'] },
    { moveIndex: 0, evaluation: -30, depth: 12, bestMove: 'b7e7', pv: ['b7e7'] },
    { moveIndex: 1, evaluation: 40, depth: 12, bestMove: 'b0c2', pv: ['b0c2'] },
  ]

  const reviews = buildMoveReviews(INITIAL_FEN, records, positions)
  assert.equal(reviews[0].mover, 'red')
  assert.equal(reviews[0].loss, 50)
  assert.equal(reviews[0].category, 'best')
  assert.equal(reviews[0].recommendedNotation, '炮二平五')
  assert.equal(reviews[1].mover, 'black')
  assert.equal(reviews[1].loss, 70)
  assert.equal(reviews[1].category, 'inaccuracy')
})
