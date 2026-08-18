import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeGameReview } from './review'
import { BLACK, WHITE, type Move } from '../core/types'

test('Gomoku review reports progress for every replayed move', () => {
  const moveHistory: Move[] = [
    { row: 7, col: 7, player: BLACK },
    { row: 6, col: 7, player: WHITE },
    { row: 7, col: 8, player: BLACK },
    { row: 6, col: 8, player: WHITE },
  ]
  const progress: Array<[number, number]> = []

  const report = analyzeGameReview(
    { moveHistory, forbiddenEnabled: true, difficulty: 'medium' },
    (completed, total) => progress.push([completed, total]),
  )

  assert.equal(report.steps.length, moveHistory.length)
  assert.deepEqual(progress, [
    [1, 4],
    [2, 4],
    [3, 4],
    [4, 4],
  ])
  assert.ok(report.steps.every((step) => step.suggestions.length <= 3))
  assert.deepEqual(moveHistory[0], { row: 7, col: 7, player: BLACK })
})
