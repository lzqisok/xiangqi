import { validateFenPosition } from '../validation.js'
import type { JsonValidator } from '../repositories/contracts.js'
import { emptyGomokuBoard, executeGomokuMove } from '../rooms/gomokuCore.js'
import type { RoomMove } from '../rooms/types.js'

export const USER_DOCUMENT_RESOURCES = [
  'studies',
  'training-tasks',
  'custom-endgames',
  'favorite-endgames',
  'jieqi-seat-records',
  'gomoku-history',
  'recent-fens',
  'account-settings',
] as const

export type UserDocumentResource = (typeof USER_DOCUMENT_RESOURCES)[number]

type ObjectValue = Record<string, unknown>
const UCI = /^[a-i][0-9][a-i][0-9]$/
const FORBIDDEN_PRIVATE_KEYS = new Set([
  'initialJieqiBoard',
  'refereeState',
  'completeHiddenLayout',
  'hiddenLayout',
  'privateEvents',
  'snapshot',
])
const FORBIDDEN_IDENTITY_KEYS = new Set(['owner', 'ownerUserId', 'userId'])

function object(value: unknown): ObjectValue | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as ObjectValue) : null
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function coordinate(value: unknown): boolean {
  const position = object(value)
  return Boolean(
    position &&
    Number.isInteger(position.row) &&
    Number(position.row) >= 0 &&
    Number(position.row) <= 9 &&
    Number.isInteger(position.col) &&
    Number(position.col) >= 0 &&
    Number(position.col) <= 8,
  )
}

function moveRecord(value: unknown): boolean {
  const record = object(value)
  const move = object(record?.move)
  const piece = object(move?.piece)
  return Boolean(
    record &&
    move &&
    coordinate(move.from) &&
    coordinate(move.to) &&
    piece &&
    ['k', 'a', 'b', 'n', 'r', 'c', 'p'].includes(String(piece.type)) &&
    (piece.color === 'red' || piece.color === 'black') &&
    typeof record.notation === 'string' &&
    typeof record.fen === 'string' &&
    validateFenPosition(record.fen).ok &&
    record.snapshot === undefined,
  )
}

function variationTree(value: unknown): boolean {
  const tree = object(value)
  const nodes = object(tree?.nodes)
  if (
    !tree ||
    !nodes ||
    typeof tree.rootId !== 'string' ||
    typeof tree.currentNodeId !== 'string' ||
    !nodes[tree.rootId] ||
    !nodes[tree.currentNodeId] ||
    Object.keys(nodes).length > 5000
  ) {
    return false
  }
  const reachable = new Set<string>()
  const pending = [tree.rootId]
  while (pending.length) {
    const id = pending.pop()!
    if (reachable.has(id)) return false
    const node = object(nodes[id])
    if (
      !node ||
      node.id !== id ||
      typeof node.fen !== 'string' ||
      !validateFenPosition(node.fen).ok ||
      !Array.isArray(node.children) ||
      !node.children.every((child) => typeof child === 'string') ||
      !finite(node.createdAt) ||
      !finite(node.updatedAt) ||
      (id === tree.rootId ? node.parentId !== null : typeof node.parentId !== 'string') ||
      (id !== tree.rootId && !moveRecord(node.move)) ||
      (node.mainChildId !== undefined &&
        (typeof node.mainChildId !== 'string' || !node.children.includes(node.mainChildId)))
    ) {
      return false
    }
    reachable.add(id)
    for (const childId of node.children) {
      const child = object(nodes[childId])
      if (!child || child.parentId !== id) return false
      pending.push(childId)
    }
  }
  return reachable.size === Object.keys(nodes).length
}

function safeJson(value: ObjectValue, allowPrivate = false): boolean {
  let encoded: string
  try {
    encoded = JSON.stringify(value)
  } catch {
    return false
  }
  if (encoded.length > 1_000_000) return false
  const pending: unknown[] = [value]
  while (pending.length) {
    const current = pending.pop()
    if (!current || typeof current !== 'object') continue
    if (Array.isArray(current)) {
      pending.push(...current)
      continue
    }
    for (const [key, child] of Object.entries(current as ObjectValue)) {
      if (FORBIDDEN_IDENTITY_KEYS.has(key) || (!allowPrivate && FORBIDDEN_PRIVATE_KEYS.has(key))) {
        return false
      }
      pending.push(child)
    }
  }
  return true
}

