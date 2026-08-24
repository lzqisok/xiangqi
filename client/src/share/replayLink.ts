import { applyMove, boardToFen, parseFen } from '../engine/board'
import { moveToNotation, moveToUci, uciToMove } from '../engine/notation'
import { getLegalMoves } from '../engine/rules'
import { validateFenPosition } from '../engine/validation'
import { MAX_NODE_ANNOTATIONS } from '../annotations/model'
import { getVariationLine } from '../variations/tree'
import type {
  BoardAnnotation,
  MoveRecord,
  NodeAnalysis,
  StudyPosition,
  VariationNode,
  VariationTree,
} from '../types'

const PARAM_NAME = 'replay'
export const MAX_REPLAY_MOVES = 600
export const MAX_REPLAY_NODES = 300
export const MAX_REPLAY_PAYLOAD_BYTES = 120_000

interface LegacyReplayPayload {
  fen: string
  moves: string[]
  currentMoveIndex: number
}

interface SharedVariationNode {
  parentId: string | null
  children: string[]
  mainChildId?: string
  move?: {
    uci: string
    marked?: true
    note?: string
  }
  annotations?: BoardAnnotation[]
  analysis?: NodeAnalysis
}

interface TreeReplayPayload {
  version: 2
  fen: string
  name?: string
  description?: string
  rootId: string
  currentNodeId: string
  nodes: Record<string, SharedVariationNode>
}

export interface ReplayShareOptions {
  variationTree?: VariationTree
  name?: string
  description?: string
}

