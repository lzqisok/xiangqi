import assert from 'node:assert/strict'
import test from 'node:test'
import { INITIAL_FEN } from './board'
import { AUTOMATIC_DRAW_MAX_PLIES, AUTOMATIC_DRAW_QUIET_PLIES, getAutomaticDrawReason } from './drawRules'
import { MoveRecord } from '../types'

function record(fen: string, captured = false): MoveRecord {
  return {
    move: {
      from: { row: 6, col: 0 },
      to: { row: 5, col: 0 },
      piece: { type: 'p', color: 'red' },
      captured: captured ? { type: 'p', color: 'black' } : undefined,
    },
    notation: '兵九进一',
    fen,
  }
}

test('three occurrences of the same position are adjudicated as a draw', () => {
  assert.equal(getAutomaticDrawReason(INITIAL_FEN, [record(INITIAL_FEN), record(INITIAL_FEN)]), 'repetition')
})

test('120 quiet plies are adjudicated as a natural-limit draw', () => {
  const records = Array.from({ length: AUTOMATIC_DRAW_QUIET_PLIES }, (_, index) => record(`position-${index} ${index % 2 ? 'w' : 'b'}`))
  assert.equal(getAutomaticDrawReason(INITIAL_FEN, records), 'natural-limit')
})

test('the hard move limit stops exceptionally long games without an engine request', () => {
  const records = Array.from({ length: AUTOMATIC_DRAW_MAX_PLIES }, (_, index) => record(`position-${index} ${index % 2 ? 'w' : 'b'}`, index === 500))
  assert.equal(getAutomaticDrawReason(INITIAL_FEN, records), 'move-limit')
})
