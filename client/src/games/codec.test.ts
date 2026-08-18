import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyJieqiMove,
  cloneJieqiSnapshot,
  createJieqiInitialBoard,
  JIEQI_INITIAL_FEN,
} from '../engine/jieqi'
import { formatJieqiNotation } from '../engine/jieqi'
import { Move, MoveRecord, PersistedGameState } from '../types'
import { createVariationTree } from '../variations/tree'
import { decodeGameState, encodeGameState } from './codec'

test('compact Jieqi state restores hidden layout and per-move snapshots by replay', () => {
  const initialBoard = createJieqiInitialBoard(() => 0)
  const from = { row: 6, col: 0 }
  const to = { row: 5, col: 0 }
  const move: Move = {
    from,
    to,
    piece: { ...initialBoard[from.row][from.col]! },
  }
  const moved = applyJieqiMove(initialBoard, from, to).newBoard
  const record: MoveRecord = {
    move,
    notation: formatJieqiNotation(initialBoard, move),
    fen: JIEQI_INITIAL_FEN,
    source: 'human',
    snapshot: cloneJieqiSnapshot(moved, 'black'),
  }
  const expanded: PersistedGameState = {
    initialFen: JIEQI_INITIAL_FEN,
    initialJieqiBoard: initialBoard,
    historyRecords: [record],
    currentMoveIndex: 0,
    variationTree: createVariationTree(JIEQI_INITIAL_FEN, [record], 0, 1),
    gameStatus: 'playing',
  }

  const compact = encodeGameState(expanded, 'jieqi')
  const restored = decodeGameState(compact, 'jieqi')

  assert.equal(compact.j?.length, 30)
  assert.deepEqual(restored.initialJieqiBoard, initialBoard)
  assert.equal(restored.historyRecords.length, 1)
  assert.equal(restored.historyRecords[0].snapshot?.turn, 'black')
  assert.equal(restored.historyRecords[0].snapshot?.board[to.row][to.col]?.hidden, false)
  assert.ok(JSON.stringify(compact).length < JSON.stringify(expanded).length * 0.2)
})

test('compact state keeps annotations without persisting duplicate history records', () => {
  const initialBoard = createJieqiInitialBoard(() => 0)
  const move: Move = {
    from: { row: 6, col: 0 },
    to: { row: 5, col: 0 },
    piece: { ...initialBoard[6][0]! },
  }
  const moved = applyJieqiMove(initialBoard, move.from, move.to).newBoard
  const record: MoveRecord = {
    move,
    notation: '测试记谱',
    fen: JIEQI_INITIAL_FEN,
    marked: true,
    note: '关键一步',
    snapshot: cloneJieqiSnapshot(moved, 'black'),
  }
  const state: PersistedGameState = {
    initialFen: JIEQI_INITIAL_FEN,
    initialJieqiBoard: initialBoard,
    historyRecords: [record],
    currentMoveIndex: 0,
    variationTree: createVariationTree(JIEQI_INITIAL_FEN, [record]),
    gameStatus: 'playing',
  }
  const compact = encodeGameState(state, 'jieqi')
  assert.equal('historyRecords' in compact, false)
  const restored = decodeGameState(compact, 'jieqi')
  assert.equal(restored.historyRecords[0].marked, true)
  assert.equal(restored.historyRecords[0].note, '关键一步')
  assert.equal(restored.historyRecords[0].notation, '测试记谱')
})

test('compact state rejects an illegal move instead of restoring a corrupt board', () => {
  const initialBoard = createJieqiInitialBoard(() => 0)
  const state: PersistedGameState = {
    initialFen: JIEQI_INITIAL_FEN,
    initialJieqiBoard: initialBoard,
    historyRecords: [],
    currentMoveIndex: -1,
    variationTree: createVariationTree(JIEQI_INITIAL_FEN, []),
    gameStatus: 'playing',
  }
  const compact = encodeGameState(state, 'jieqi')
  compact.t.n.bad = { p: compact.t.r, c: [], v: { u: 'a3a5' } }
  compact.t.n[compact.t.r].c = ['bad']
  compact.t.n[compact.t.r].x = 'bad'
  compact.t.c = 'bad'
  assert.throws(() => decodeGameState(compact, 'jieqi'), /Illegal compact move/)
})
