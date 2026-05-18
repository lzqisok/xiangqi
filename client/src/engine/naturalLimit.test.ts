import assert from 'node:assert/strict'
import test from 'node:test'
import { countQuietPlies, getNaturalLimitReminder } from './naturalLimit'
import { MoveRecord } from '../types'

const QUIET_MOVE: MoveRecord = {
  move: {
    from: { row: 9, col: 0 },
    to: { row: 8, col: 0 },
    piece: { type: 'r', color: 'red' },
  },
  notation: '车一进一',
  fen: 'fen',
}

const CAPTURE_MOVE: MoveRecord = {
  move: {
    from: { row: 0, col: 0 },
    to: { row: 1, col: 0 },
    piece: { type: 'r', color: 'black' },
    captured: { type: 'p', color: 'red' },
  },
  notation: '车一进一',
  fen: 'fen',
}

test('countQuietPlies counts only moves after the latest capture', () => {
  assert.equal(countQuietPlies([QUIET_MOVE, QUIET_MOVE]), 2)
  assert.equal(countQuietPlies([QUIET_MOVE, CAPTURE_MOVE, QUIET_MOVE, QUIET_MOVE]), 2)
  assert.equal(countQuietPlies([QUIET_MOVE, CAPTURE_MOVE]), 0)
})

test('getNaturalLimitReminder only reminds after the configured threshold', () => {
  assert.equal(getNaturalLimitReminder([QUIET_MOVE, QUIET_MOVE], 3), '')
  assert.equal(
    getNaturalLimitReminder([QUIET_MOVE, QUIET_MOVE, QUIET_MOVE], 3),
    '已连续 3 手未吃子，注意自然限着风险。',
  )
})
