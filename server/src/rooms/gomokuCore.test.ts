import assert from 'node:assert/strict'
import test from 'node:test'
import { executeGomokuMove, rebuildGomokuRoom } from './gomokuCore.js'
import { RoomMove } from './types.js'

function play(sequence: Array<[number, number]>, rule: 'freestyle' | 'renju' = 'freestyle') {
  const moves: RoomMove[] = []
  let result: ReturnType<typeof executeGomokuMove> | undefined
  for (const [row, col] of sequence) {
    const color = moves.length % 2 === 0 ? 'red' : 'black'
    result = executeGomokuMove(rebuildGomokuRoom(moves), moves, row, col, color, rule)
    moves.push(result.move)
  }
  return result!
}

test('Gomoku room core validates turn, bounds, and occupied points', () => {
  const empty = rebuildGomokuRoom([])
  assert.throws(() => executeGomokuMove(empty, [], 7, 7, 'black', 'freestyle'), /尚未轮到/)
  assert.throws(() => executeGomokuMove(empty, [], -1, 7, 'red', 'freestyle'), /位置无效/)
  const first = executeGomokuMove(empty, [], 7, 7, 'red', 'freestyle')
  assert.equal(first.move.notation, 'H8')
  assert.throws(() => executeGomokuMove(rebuildGomokuRoom([first.move]), [first.move], 7, 7, 'black', 'freestyle'), /已有棋子/)
})

test('Gomoku room core detects five and maps first seat to black stones', () => {
  const result = play([[7, 3], [0, 0], [7, 4], [0, 1], [7, 5], [0, 2], [7, 6], [0, 3], [7, 7]])
  assert.equal(result.detail.status, 'red-wins')
  assert.equal(result.detail.reason, 'five')
})

test('Renju rejects an overline without persisting the forbidden move', () => {
  const sequence = [[7, 0], [0, 0], [7, 1], [0, 2], [7, 2], [0, 4], [7, 4], [0, 6], [7, 5], [0, 8]] as Array<[number, number]>
  const moves: RoomMove[] = []
  for (const [row, col] of sequence) {
    const result = executeGomokuMove(rebuildGomokuRoom(moves), moves, row, col, moves.length % 2 === 0 ? 'red' : 'black', 'renju')
    moves.push(result.move)
  }
  assert.throws(() => executeGomokuMove(rebuildGomokuRoom(moves), moves, 7, 3, 'red', 'renju'), /黑方禁手/)
  assert.equal(moves.length, 10)
})

test('Gomoku rebuild rejects out-of-turn or mismatched move records', () => {
  assert.throws(() => rebuildGomokuRoom([{ uci: 'hh', color: 'black', row: 7, col: 7 }]), /记录无效/)
  assert.throws(() => rebuildGomokuRoom([{ uci: 'aa', color: 'red', row: 7, col: 7 }]), /记录无效/)
})