function study(value: unknown): value is ObjectValue {
  const item = object(value)
  return Boolean(
    item &&
    safeJson(item) &&
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    typeof item.initialFen === 'string' &&
    validateFenPosition(item.initialFen).ok &&
    Array.isArray(item.moves) &&
    item.moves.length <= 2000 &&
    item.moves.every(moveRecord) &&
    Number.isInteger(item.currentMoveIndex) &&
    Number(item.currentMoveIndex) >= -1 &&
    Number(item.currentMoveIndex) < item.moves.length &&
    Array.isArray(item.analysisPoints) &&
    item.analysisPoints.every((point) => {
      const analysis = object(point)
      return Boolean(
        analysis &&
        Number.isInteger(analysis.moveIndex) &&
        finite(analysis.evaluation) &&
        finite(analysis.depth),
      )
    }) &&
    (item.variationTree === undefined || variationTree(item.variationTree)) &&
    finite(item.createdAt) &&
    finite(item.updatedAt),
  )
}

function trainingTask(value: unknown): value is ObjectValue {
  const item = object(value)
  const source = object(item?.source)
  return Boolean(
    item &&
    safeJson(item) &&
    typeof item.id === 'string' &&
    typeof item.positionFen === 'string' &&
    validateFenPosition(item.positionFen).ok &&
    (item.mover === 'red' || item.mover === 'black') &&
    typeof item.playedMove === 'string' &&
    UCI.test(item.playedMove) &&
    typeof item.recommendedMove === 'string' &&
    UCI.test(item.recommendedMove) &&
    source &&
    ['game', 'study', 'snapshot'].includes(String(source.type)) &&
    typeof source.name === 'string' &&
    typeof source.nodeId === 'string' &&
    Number.isInteger(item.attempts) &&
    finite(item.createdAt) &&
    finite(item.updatedAt),
  )
}

function customEndgame(value: unknown): value is ObjectValue {
  const item = object(value)
  return Boolean(
    item &&
    safeJson(item) &&
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    typeof item.fen === 'string' &&
    validateFenPosition(item.fen).ok &&
    item.source === 'custom' &&
    (item.solution === undefined ||
      (Array.isArray(item.solution) &&
        item.solution.every((move) => typeof move === 'string' && UCI.test(move)))),
  )
}

function favorite(value: unknown): value is ObjectValue {
  const item = object(value)
  return Boolean(
    item && safeJson(item) && typeof item.endgameId === 'string' && item.endgameId.length <= 200,
  )
}

function jieqiSeatRecord(value: unknown): value is ObjectValue {
  const item = object(value)
  return Boolean(
    item &&
    safeJson(item, true) &&
    item.kind === 'jieqi-record-projection' &&
    item.schemaVersion === 1 &&
    typeof item.recordId === 'string' &&
    (item.audience === 'red' || item.audience === 'black') &&
    Array.isArray(item.initialBoard) &&
    item.initialBoard.length === 10 &&
    Array.isArray(item.events) &&
    item.events.length <= 2000 &&
    Array.isArray(item.privateEvents) &&
    finite(item.createdAt) &&
    finite(item.updatedAt),
  )
}

