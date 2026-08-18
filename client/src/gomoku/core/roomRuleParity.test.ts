import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyGomokuBoard, isGomokuForbiddenMove } from '../../../../server/src/rooms/gomokuCore'
import { RENJU_REGRESSION_CASES } from './rules.renju-cases'
import { BLACK, WHITE } from './types'

test('authoritative Gomoku room rules match every local Renju regression shape', () => {
  for (const item of RENJU_REGRESSION_CASES) {
    const board = emptyGomokuBoard()
    for (const move of item.moves)
      board[move.row][move.col] = move.player === BLACK ? 'red' : 'black'
    const actual =
      item.config.forbiddenEnabled && item.lastMove.player === BLACK
        ? isGomokuForbiddenMove(board, item.lastMove.row, item.lastMove.col)
        : false
    assert.equal(actual, item.expectForbidden, item.name)
    if (item.lastMove.player === WHITE)
      assert.equal(actual, false, `${item.name} should not restrict white`)
  }
})
