import { applyMove, boardToFen, INITIAL_FEN, parseFen } from '../engine/board'
import { applyJieqiMove, cloneJieqiSnapshot, JIEQI_INITIAL_FEN } from '../engine/jieqi'
import { getLegalMoves } from '../engine/rules'
import { moveToNotation, moveToUci, uciToMove } from '../engine/notation'
import {
  Board,
  CompactGameState,
  CompactVariationNode,
  GameDocument,
  LiveGameMode,
  Move,
  MoveRecord,
  PersistedGameState,
  PieceType,
  StoredGameDocument,
  VariationNode,
  VariationTree,
} from '../types'
import { getVariationLine } from '../variations/tree'

const JIEQI_TYPES = /^[rabncp]{30}$/

export function encodeJieqiLayout(board: Board): string {
  return board.flatMap(row => row)
    .filter(piece => piece && piece.type !== 'k')
    .map(piece => piece!.type)
    .join('')
}

export function decodeJieqiLayout(layout: string): Board {
  if (!JIEQI_TYPES.test(layout)) throw new Error('Invalid compact Jieqi layout')
  const { board } = parseFen(INITIAL_FEN)
  let offset = 0
  const result = board.map(row => row.map(piece => {
    if (!piece || piece.type === 'k') return piece ? { ...piece } : null
    const type = layout[offset++] as PieceType
    return { color: piece.color, type, hidden: true, darkType: piece.type }
  }))
  const validInventory = (start: number) => {
    const counts = { r: 0, a: 0, b: 0, n: 0, c: 0, p: 0 }
    for (const type of layout.slice(start, start + 15)) counts[type as keyof typeof counts]++
    return counts.r === 2 && counts.a === 2 && counts.b === 2 && counts.n === 2 && counts.c === 2 && counts.p === 5
  }
  if (!validInventory(0) || !validInventory(15)) throw new Error('Invalid compact Jieqi inventory')
  return result
}

export function encodeGameState(state: PersistedGameState, mode: LiveGameMode): CompactGameState {
  const nodes: Record<string, CompactVariationNode> = {}
  for (const [id, node] of Object.entries(state.variationTree.nodes)) {
    nodes[id] = {
      p: node.parentId,
      c: node.children,
      x: node.mainChildId,
      v: node.move ? {
        u: moveToUci(node.move.move.from, node.move.move.to),
        q: node.move.notation || undefined,
        e: node.move.elapsedMs,
        s: node.move.source,
        m: node.move.marked ? 1 : undefined,
        n: node.move.note,
      } : undefined,
    }
  }
  return {
    f: state.initialFen,
    j: mode === 'jieqi' && state.initialJieqiBoard ? encodeJieqiLayout(state.initialJieqiBoard) : undefined,
    t: { r: state.variationTree.rootId, c: state.variationTree.currentNodeId, n: nodes },
    s: state.gameStatus,
    g: state.gameStatusReason,
  }
}

export function decodeGameState(state: CompactGameState, mode: LiveGameMode): PersistedGameState {
  const initialJieqiBoard = mode === 'jieqi' ? decodeJieqiLayout(state.j || '') : undefined
  const boardByNode = new Map<string, Board>()
  const turnByNode = new Map<string, 'red' | 'black'>()
  const { board: standardBoard, turn: standardTurn } = mode === 'jieqi'
    ? { board: initialJieqiBoard!, turn: 'red' as const }
    : parseFen(state.f)
  boardByNode.set(state.t.r, standardBoard)
  turnByNode.set(state.t.r, standardTurn)
  const nodes: Record<string, VariationNode> = {}
  const pending = [state.t.r]
  const now = Date.now()

  while (pending.length) {
    const id = pending.shift()!
    const compact = state.t.n[id]
    if (!compact) throw new Error('Invalid compact variation tree')
    let fen = state.f
    let record: MoveRecord | undefined
    if (compact.v) {
      if (!compact.p) throw new Error('Compact move has no parent')
      const parentBoard = boardByNode.get(compact.p)
      const turn = turnByNode.get(compact.p)
      if (!parentBoard || !turn) throw new Error('Compact variation parent is missing')
      const { from, to } = uciToMove(compact.v.u)
      const piece = parentBoard[from.row]?.[from.col]
      if (!piece || piece.color !== turn) throw new Error('Invalid compact move')
      const legal = getLegalMoves(parentBoard, from, mode === 'jieqi' ? 'jieqi' : 'xiangqi')
        .some(target => target.row === to.row && target.col === to.col)
      if (!legal) throw new Error('Illegal compact move')
      const move: Move = { from, to, piece: { ...piece }, captured: parentBoard[to.row][to.col] ? { ...parentBoard[to.row][to.col]! } : undefined }
      const nextTurn = turn === 'red' ? 'black' : 'red'
      const nextBoard = mode === 'jieqi'
        ? applyJieqiMove(parentBoard, from, to).newBoard
        : applyMove(parentBoard, from, to).newBoard
      fen = mode === 'jieqi' ? JIEQI_INITIAL_FEN : boardToFen(nextBoard, nextTurn)
      record = {
        move,
        notation: compact.v.q || moveToNotation(parentBoard, move),
        fen,
        elapsedMs: compact.v.e,
        source: compact.v.s,
        marked: compact.v.m === 1 || undefined,
        note: compact.v.n,
        snapshot: mode === 'jieqi' ? cloneJieqiSnapshot(nextBoard, nextTurn) : undefined,
      }
      boardByNode.set(id, nextBoard)
      turnByNode.set(id, nextTurn)
    }
    nodes[id] = {
      id,
      parentId: compact.p,
      move: record,
      fen,
      children: compact.c,
      mainChildId: compact.x,
      createdAt: now,
      updatedAt: now,
    }
    pending.push(...compact.c)
  }
  const variationTree: VariationTree = { rootId: state.t.r, currentNodeId: state.t.c, nodes }
  const line = getVariationLine(variationTree)
  return {
    initialFen: mode === 'jieqi' ? JIEQI_INITIAL_FEN : state.f,
    initialJieqiBoard,
    historyRecords: line.records,
    currentMoveIndex: line.currentMoveIndex,
    variationTree,
    gameStatus: state.s,
    gameStatusReason: state.g,
  }
}

export function encodeGameDocument(game: GameDocument): StoredGameDocument {
  return { ...game, state: encodeGameState(game.state, game.mode) }
}

export function decodeGameDocument(game: StoredGameDocument): GameDocument {
  return { ...game, state: decodeGameState(game.state, game.mode) }
}
