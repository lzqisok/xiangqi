import assert from 'node:assert/strict'
import test from 'node:test'
import { getCurrentRepetitionCount, getRepetitionKey, getRepetitionReminder } from './repetition'
import { MoveRecord } from '../types'

const INITIAL_FEN = '9/9/9/9/9/9/9/9/4K4/4k4 w - - 0 1'
const SAME_POSITION_LATER = '9/9/9/9/9/9/9/9/4K4/4k4 w - - 8 5'
const DIFFERENT_TURN = '9/9/9/9/9/9/9/9/4K4/4k4 b - - 8 5'

function record(fen: string): MoveRecord {
  return {
    move: {
      from: { row: 0, col: 0 },
      to: { row: 0, col: 1 },
      piece: { color: 'red', type: 'r' },
    },
    notation: '测试',
    fen,
  }
}

test('getRepetitionKey uses board layout and side to move only', () => {
  assert.equal(getRepetitionKey(INITIAL_FEN), getRepetitionKey(SAME_POSITION_LATER))
  assert.notEqual(getRepetitionKey(INITIAL_FEN), getRepetitionKey(DIFFERENT_TURN))
})

test('getCurrentRepetitionCount counts current position occurrences', () => {
  assert.equal(getCurrentRepetitionCount(INITIAL_FEN, []), 1)
  assert.equal(getCurrentRepetitionCount(INITIAL_FEN, [record(DIFFERENT_TURN)]), 1)
  assert.equal(getCurrentRepetitionCount(INITIAL_FEN, [record(DIFFERENT_TURN), record(SAME_POSITION_LATER)]), 2)
})

test('getRepetitionReminder reports only repeated current positions', () => {
  assert.equal(getRepetitionReminder(INITIAL_FEN, []), '')
  assert.equal(
    getRepetitionReminder(INITIAL_FEN, [record(DIFFERENT_TURN), record(SAME_POSITION_LATER)]),
    '当前局面已第 2 次出现，注意可能进入重复局面。',
  )
})
