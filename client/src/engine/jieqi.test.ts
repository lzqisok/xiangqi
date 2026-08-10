import assert from 'node:assert/strict'
import test from 'node:test'
import { Move, PieceType } from '../types'
import {
  JIEQI_INITIAL_FEN,
  applyJieqiMove,
  createJieqiInitialBoard,
  encodeJieqiHistory,
  encodeJieqiMove,
  getJieqiCapturedPieces,
  getJieqiMovementType,
} from './jieqi'
import { getLegalMoves, isInCheck } from './rules'

test('createJieqiInitialBoard keeps kings visible and shuffles fifteen hidden pieces per side', () => {
  const board = createJieqiInitialBoard(() => 0.42)

  assert.equal(board[0][4]?.type, 'k')
  assert.equal(board[0][4]?.hidden, undefined)
  assert.equal(board[9][4]?.type, 'k')
  assert.equal(board[9][4]?.hidden, undefined)

  for (const color of ['red', 'black'] as const) {
    const hidden = board.flat().filter(piece => piece?.color === color && piece.hidden)
    assert.equal(hidden.length, 15)
    const counts = hidden.reduce<Record<PieceType, number>>((result, piece) => {
      result[piece!.type]++
      return result
    }, { k: 0, a: 0, b: 0, n: 0, r: 0, c: 0, p: 0 })
    assert.deepEqual(counts, { k: 0, a: 2, b: 2, n: 2, r: 2, c: 2, p: 5 })
  }

  assert.match(JIEQI_INITIAL_FEN, /X1X1X1X1X/)
})

test('hidden pieces move by their original square role and reveal after moving', () => {
  const board = createJieqiInitialBoard(() => 0.25)
  const piece = board[9][0]!
  assert.equal(piece.darkType, 'r')
  assert.equal(getJieqiMovementType(piece), 'r')
  assert.ok(getLegalMoves(board, { row: 9, col: 0 }, 'jieqi').some(move => move.row === 8 && move.col === 0))

  const { newBoard, revealed } = applyJieqiMove(board, { row: 9, col: 0 }, { row: 8, col: 0 })
  assert.equal(newBoard[9][0], null)
  assert.equal(newBoard[8][0]?.hidden, false)
  assert.equal(newBoard[8][0]?.darkType, undefined)
  assert.equal(revealed?.type, piece.type)
})

test('encodeJieqiMove appends revealed mover and captured hidden identities', () => {
  const base: Move = {
    from: { row: 6, col: 0 },
    to: { row: 5, col: 0 },
    piece: { color: 'red', type: 'n', hidden: true, darkType: 'p' },
  }
  assert.equal(encodeJieqiMove(base), 'a3a4N')
  assert.equal(encodeJieqiMove({
    ...base,
    captured: { color: 'black', type: 'c', hidden: true, darkType: 'p' },
  }), 'a3a4Nc')
  assert.equal(encodeJieqiMove({
    ...base,
    piece: { color: 'red', type: 'n' },
    captured: { color: 'black', type: 'r', hidden: true, darkType: 'p' },
  }), 'a3a4r')
})

test('encodeJieqiHistory exposes captured identities only to the capturing side', () => {
  const redCapture: Move = {
    from: { row: 5, col: 0 },
    to: { row: 4, col: 0 },
    piece: { color: 'red', type: 'r' },
    captured: { color: 'black', type: 'c', hidden: true, darkType: 'p' },
  }
  const blackCapture: Move = {
    from: { row: 4, col: 8 },
    to: { row: 5, col: 8 },
    piece: { color: 'black', type: 'n', hidden: true, darkType: 'p' },
    captured: { color: 'red', type: 'r', hidden: true, darkType: 'p' },
  }

  assert.deepEqual(encodeJieqiHistory([{ move: redCapture }, { move: blackCapture }], 'red'), [
    'a4a5c',
    'i5i4n',
  ])
  assert.deepEqual(encodeJieqiHistory([{ move: redCapture }, { move: blackCapture }], 'black'), [
    'a4a5',
    'i5i4nR',
  ])
})

test('captured piece display anonymizes hidden captures for the opponent', () => {
  const redHiddenCapture: Move = {
    from: { row: 5, col: 0 },
    to: { row: 4, col: 0 },
    piece: { color: 'red', type: 'r' },
    captured: { color: 'black', type: 'c', hidden: true, darkType: 'p' },
  }
  const blackVisibleCapture: Move = {
    from: { row: 4, col: 8 },
    to: { row: 5, col: 8 },
    piece: { color: 'black', type: 'n' },
    captured: { color: 'red', type: 'r' },
  }
  const records = [{ move: redHiddenCapture }, { move: blackVisibleCapture }]

  assert.deepEqual(getJieqiCapturedPieces(records, 'red'), {
    red: [{ color: 'black', type: 'c', wasHidden: true }],
    black: [{ color: 'red', type: 'r', wasHidden: false }],
  })
  assert.deepEqual(getJieqiCapturedPieces(records, 'black'), {
    red: [{ color: 'black', type: null, wasHidden: true }],
    black: [{ color: 'red', type: 'r', wasHidden: false }],
  })
})

test('covered pieces do not give check until they move and reveal', () => {
  const board = Array.from({ length: 10 }, () => Array(9).fill(null))
  board[9][4] = { color: 'red', type: 'k' }
  board[0][3] = { color: 'black', type: 'k' }
  board[5][4] = { color: 'black', type: 'n', hidden: true, darkType: 'r' }

  assert.equal(isInCheck(board, 'red', 'jieqi'), false)
  board[5][4] = { color: 'black', type: 'r' }
  assert.equal(isInCheck(board, 'red', 'jieqi'), true)
})

test('kings stay in the palace while revealed advisors may leave it', () => {
  const board = Array.from({ length: 10 }, () => Array(9).fill(null))
  board[9][3] = { color: 'red', type: 'k' }
  board[0][5] = { color: 'black', type: 'k' }

  const kingMoves = getLegalMoves(board, { row: 9, col: 3 }, 'jieqi')
  assert.equal(kingMoves.some(move => move.row === 9 && move.col === 2), false)

  board[6][2] = { color: 'red', type: 'a' }
  const advisorMoves = getLegalMoves(board, { row: 6, col: 2 }, 'jieqi')
  assert.ok(advisorMoves.some(move => move.row === 5 && move.col === 1))
})
