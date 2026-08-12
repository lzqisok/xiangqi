import assert from 'node:assert/strict'
import test from 'node:test'
import { getDifficultyForTurn, shouldRequestAiMove } from './aiMatchFlow'
import { BLACK, WHITE } from './types'

test('AI match moves only when autoplay or a manual step requests it', () => {
  assert.equal(shouldRequestAiMove('ai-vs-ai', BLACK, WHITE, false), false)
  assert.equal(shouldRequestAiMove('ai-vs-ai', BLACK, WHITE, true), true)
  assert.equal(shouldRequestAiMove('ai-vs-ai', WHITE, WHITE, false, true), true)
  assert.equal(shouldRequestAiMove('ai', WHITE, WHITE, false), true)
  assert.equal(shouldRequestAiMove('ai', BLACK, WHITE, true), false)
})

test('AI match selects difficulty independently for black and white', () => {
  assert.equal(getDifficultyForTurn('ai-vs-ai', BLACK, 'medium', 'master', 'easy'), 'master')
  assert.equal(getDifficultyForTurn('ai-vs-ai', WHITE, 'medium', 'master', 'easy'), 'easy')
  assert.equal(getDifficultyForTurn('ai', WHITE, 'medium', 'hard', 'easy'), 'medium')
})