export type ReplayLinkParseResult =
  { ok: true; study: StudyPosition } | { ok: false; error: string }

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBase64Url(value: string): string {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function isLegacyReplayPayload(value: unknown): value is LegacyReplayPayload {
  const item = object(value)
  return Boolean(
    item &&
    typeof item.fen === 'string' &&
    Array.isArray(item.moves) &&
    item.moves.every((move) => typeof move === 'string') &&
    typeof item.currentMoveIndex === 'number' &&
    Number.isInteger(item.currentMoveIndex),
  )
}

function isPosition(value: unknown): value is { row: number; col: number } {
  const item = object(value)
  return Boolean(
    item &&
    Number.isInteger(item.row) &&
    Number.isInteger(item.col) &&
    (item.row as number) >= 0 &&
    (item.row as number) < 10 &&
    (item.col as number) >= 0 &&
    (item.col as number) < 9,
  )
}

function isAnnotation(value: unknown): value is BoardAnnotation {
  const item = object(value)
  if (
    !item ||
    typeof item.id !== 'string' ||
    item.id.length === 0 ||
    item.id.length > 100 ||
    !['red', 'green', 'blue'].includes(item.color as string) ||
    !isPosition(item.from)
  )
    return false
  if (item.type === 'circle') return item.to === undefined
  return (
    item.type === 'arrow' &&
    isPosition(item.to) &&
    (item.from.row !== item.to.row || item.from.col !== item.to.col)
  )
}

function isNodeAnalysis(value: unknown): value is NodeAnalysis {
  const item = object(value)
  if (!item || typeof item.score !== 'number' || typeof item.depth !== 'number') return false
  const searchLimit = item.searchLimit === undefined ? null : object(item.searchLimit)
  return (
    Number.isFinite(item.score) &&
    Number.isFinite(item.depth) &&
    (item.complete === undefined || typeof item.complete === 'boolean') &&
    (item.bestMove === undefined || typeof item.bestMove === 'string') &&
    (item.pv === undefined ||
      (Array.isArray(item.pv) && item.pv.every((move) => typeof move === 'string'))) &&
    (item.searchLimit === undefined ||
      Boolean(
        searchLimit &&
        (searchLimit.searchMode === undefined ||
          searchLimit.searchMode === 'depth' ||
          searchLimit.searchMode === 'time') &&
        (searchLimit.searchDepth === undefined || typeof searchLimit.searchDepth === 'number') &&
        (searchLimit.searchTimeMs === undefined || typeof searchLimit.searchTimeMs === 'number'),
      )) &&
    (item.engineThreads === undefined ||
      item.engineThreads === 'auto' ||
      typeof item.engineThreads === 'number') &&
    (item.engineHashMb === undefined || typeof item.engineHashMb === 'number') &&
    typeof item.updatedAt === 'number'
  )
}

function isSharedNode(value: unknown, isRoot: boolean): value is SharedVariationNode {
  const item = object(value)
  if (
    !item ||
    (isRoot
      ? item.parentId !== null || item.move !== undefined
      : typeof item.parentId !== 'string') ||
    !Array.isArray(item.children) ||
    !item.children.every((child) => typeof child === 'string') ||
    (item.mainChildId !== undefined && typeof item.mainChildId !== 'string') ||
    (item.annotations !== undefined &&
      (!Array.isArray(item.annotations) ||
        item.annotations.length > MAX_NODE_ANNOTATIONS ||
        !item.annotations.every(isAnnotation))) ||
    (item.analysis !== undefined && !isNodeAnalysis(item.analysis))
  )
    return false
  if (isRoot) return true
  const move = object(item.move)
  return Boolean(
    move &&
    typeof move.uci === 'string' &&
    /^[a-i][0-9][a-i][0-9]$/.test(move.uci) &&
    (move.marked === undefined || move.marked === true) &&
    (move.note === undefined || (typeof move.note === 'string' && move.note.length <= 2_000)),
  )
}

function isTreeReplayPayload(value: unknown): value is TreeReplayPayload {
  const item = object(value)
  const nodes = object(item?.nodes)
  if (
    !item ||
    item.version !== 2 ||
    typeof item.fen !== 'string' ||
    (item.name !== undefined && (typeof item.name !== 'string' || item.name.length > 80)) ||
    (item.description !== undefined &&
      (typeof item.description !== 'string' || item.description.length > 300)) ||
    typeof item.rootId !== 'string' ||
    typeof item.currentNodeId !== 'string' ||
    !nodes ||
    !nodes[item.rootId] ||
    !nodes[item.currentNodeId]
  )
    return false
  const entries = Object.entries(nodes)
  if (entries.length === 0 || entries.length > MAX_REPLAY_NODES) return false
  return entries.every(([id, node]) => id.length <= 100 && isSharedNode(node, id === item.rootId))
}

export function buildMoveRecordsFromUci(initialFen: string, uciMoves: string[]): MoveRecord[] {
  const fenValidation = validateFenPosition(initialFen)
  if (!fenValidation.ok) {
    throw new Error(fenValidation.errors[0] || 'Invalid FEN')
  }

  let { board, turn } = parseFen(initialFen)
  return uciMoves.map((uci) => {
    const { from, to } = uciToMove(uci)
    const piece = board[from.row][from.col]
    if (!piece) throw new Error(`No piece at ${uci.slice(0, 2)}`)
    if (piece.color !== turn) throw new Error(`Wrong side to move for ${uci}`)
    const legalTargets = getLegalMoves(board, from)
    if (!legalTargets.some((target) => target.row === to.row && target.col === to.col)) {
      throw new Error(`Illegal move ${uci}`)
    }

    const move = {
      from,
      to,
      captured: board[to.row][to.col] || undefined,
      piece,
    }
    const notation = moveToNotation(board, move)
    const applied = applyMove(board, from, to)
    const nextTurn = turn === 'red' ? 'black' : 'red'
    const fen = boardToFen(applied.newBoard, nextTurn)

    board = applied.newBoard
    turn = nextTurn
    return { move, notation, fen }
  })
}

function serializeVariationTree(tree: VariationTree): Record<string, SharedVariationNode> {
  return Object.fromEntries(
    Object.entries(tree.nodes).map(([id, node]) => [
      id,
      {
        parentId: node.parentId,
        children: node.children,
        ...(node.mainChildId ? { mainChildId: node.mainChildId } : {}),
        ...(node.move
          ? {
              move: {
                uci: moveToUci(node.move.move.from, node.move.move.to),
                ...(node.move.marked ? { marked: true as const } : {}),
                ...(node.move.note ? { note: node.move.note } : {}),
              },
            }
          : {}),
        ...(node.annotations ? { annotations: node.annotations } : {}),
        ...(node.analysis ? { analysis: node.analysis } : {}),
      },
    ]),
  )
}

function rebuildSharedTree(payload: TreeReplayPayload, now: number): VariationTree {
  const sourceNodes = payload.nodes
  const nodes: Record<string, VariationNode> = {}
  const pending = [payload.rootId]
  const visited = new Set<string>()
  nodes[payload.rootId] = {
    id: payload.rootId,
    parentId: null,
    fen: payload.fen,
    children: [...sourceNodes[payload.rootId].children],
    mainChildId: sourceNodes[payload.rootId].mainChildId,
    annotations: sourceNodes[payload.rootId].annotations,
    analysis: sourceNodes[payload.rootId].analysis,
    createdAt: now,
    updatedAt: now,
  }

  while (pending.length > 0) {
    const parentId = pending.shift()!
    if (visited.has(parentId)) throw new Error('Variation cycle')
    visited.add(parentId)
    const parent = nodes[parentId]
    const sharedParent = sourceNodes[parentId]
    if (!parent || !sharedParent) throw new Error('Missing variation node')
    if (sharedParent.mainChildId && !sharedParent.children.includes(sharedParent.mainChildId)) {
      throw new Error('Invalid main variation')
    }
    for (const childId of sharedParent.children) {
      const child = sourceNodes[childId]
      if (!child || child.parentId !== parentId || !child.move || nodes[childId]) {
        throw new Error('Invalid variation relationship')
      }
      const [record] = buildMoveRecordsFromUci(parent.fen, [child.move.uci])
      record.marked = child.move.marked
      record.note = child.move.note
      nodes[childId] = {
        id: childId,
        parentId,
        move: record,
        fen: record.fen,
        children: [...child.children],
        mainChildId: child.mainChildId,
        annotations: child.annotations,
        analysis: child.analysis,
        createdAt: now,
        updatedAt: now,
      }
      pending.push(childId)
    }
  }
  if (visited.size !== Object.keys(sourceNodes).length || !visited.has(payload.currentNodeId)) {
    throw new Error('Disconnected variation tree')
  }
  return { rootId: payload.rootId, currentNodeId: payload.currentNodeId, nodes }
}

export function createReplayUrl(
  baseUrl: string,
  initialFen: string,
  records: MoveRecord[],
  currentMoveIndex: number,
  options: ReplayShareOptions = {},
): string {
  const url = new URL(baseUrl)
  let payload: LegacyReplayPayload | TreeReplayPayload
  if (options.variationTree) {
    const nodeCount = Object.keys(options.variationTree.nodes).length
    if (nodeCount > MAX_REPLAY_NODES) {
      throw new Error(`完整变招分享最多支持 ${MAX_REPLAY_NODES} 个节点。`)
    }
    payload = {
      version: 2,
      fen: initialFen,
      ...(options.name ? { name: options.name.slice(0, 80) } : {}),
      ...(options.description ? { description: options.description.slice(0, 300) } : {}),
      rootId: options.variationTree.rootId,
      currentNodeId: options.variationTree.currentNodeId,
      nodes: serializeVariationTree(options.variationTree),
    }
  } else {
    payload = {
      fen: initialFen,
      moves: records.map((record) => moveToUci(record.move.from, record.move.to)),
      currentMoveIndex: Math.max(-1, Math.min(currentMoveIndex, records.length - 1)),
    }
  }
  const serialized = JSON.stringify(payload)
  if (new TextEncoder().encode(serialized).length > MAX_REPLAY_PAYLOAD_BYTES) {
    throw new Error('完整变招回放内容过大，请先删减分支或改用研究 JSON 导出。')
  }
  url.searchParams.set(PARAM_NAME, encodeBase64Url(serialized))
  return url.toString()
}

export function parseReplayStudyFromSearch(
  search: string,
  now = Date.now(),
): ReplayLinkParseResult | null {
  const raw = new URLSearchParams(search).get(PARAM_NAME)
  if (!raw) return null

  try {
    const decoded = decodeBase64Url(raw)
    if (new TextEncoder().encode(decoded).length > MAX_REPLAY_PAYLOAD_BYTES) {
      return { ok: false, error: '回放链接内容过大。' }
    }
    const parsed = JSON.parse(decoded) as unknown
    if (isTreeReplayPayload(parsed)) {
      const fenValidation = validateFenPosition(parsed.fen)
      if (!fenValidation.ok) return { ok: false, error: '回放链接中的起始局面无效。' }
      const variationTree = rebuildSharedTree(parsed, now)
      const line = getVariationLine(variationTree, variationTree.currentNodeId)
      return {
        ok: true,
        study: {
          id: `shared-replay-${now}`,
          name: parsed.name?.trim() || '分享回放',
          description: parsed.description?.trim() || '从完整变招分享链接恢复',
          initialFen: parsed.fen,
          moves: line.records,
          currentMoveIndex: line.currentMoveIndex,
          analysisPoints: [],
          variationTree,
          createdAt: now,
          updatedAt: now,
        },
      }
    }
    if (!isLegacyReplayPayload(parsed)) {
      return { ok: false, error: '回放链接格式无效。' }
    }
    if (parsed.moves.length > MAX_REPLAY_MOVES) {
      return { ok: false, error: `回放链接最多支持 ${MAX_REPLAY_MOVES} 手。` }
    }
    const records = buildMoveRecordsFromUci(parsed.fen, parsed.moves)
    const currentMoveIndex = Math.max(-1, Math.min(parsed.currentMoveIndex, records.length - 1))
    return {
      ok: true,
      study: {
        id: `shared-replay-${now}`,
        name: '分享回放',
        description: '从分享链接恢复',
        initialFen: parsed.fen,
        moves: records,
        currentMoveIndex,
        analysisPoints: [],
        createdAt: now,
        updatedAt: now,
      },
    }
  } catch {
    return { ok: false, error: '回放链接解析失败。' }
  }
}
