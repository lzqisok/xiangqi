import assert from 'node:assert/strict'
import test from 'node:test'
import { Board, PieceType } from '../types'
import { INITIAL_FEN, parseFen } from '../engine/board'
import { getLegalMoves } from '../engine/rules'
import { analyzeRepetitionCase } from '../engine/repetitionAdjudication'
import { buildMoveRecordsFromUci } from '../share/replayLink'
import {
  adjudicateRoomRepetition,
  legalRoomMoves,
  parseRoomFen,
  roomUci,
} from '../../../server/src/rooms/core'

const LAYOUT = 'rraabbnnccppppprraabbnnccppppp'

function clientJieqiBoard(): Board {
  const board = parseFen(INITIAL_FEN).board
  let offset = 0
  return board.map((row) =>
    row.map((piece) => {
      if (!piece || piece.type === 'k') return piece
      return {
        color: piece.color,
        type: LAYOUT[offset++] as PieceType,
        hidden: true,
        darkType: piece.type,
      }
    }),
  )
}

function clientMoves(board: Board, variant: 'xiangqi' | 'jieqi') {
  const result: string[] = []
  for (let row = 0; row < 10; row++)
    for (let col = 0; col < 9; col++) {
      if (!board[row][col]) continue
      result.push(
        ...getLegalMoves(board, { row, col }, variant).map((to) => roomUci({ row, col }, to)),
      )
    }
  return result.sort()
}

function serverMoves(
  board: ReturnType<typeof parseRoomFen>['board'],
  variant: 'xiangqi' | 'jieqi',
) {
  const result: string[] = []
  for (let row = 0; row < 10; row++)
    for (let col = 0; col < 9; col++) {
      if (!board[row][col]) continue
      result.push(
        ...legalRoomMoves(board, { row, col }, variant).map((to) => roomUci({ row, col }, to)),
      )
    }
  return result.sort()
}

test('local and authoritative room rules expose the same initial Xiangqi moves', () => {
  assert.deepEqual(
    clientMoves(parseFen(INITIAL_FEN).board, 'xiangqi'),
    serverMoves(parseRoomFen().board, 'xiangqi'),
  )
})

test('local and authoritative room rules expose the same covered Jieqi moves', () => {
  const server = parseRoomFen().board
  let offset = 0
  const covered = server.map((row) =>
    row.map((piece) => {
      if (!piece || piece.type === 'k') return piece
      return {
        color: piece.color,
        type: LAYOUT[offset++] as PieceType,
        hidden: true,
        darkType: piece.type,
      }
    }),
  )
  assert.deepEqual(clientMoves(clientJieqiBoard(), 'jieqi'), serverMoves(covered, 'jieqi'))
})

test('local and authoritative room repetition classifiers agree on fixed CXA corpora', () => {
  const corpora = [
    {
      fen: '4k4/4R4/9/9/9/9/9/9/9/3K5 b - - 0 1',
      moves: ['e9f9', 'e8f8', 'f9e9', 'f8e8', 'e9f9', 'e8f8', 'f9e9', 'f8e8'],
    },
    {
      fen: '5k3/9/9/9/1r7/9/1PP6/9/9/C2K5 w - - 0 1',
      moves: ['a0b0', 'b5c5', 'b0c0', 'c5b5', 'c0b0', 'b5c5', 'b0c0', 'c5b5', 'c0b0'],
    },
    {
      fen: '5k3/9/9/9/1r7/9/9/9/9/R2K5 w - - 0 1',
      moves: ['a0b0', 'b5c5', 'b0c0', 'c5b5', 'c0b0', 'b5c5', 'b0c0', 'c5b5', 'c0b0'],
    },
    {
      fen: '5k3/9/9/9/1r7/9/1PP6/9/3K5/C3A3c w - - 0 1',
      moves: ['a0b0', 'b5c5', 'b0c0', 'c5b5', 'c0b0', 'b5c5', 'b0c0', 'c5b5', 'c0b0'],
    },
    {
      fen: '4k4/4r4/3P5/9/3C5/9/9/9/9/3K5 w - - 0 1',
      moves: ['d5e5', 'e8d8', 'e5d5', 'd8e8', 'd5e5', 'e8d8', 'e5d5', 'd8e8'],
    },
    {
      fen: '5k3/9/9/2r6/1P7/9/9/9/9/3K5 w - - 0 1',
      moves: ['b5c5', 'c6b6', 'c5b5', 'b6c6', 'b5c5', 'c6b6', 'c5b5', 'b6c6'],
    },
    {
      fen: '4k4/9/9/9/4p4/9/9/9/R8/R3Kc3 w - - 0 1',
      moves: ['e0e1', 'f0f1', 'e1e0', 'f1f0', 'e0e1', 'f0f1', 'e1e0', 'f1f0'],
    },
    {
      fen: '4k4/9/9/9/4p4/9/9/9/R8/R3Kr3 w - - 0 1',
      moves: ['e0e1', 'f0f1', 'e1e0', 'f1f0', 'e0e1', 'f0f1', 'e1e0', 'f1f0'],
    },
    {
      fen: '5k3/9/9/9/1c1r5/9/9/9/9/R3K4 w - - 0 1',
      moves: ['a0b0', 'b5c5', 'b0c0', 'c5b5', 'c0b0', 'b5c5', 'b0c0', 'c5b5', 'c0b0'],
    },
    {
      fen: '3k5/9/9/9/1c1r5/9/9/9/9/R2R1K3 w - - 0 1',
      moves: ['a0b0', 'b5c5', 'b0c0', 'c5b5', 'c0b0', 'b5c5', 'b0c0', 'c5b5', 'c0b0'],
    },
    {
      fen: 'cc2k4/9/9/9/nn7/9/1p7/9/9/C2K5 w - - 0 1',
      moves: ['a0b0', 'b3a3', 'b0a0', 'a3b3', 'a0b0', 'b3a3', 'b0a0', 'a3b3'],
    },
  ]

  for (const corpus of corpora) {
    const records = buildMoveRecordsFromUci(corpus.fen, corpus.moves)
    const local = analyzeRepetitionCase(corpus.fen, records)
    const room = adjudicateRoomRepetition(
      corpus.fen,
      corpus.moves.map((uci, index) => ({
        uci,
        color: records[index].move.piece.color,
      })),
    )
    assert.equal(local.kind, 'adjudicated')
    if (local.kind !== 'adjudicated') continue
    assert.equal(room?.status, local.outcome)
    assert.equal(room?.liableSide, local.liableSide)
    assert.equal(room?.violation, local.violation)
  }
})
