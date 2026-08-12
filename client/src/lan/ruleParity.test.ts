import assert from 'node:assert/strict'
import test from 'node:test'
import { Board, PieceType } from '../types'
import { INITIAL_FEN, parseFen } from '../engine/board'
import { getLegalMoves } from '../engine/rules'
import { legalRoomMoves, parseRoomFen, roomUci } from '../../../server/src/rooms/core'

const LAYOUT = 'rraabbnnccppppprraabbnnccppppp'

function clientJieqiBoard(): Board {
  const board = parseFen(INITIAL_FEN).board
  let offset = 0
  return board.map(row => row.map(piece => {
    if (!piece || piece.type === 'k') return piece
    return { color: piece.color, type: LAYOUT[offset++] as PieceType, hidden: true, darkType: piece.type }
  }))
}

function clientMoves(board: Board, variant: 'xiangqi' | 'jieqi') {
  const result: string[] = []
  for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) {
    if (!board[row][col]) continue
    result.push(...getLegalMoves(board, { row, col }, variant).map(to => roomUci({ row, col }, to)))
  }
  return result.sort()
}

function serverMoves(board: ReturnType<typeof parseRoomFen>['board'], variant: 'xiangqi' | 'jieqi') {
  const result: string[] = []
  for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) {
    if (!board[row][col]) continue
    result.push(...legalRoomMoves(board, { row, col }, variant).map(to => roomUci({ row, col }, to)))
  }
  return result.sort()
}

test('local and authoritative room rules expose the same initial Xiangqi moves', () => {
  assert.deepEqual(clientMoves(parseFen(INITIAL_FEN).board, 'xiangqi'), serverMoves(parseRoomFen().board, 'xiangqi'))
})

test('local and authoritative room rules expose the same covered Jieqi moves', () => {
  const server = parseRoomFen().board
  let offset = 0
  const covered = server.map(row => row.map(piece => {
    if (!piece || piece.type === 'k') return piece
    return { color: piece.color, type: LAYOUT[offset++] as PieceType, hidden: true, darkType: piece.type }
  }))
  assert.deepEqual(clientMoves(clientJieqiBoard(), 'jieqi'), serverMoves(covered, 'jieqi'))
})
