import assert from 'node:assert/strict'
import test from 'node:test'
import { applyJieqiMove, cloneJieqiSnapshot, createJieqiInitialBoard } from '../engine/jieqi'
import type { Board, MoveRecord, PieceColor, PieceType, Position } from '../types'
import { buildJieqiRecord } from './builder'
import { projectJieqiRecord } from './projection'
import { buildJieqiReplayFrames } from './replay'

test('buildJieqiRecord allowlists moves into public and capturing-seat event streams', () => {
  const initialBoard = createFixtureBoard()
  const records = createFixtureRecords(initialBoard)
  const record = buildJieqiRecord({
    id: 'local-jieqi-1',
    name: '本机揭棋记录',
    createdAt: 10,
    updatedAt: 20,
    initialBoard,
    records,
  })

  assert.equal(record.public.events.length, 6)
  assert.equal(record.public.events[0].revealed, 'p')
  assert.deepEqual(record.public.events[4].capture, { state: 'covered', color: 'black' })
  assert.deepEqual(record.public.events[5].capture, { state: 'covered', color: 'red' })
  assert.deepEqual(record.private.red.events, [
    {
      kind: 'hidden-capture',
      ply: 5,
      capturedBy: 'red',
      capturedColor: 'black',
      capturedType: 'c',
    },
  ])
  assert.deepEqual(record.private.black.events, [
    {
      kind: 'hidden-capture',
      ply: 6,
      capturedBy: 'black',
      capturedColor: 'red',
      capturedType: 'r',
    },
  ])
  assert.equal(record.referee.initialIdentities.length, 30)

  const recordJson = JSON.stringify(record)
  for (const secret of ['私密记谱获R', '私密备注', '私密FEN', '私密来源']) {
    assert.equal(recordJson.includes(secret), false)
  }
  const publicJson = JSON.stringify(projectJieqiRecord(record, 'public'))
  assert.equal(publicJson.includes('capturedType'), false)
  assert.equal(publicJson.includes('initialIdentities'), false)
  assert.equal(buildJieqiReplayFrames(projectJieqiRecord(record, 'red')).length, 7)
})

test('buildJieqiRecord validates board truth and legal movement instead of trusting records', () => {
  const initialBoard = createFixtureBoard()
  const records = createFixtureRecords(initialBoard)
  records[4].move.captured = { ...records[4].move.captured!, type: 'n' }
  assert.throws(
    () =>
      buildJieqiRecord({
        id: 'invalid-capture',
        name: '无效记录',
        createdAt: 1,
        updatedAt: 1,
        initialBoard,
        records,
      }),
    /Invalid Jieqi captured piece at ply 5/,
  )

  const illegalRecords = createFixtureRecords(initialBoard)
  illegalRecords[0].move.to = { row: 4, col: 0 }
  assert.throws(
    () =>
      buildJieqiRecord({
        id: 'illegal-move',
        name: '非法记录',
        createdAt: 1,
        updatedAt: 1,
        initialBoard,
        records: illegalRecords,
      }),
    /Illegal Jieqi move at ply 1/,
  )
})

function createFixtureBoard(): Board {
  const board = createJieqiInitialBoard(() => 0)
  forceHiddenType(board, { row: 6, col: 0 }, 'p')
  forceHiddenType(board, { row: 6, col: 2 }, 'r')
  forceHiddenType(board, { row: 3, col: 2 }, 'p')
  forceHiddenType(board, { row: 3, col: 0 }, 'c')
  return board
}

function createFixtureRecords(initialBoard: Board): MoveRecord[] {
  const moves: Array<[Position, Position]> = [
    [
      { row: 6, col: 0 },
      { row: 5, col: 0 },
    ],
    [
      { row: 3, col: 2 },
      { row: 4, col: 2 },
    ],
    [
      { row: 5, col: 0 },
      { row: 4, col: 0 },
    ],
    [
      { row: 4, col: 2 },
      { row: 5, col: 2 },
    ],
    [
      { row: 4, col: 0 },
      { row: 3, col: 0 },
    ],
    [
      { row: 5, col: 2 },
      { row: 6, col: 2 },
    ],
  ]
  const records: MoveRecord[] = []
  let board = initialBoard
  let turn: PieceColor = 'red'
  for (let index = 0; index < moves.length; index++) {
    const [from, to] = moves[index]
    const moving = board[from.row][from.col]!
    const captured = board[to.row][to.col]
    const nextBoard = applyJieqiMove(board, from, to).newBoard
    records.push({
      move: {
        from: { row: from.row, col: from.col },
        to: { row: to.row, col: to.col },
        piece: { ...moving },
        captured: captured ? { ...captured } : undefined,
      },
      notation: index === 4 ? '私密记谱获R' : '普通记谱',
      fen: '私密FEN',
      elapsedMs: index * 100,
      source: 'human',
      marked: true,
      note: '私密备注',
      snapshot: cloneJieqiSnapshot(nextBoard, turn === 'red' ? 'black' : 'red'),
    })
    ;(records[index] as MoveRecord & { privateSource?: string }).privateSource = '私密来源'
    board = nextBoard
    turn = turn === 'red' ? 'black' : 'red'
  }
  return records
}

function forceHiddenType(board: Board, target: Position, desired: PieceType): void {
  const targetPiece = board[target.row][target.col]!
  const source = board
    .flat()
    .find(
      (piece) =>
        piece?.hidden &&
        piece.color === targetPiece.color &&
        piece.type === desired &&
        piece !== targetPiece,
    )
  if (!source) throw new Error('Fixture identity is unavailable')
  const previous = targetPiece.type
  targetPiece.type = source.type
  source.type = previous
}
