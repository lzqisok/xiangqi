import assert from 'node:assert/strict'
import test from 'node:test'
import { BLACK, WHITE } from './types'
import { getUndoStepCount } from './gameFlow'

test('local Gomoku undo removes one move', () => {
  assert.equal(getUndoStepCount(3, 'pvp', BLACK), 1)
  assert.equal(getUndoStepCount(3, 'ai-vs-ai', BLACK), 1)
})

test('AI undo returns to the human turn after either side moved last', () => {
  assert.equal(getUndoStepCount(8, 'ai', BLACK), 2, 'undo the AI reply and the preceding human move')
  assert.equal(getUndoStepCount(9, 'ai', BLACK), 1, 'undo only the human winning move')
  assert.equal(getUndoStepCount(3, 'ai', WHITE), 2, 'undo the AI reply and the preceding human move')
  assert.equal(getUndoStepCount(2, 'ai', WHITE), 1, 'undo only the human winning move')
})

test('AI opening move cannot be undone when the human plays white', () => {
  assert.equal(getUndoStepCount(1, 'ai', WHITE), 0)
})
