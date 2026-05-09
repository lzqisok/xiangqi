import test from 'node:test'
import assert from 'node:assert/strict'
import { parseFen, boardToFen } from './board'
import { getLegalMoves, getGameStatusDetail, isInCheck } from './rules'
import { moveToUci, uciToMove } from './notation'
import { validateFenPosition } from './validation'

function movesFor(fen: string, row: number, col: number) {
  const { board } = parseFen(fen)
  return getLegalMoves(board, { row, col }).map(pos => `${pos.row},${pos.col}`).sort()
}

test('horse leg blocks knight movement', () => {
  const fen = '4k4/9/9/9/9/9/9/4P4/4N4/4K4 w - - 0 1'
  const moves = movesFor(fen, 8, 4)
  assert.equal(moves.includes('6,3'), false)
  assert.equal(moves.includes('6,5'), false)
  assert.equal(moves.includes('7,2'), true)
  assert.equal(moves.includes('7,6'), true)
})

test('elephant eye blocks and elephant cannot cross river', () => {
  const blockedFen = '4k4/9/9/9/9/9/9/9/3P5/2B1K4 w - - 0 1'
  assert.equal(movesFor(blockedFen, 9, 2).includes('7,4'), false)

  const riverFen = '4k4/9/9/9/9/2B1P4/9/9/9/4K4 w - - 0 1'
  assert.deepEqual(movesFor(riverFen, 5, 2), ['7,0', '7,4'])
})

test('cannon captures only after exactly one screen', () => {
  const fen = '4k4/4p4/9/4P4/9/9/9/9/4C4/4K4 w - - 0 1'
  const moves = movesFor(fen, 8, 4)
  assert.equal(moves.includes('1,4'), true)
  assert.equal(moves.includes('3,4'), false)
})

test('kings facing each other is invalid and check is detected', () => {
  const fen = '4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1'
  const { board } = parseFen(fen)
  assert.equal(validateFenPosition(fen).ok, false)
  assert.equal(isInCheck(board, 'red'), true)
})

test('checkmate and stalemate reasons are distinguished', () => {
  const mateFen = '4k1PC1/3RR4/9/9/9/9/9/9/9/4K4 b - - 0 1'
  const mate = parseFen(mateFen)
  assert.deepEqual(getGameStatusDetail(mate.board, mate.turn), {
    status: 'red-wins',
    reason: 'checkmate',
  })

  const stalemateFen = '4k4/3RCR3/9/9/9/9/9/9/9/4K4 b - - 0 1'
  const stalemate = parseFen(stalemateFen)
  assert.deepEqual(getGameStatusDetail(stalemate.board, stalemate.turn), {
    status: 'red-wins',
    reason: 'stalemate',
  })
})

test('fen roundtrip and uci conversion stay stable', () => {
  const fen = '4k4/9/9/9/9/9/9/9/4R4/4K4 w - - 0 1'
  const { board, turn } = parseFen(fen)
  assert.equal(boardToFen(board, turn, 1), fen)

  const move = uciToMove('e1e2')
  assert.deepEqual(move, { from: { row: 8, col: 4 }, to: { row: 7, col: 4 } })
  assert.equal(moveToUci(move.from, move.to), 'e1e2')
})
