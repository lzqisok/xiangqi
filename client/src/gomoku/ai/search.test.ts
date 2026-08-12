import assert from 'node:assert/strict'
import test from 'node:test'
import { applyMove, createEmptyBoard } from '../core/board'
import { BLACK, WHITE } from '../core/types'
import { evaluatePositionForTurn, findBestMoveScored } from './search'

test('Negamax evaluation is symmetric for the side to move', () => {
  let board = createEmptyBoard()
  board = applyMove(board, { row: 7, col: 7, player: BLACK })
  board = applyMove(board, { row: 6, col: 6, player: WHITE })
  board = applyMove(board, { row: 7, col: 8, player: BLACK })

  const blackScore = evaluatePositionForTurn(board, BLACK)
  const whiteScore = evaluatePositionForTurn(board, WHITE)
  assert.equal(blackScore, -whiteScore)
  assert.ok(blackScore > 0)
})

test('browser AI search keeps its input board immutable', () => {
  let board = createEmptyBoard()
  board = applyMove(board, { row: 7, col: 7, player: BLACK })
  board = applyMove(board, { row: 7, col: 8, player: WHITE })
  board = applyMove(board, { row: 8, col: 7, player: BLACK })
  board = applyMove(board, { row: 6, col: 7, player: WHITE })
  const before = board.slice()

  const result = findBestMoveScored(board, BLACK, BLACK, false, 'easy')

  assert.ok(result.move)
  assert.deepEqual(board, before)
})
