import assert from 'node:assert/strict'
import test from 'node:test'
import { createRoomInitialState, executeRoomMove, projectBoard, rebuildRoomBoard } from './core.js'

test('room core validates turns and legal moves for standard Xiangqi', () => {
  const first = executeRoomMove('xiangqi', undefined, [], 'h2e2', 'red')
  assert.equal(first.turn, 'black')
  assert.equal(first.move.color, 'red')
  assert.throws(() => executeRoomMove('xiangqi', undefined, [], 'a0a1', 'black'), /尚未轮到/)
  assert.throws(() => executeRoomMove('xiangqi', undefined, [], 'a0a9', 'red'), /非法着法/)
})

test('Jieqi private layout is complete while projected covered pieces expose only movement types', () => {
  const initial = createRoomInitialState('jieqi')
  assert.equal(initial.layout?.length, 30)
  const rebuilt = rebuildRoomBoard('jieqi', initial.layout, [])
  const projected = projectBoard(rebuilt.board)
  assert.equal(projected[6][0]?.hidden, true)
  assert.equal(projected[6][0]?.type, 'p')
  const moved = executeRoomMove('jieqi', initial.layout, [], 'a3a4', 'red')
  assert.equal(moved.board[5][0]?.hidden, false)
  assert.ok(moved.move.revealed)
})

test('compact room moves still detect threefold repetition by replaying positions', () => {
  const line = ['b0c2', 'b9c7', 'c2b0', 'c7b9', 'b0c2', 'b9c7', 'c2b0', 'c7b9']
  const moves: ReturnType<typeof executeRoomMove>['move'][] = []
  let result: ReturnType<typeof executeRoomMove> | undefined
  for (const uci of line) {
    result = executeRoomMove('xiangqi', undefined, moves, uci, moves.length % 2 === 0 ? 'red' : 'black')
    moves.push(result.move)
  }
  assert.equal(result?.detail.status, 'draw')
  assert.equal(result?.detail.reason, 'repetition')
  assert.deepEqual(Object.keys(moves[0]).sort(), ['color', 'uci'])
})
