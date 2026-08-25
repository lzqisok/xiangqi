import assert from 'node:assert/strict'
import test from 'node:test'
import { INITIAL_FEN } from './board'
import {
  AUTOMATIC_DRAW_MAX_PLIES,
  AUTOMATIC_DRAW_QUIET_PLIES,
  getAutomaticGameStatus,
} from './drawRules'
import { MoveRecord } from '../types'
import { buildMoveRecordsFromUci } from '../share/replayLink'

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
  assert.deepEqual(getAutomaticGameStatus(INITIAL_FEN, [record(INITIAL_FEN), record(INITIAL_FEN)]), {
    status: 'draw',
    reason: 'repetition',
  })
})

test('one-sided perpetual check is connected to the automatic loss result', () => {
  const fen = '4k4/4R4/9/9/9/9/9/9/9/3K5 b - - 0 1'
  const records = buildMoveRecordsFromUci(fen, [
    'e9f9',
    'e8f8',
    'f9e9',
    'f8e8',
    'e9f9',
    'e8f8',
    'f9e9',
    'f8e8',
  ])
  assert.deepEqual(getAutomaticGameStatus(fen, records), {
    status: 'black-wins',
    reason: 'repetition',
  })
})

test('120 quiet plies are adjudicated as a natural-limit draw', () => {
  const records = Array.from({ length: AUTOMATIC_DRAW_QUIET_PLIES }, (_, index) => record(`position-${index} ${index % 2 ? 'w' : 'b'}`))
  assert.deepEqual(getAutomaticGameStatus(INITIAL_FEN, records), {
    status: 'draw',
    reason: 'natural-limit',
  })
})

test('the hard move limit stops exceptionally long games without an engine request', () => {
  const records = Array.from({ length: AUTOMATIC_DRAW_MAX_PLIES }, (_, index) => record(`position-${index} ${index % 2 ? 'w' : 'b'}`, index === 500))
  assert.deepEqual(getAutomaticGameStatus(INITIAL_FEN, records), {
    status: 'draw',
    reason: 'move-limit',
  })
})
