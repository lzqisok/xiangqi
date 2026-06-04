import assert from 'node:assert/strict'
import test from 'node:test'
import { formatTrainingHintHistory, recordTrainingHintLevel } from './hints'

test('recordTrainingHintLevel records each move and level once', () => {
  const first = recordTrainingHintLevel([], 2, 1, '方向提示：下一手重点关注红方车的主动走法。')
  const duplicate = recordTrainingHintLevel(first, 2, 1, '方向提示：下一手重点关注红方车的主动走法。')
  const nextLevel = recordTrainingHintLevel(duplicate, 2, 2, '棋子提示：建议动子是车。')

  assert.deepEqual(nextLevel, [
    { moveIndex: 2, level: 1, text: '方向提示：下一手重点关注红方车的主动走法。' },
    { moveIndex: 2, level: 2, text: '棋子提示：建议动子是车。' },
  ])
})

test('recordTrainingHintLevel replaces same move index hints from abandoned branches', () => {
  const first = recordTrainingHintLevel([], 2, 1, '方向提示：原分支。', 'fen-a')
  const branched = recordTrainingHintLevel(first, 2, 1, '方向提示：新分支。', 'fen-b')
  const duplicate = recordTrainingHintLevel(branched, 2, 1, '方向提示：新分支。', 'fen-b')

  assert.deepEqual(duplicate, [
    { moveIndex: 2, level: 1, text: '方向提示：新分支。', positionKey: 'fen-b' },
  ])
})

test('formatTrainingHintHistory keeps recent entries readable', () => {
  const text = formatTrainingHintHistory([
    { moveIndex: -1, level: 1, text: '方向提示：开局提示。' },
    { moveIndex: 0, level: 2, text: '棋子提示：建议动子是车。' },
  ])

  assert.equal(text, '提示记录：开局 L1 方向提示：开局提示。 / 第 1 手 L2 棋子提示：建议动子是车。')
})