function gomokuHistory(value: unknown): value is ObjectValue {
  const item = object(value)
  if (
    !item ||
    !safeJson(item) ||
    typeof item.id !== 'string' ||
    !finite(item.createdAt) ||
    !['pvp', 'ai', 'ai-vs-ai'].includes(String(item.mode)) ||
    typeof item.forbiddenEnabled !== 'boolean' ||
    !Array.isArray(item.moves) ||
    item.moves.length > 225
  ) {
    return false
  }
  let rebuilt: { board: ReturnType<typeof emptyGomokuBoard>; turn: 'red' | 'black' } = {
    board: emptyGomokuBoard(),
    turn: 'red',
  }
  let moves: RoomMove[] = []
  let status: 'playing' | 'red-wins' | 'black-wins' | 'draw' = 'playing'
  try {
    for (const [index, raw] of item.moves.entries()) {
      if (status !== 'playing') return false
      const move = object(raw)
      if (
        !move ||
        !Number.isInteger(move.row) ||
        !Number.isInteger(move.col) ||
        move.player !== (index % 2 === 0 ? 1 : 2)
      ) {
        return false
      }
      const result = executeGomokuMove(
        rebuilt,
        moves,
        move.row as number,
        move.col as number,
        index % 2 === 0 ? 'red' : 'black',
        item.forbiddenEnabled ? 'renju' : 'freestyle',
      )
      rebuilt = { board: result.board, turn: result.turn }
      moves = result.moves
      status = result.detail.status
    }
  } catch {
    return false
  }
  const winner = item.winner === 1 ? 'red-wins' : item.winner === 2 ? 'black-wins' : null
  return item.draw === true
    ? item.winner === null && status === 'draw'
    : item.draw === false && winner !== null && status === winner
}

function recentFen(value: unknown): value is ObjectValue {
  const item = object(value)
  return Boolean(
    item &&
    safeJson(item) &&
    typeof item.fen === 'string' &&
    validateFenPosition(item.fen).ok &&
    typeof item.label === 'string' &&
    finite(item.savedAt),
  )
}

function accountSettings(value: unknown): value is ObjectValue {
  const item = object(value)
  if (!item || !safeJson(item)) return false
  const allowed = new Set([
    'candidateCount',
    'candidateAutoRefreshDelay',
    'hintDifficulty',
    'searchMode',
    'searchDepth',
    'searchTimeMs',
  ])
  return Object.keys(item).every((key) => allowed.has(key))
}

const validators: Record<UserDocumentResource, JsonValidator<ObjectValue>> = {
  studies: study,
  'training-tasks': trainingTask,
  'custom-endgames': customEndgame,
  'favorite-endgames': favorite,
  'jieqi-seat-records': jieqiSeatRecord,
  'gomoku-history': gomokuHistory,
  'recent-fens': recentFen,
  'account-settings': accountSettings,
}

const limits: Record<UserDocumentResource, number> = {
  studies: 500,
  'training-tasks': 1000,
  'custom-endgames': 500,
  'favorite-endgames': 2000,
  'jieqi-seat-records': 200,
  'gomoku-history': 50,
  'recent-fens': 20,
  'account-settings': 1,
}

const logicalKeys: Record<UserDocumentResource, (value: ObjectValue) => string> = {
  studies: (value) => String(value.id),
  'training-tasks': (value) => String(value.id),
  'custom-endgames': (value) => String(value.id),
  'favorite-endgames': (value) => String(value.endgameId),
  'jieqi-seat-records': (value) => String(value.recordId),
  'gomoku-history': (value) => String(value.id),
  'recent-fens': (value) => String(value.fen),
  'account-settings': () => 'settings',
}

export function userDocumentDefinition(resource: string): {
  resource: UserDocumentResource
  schemaVersion: number
  maxDocuments: number
  validate: JsonValidator<ObjectValue>
  serverManaged: boolean
  logicalKey: (value: ObjectValue) => string
} | null {
  if (!USER_DOCUMENT_RESOURCES.includes(resource as UserDocumentResource)) return null
  const typed = resource as UserDocumentResource
  return {
    resource: typed,
    schemaVersion: 1,
    maxDocuments: limits[typed],
    validate: validators[typed],
    serverManaged: typed === 'jieqi-seat-records',
    logicalKey: logicalKeys[typed],
  }
}

export function userDocumentSummary(
  resource: string,
  value: ObjectValue,
): Record<string, unknown> | null {
  if (resource !== 'studies' || !study(value)) return null
  return {
    id: value.id,
    name: value.name,
    description: typeof value.description === 'string' ? value.description : '',
    moveCount: (value.moves as unknown[]).length,
    updatedAt: value.updatedAt,
  }
}
