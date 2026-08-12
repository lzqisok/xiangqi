import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildRapfiBoardCommand,
  parseRapfiClientMessage,
  parseRapfiMove,
  RAPFI_MAX_MOVES,
  RAPFI_THREAD_LIMITS,
  RAPFI_TIME_LIMITS,
} from './protocol.js'

test('Rapfi protocol validates a complete alternating Gomoku position', () => {
  const parsed = parseRapfiClientMessage(JSON.stringify({
    type: 'move',
    requestId: 'rapfi-1',
    moves: [
      { row: 7, col: 7, player: 1 },
      { row: 7, col: 8, player: 2 },
    ],
    aiPlayer: 1,
    difficulty: 'hard',
    forbiddenEnabled: true,
  }))
  assert.equal(parsed.ok, true)

  const master = parseRapfiClientMessage(JSON.stringify({
    type: 'move',
    requestId: 'rapfi-master',
    moves: [],
    aiPlayer: 1,
    difficulty: 'master',
    forbiddenEnabled: true,
  }))
  assert.equal(master.ok, true)
})

test('Rapfi difficulty resources increase through high and master levels', () => {
  assert.deepEqual(RAPFI_TIME_LIMITS, { easy: 300, medium: 1_000, hard: 5_000, master: 10_000 })
  assert.deepEqual(RAPFI_THREAD_LIMITS, { easy: 2, medium: 4, hard: 6, master: 8 })
})

test('Rapfi protocol rejects malformed, duplicate, out-of-turn and oversized positions', () => {
  const request = (changes: Record<string, unknown>) => parseRapfiClientMessage(JSON.stringify({
    type: 'move',
    requestId: 'rapfi-bad',
    moves: [],
    aiPlayer: 1,
    difficulty: 'medium',
    forbiddenEnabled: false,
    ...changes,
  }))

  assert.equal(request({ moves: [{ row: 15, col: 0, player: 1 }] }).ok, false)
  assert.equal(request({ moves: [{ row: 7, col: 7, player: 2 }] }).ok, false)
  assert.equal(request({ moves: [{ row: 7, col: 7, player: 1 }, { row: 7, col: 7, player: 2 }] }).ok, false)
  assert.equal(request({ moves: [{ row: 7, col: 7, player: 1 }], aiPlayer: 1 }).ok, false)
  assert.equal(request({ moves: Array.from({ length: RAPFI_MAX_MOVES + 1 }, () => ({ row: 0, col: 0, player: 1 })) }).ok, false)
})

test('Rapfi BOARD uses x,y coordinates and marks stones relative to the engine side', () => {
  assert.deepEqual(buildRapfiBoardCommand([
    { row: 6, col: 7, player: 1 },
    { row: 8, col: 9, player: 2 },
  ], 2), [
    'BOARD',
    '7,6,2',
    '9,8,1',
    'DONE',
  ])
})

test('Rapfi move output is converted from x,y to row,col', () => {
  assert.deepEqual(parseRapfiMove('9,8'), { row: 8, col: 9 })
  assert.equal(parseRapfiMove('MESSAGE searching'), null)
  assert.equal(parseRapfiMove('15,0'), null)
})
