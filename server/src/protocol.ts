import { validateFenPosition, validateMoveSequence } from './validation.js'
import { validateJieqiBoardPlacement, validateJieqiMoveSequence } from './jieqiValidation.js'

export type RequestKind =
  | 'move'
  | 'hint'
  | 'analyze'
  | 'candidates'
  | 'review'
  | 'analyze-nodes'
  | 'stop'
  | 'init'
  | 'claim-game'
  | 'takeover-game'
  | 'release-game'

export interface EngineRequest {
  type: RequestKind
  requestId?: string
  fen?: string
  moves?: string[]
  moveIndexes?: number[]
  difficulty?: 'easy' | 'medium' | 'hard' | 'master'
  count?: number
  searchMode?: 'depth' | 'time'
  searchDepth?: number
  searchTimeMs?: number
  engineThreads?: 'auto' | number
  engineHashMb?: number
  variant?: 'xiangqi' | 'jieqi'
  gameId?: string
}

export type ProtocolValidation =
  { ok: true; message: EngineRequest } | { ok: false; requestId?: string; error: string }

const DIFFICULTIES = new Set(['easy', 'medium', 'hard', 'master'])
const SEARCH_MODES = new Set(['depth', 'time'])
const UCI_MOVE_RE = /^[a-i][0-9][a-i][0-9]$/
const JIEQI_MOVE_RE = /^[a-i][0-9][a-i][0-9](?:[RACPNBracpnb]{1,2})?$/
const GAME_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const JIEQI_RESERVE_LIMITS: Record<string, number> = {
  R: 2,
  A: 2,
  C: 2,
  P: 5,
  N: 2,
  B: 2,
  r: 2,
  a: 2,
  c: 2,
  p: 5,
  n: 2,
  b: 2,
}
export const MAX_MOVE_COUNT = 2000
export const MAX_REVIEW_MOVE_COUNT = 120
export const MAX_NODE_ANALYSIS_COUNT = 200

export function validateJieqiFen(fen: string): { ok: boolean; errors: string[] } {
  const fields = fen.trim().split(/\s+/)
  if (
    fields.length !== 5 ||
    !/^[wb]$/.test(fields[1] || '') ||
    !/^\d+$/.test(fields[3] || '') ||
    !/^\d+$/.test(fields[4] || '')
  ) {
    return { ok: false, errors: ['Invalid Jieqi FEN'] }
  }

  const ranks = fields[0].split('/')
  if (ranks.length !== 10) return { ok: false, errors: ['Jieqi FEN must contain 10 ranks'] }

  let redHidden = 0
  let blackHidden = 0
  let redKings = 0
  let blackKings = 0
  for (const rank of ranks) {
    let width = 0
    for (const char of rank) {
      if (/^[1-9]$/.test(char)) {
        width += Number(char)
      } else if (char === 'X' || char === 'x' || char === 'K' || char === 'k') {
        width++
        if (char === 'X') redHidden++
        if (char === 'x') blackHidden++
        if (char === 'K') redKings++
        if (char === 'k') blackKings++
      } else {
        return { ok: false, errors: ['Invalid Jieqi FEN board'] }
      }
    }
    if (width !== 9) return { ok: false, errors: ['Each Jieqi FEN rank must expand to 9 files'] }
  }

  if (redKings !== 1 || blackKings !== 1) {
    return { ok: false, errors: ['Jieqi FEN must contain exactly one king per side'] }
  }
  if (redHidden !== 15 || blackHidden !== 15) {
    return { ok: false, errors: ['Jieqi FEN must contain all fifteen hidden pieces per side'] }
  }

  const reserve = fields[2]
  if (!/^(?:[RACPNBracpnb][0-5])+$/.test(reserve)) {
    return { ok: false, errors: ['Invalid Jieqi FEN reserve'] }
  }
  const counts: Record<string, number> = {}
  for (let index = 0; index < reserve.length; index += 2) {
    const piece = reserve[index]
    if (Object.hasOwn(counts, piece)) {
      return { ok: false, errors: [`Jieqi FEN reserve repeats ${piece}`] }
    }
    counts[piece] = (counts[piece] || 0) + Number(reserve[index + 1])
  }
  for (const [piece, requiredCount] of Object.entries(JIEQI_RESERVE_LIMITS)) {
    if (counts[piece] !== requiredCount) {
      return {
        ok: false,
        errors: [`Jieqi FEN reserve must contain ${requiredCount} ${piece} pieces`],
      }
    }
  }
  const redReserve = Object.entries(counts).reduce(
    (total, [piece, count]) => total + (piece === piece.toUpperCase() ? count : 0),
    0,
  )
  const blackReserve = Object.entries(counts).reduce(
    (total, [piece, count]) => total + (piece === piece.toLowerCase() ? count : 0),
    0,
  )
  if (redReserve !== redHidden || blackReserve !== blackHidden) {
    return { ok: false, errors: ['Jieqi FEN reserve counts must match hidden pieces'] }
  }

  return validateJieqiBoardPlacement(fen)
}

export function parseClientMessage(raw: string): ProtocolValidation {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'Message must be valid JSON' }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Message must be an object' }
  }

  const msg = parsed as Record<string, unknown>
  const requestId = typeof msg.requestId === 'string' ? msg.requestId : undefined
  if (typeof msg.type !== 'string') {
    return { ok: false, requestId, error: 'Message type is required' }
  }

  if (
    ![
      'move',
      'hint',
      'analyze',
      'candidates',
      'review',
      'analyze-nodes',
      'stop',
      'init',
      'claim-game',
      'takeover-game',
      'release-game',
    ].includes(msg.type)
  ) {
    return { ok: false, requestId, error: `Unsupported message type: ${msg.type}` }
  }

  if (['claim-game', 'takeover-game', 'release-game'].includes(msg.type)) {
    if (typeof msg.gameId !== 'string' || !GAME_ID_RE.test(msg.gameId)) {
      return { ok: false, requestId, error: 'gameId is invalid' }
    }
    if (
      (msg.type === 'claim-game' || msg.type === 'takeover-game') &&
      typeof msg.requestId !== 'string'
    ) {
      return { ok: false, error: 'requestId is required' }
    }
    return { ok: true, message: { type: msg.type as RequestKind, requestId, gameId: msg.gameId } }
  }

  if (
    msg.requestId !== undefined &&
    (typeof msg.requestId !== 'string' || msg.requestId.trim() === '')
  ) {
    return { ok: false, error: 'requestId must be a non-empty string' }
  }

  if (
    msg.difficulty !== undefined &&
    (typeof msg.difficulty !== 'string' || !DIFFICULTIES.has(msg.difficulty))
  ) {
    return { ok: false, requestId, error: 'difficulty is invalid' }
  }

  if (msg.variant !== undefined && msg.variant !== 'xiangqi' && msg.variant !== 'jieqi') {
    return { ok: false, requestId, error: 'variant is invalid' }
  }

  const variant = msg.variant === 'jieqi' ? 'jieqi' : 'xiangqi'
  const movePattern = variant === 'jieqi' ? JIEQI_MOVE_RE : UCI_MOVE_RE

  if (
    msg.moves !== undefined &&
    (!Array.isArray(msg.moves) ||
      !msg.moves.every((item) => typeof item === 'string' && movePattern.test(item)))
  ) {
    return { ok: false, requestId, error: 'moves must be an array of UCI strings' }
  }

  if (Array.isArray(msg.moves) && msg.moves.length > MAX_MOVE_COUNT) {
    return { ok: false, requestId, error: `moves must contain at most ${MAX_MOVE_COUNT} items` }
  }

  if (
    msg.type === 'review' &&
    Array.isArray(msg.moves) &&
    msg.moves.length > MAX_REVIEW_MOVE_COUNT
  ) {
    return {
      ok: false,
      requestId,
      error: `review moves must contain at most ${MAX_REVIEW_MOVE_COUNT} items`,
    }
  }

  if (msg.moveIndexes !== undefined) {
    if (
      msg.type !== 'analyze-nodes' ||
      !Array.isArray(msg.moveIndexes) ||
      msg.moveIndexes.length === 0 ||
      msg.moveIndexes.length > MAX_NODE_ANALYSIS_COUNT ||
      !msg.moveIndexes.every(
        (index) =>
          typeof index === 'number' &&
          Number.isInteger(index) &&
          index >= -1 &&
          Array.isArray(msg.moves) &&
          index < msg.moves.length,
      ) ||
      new Set(msg.moveIndexes).size !== msg.moveIndexes.length
    ) {
      return {
        ok: false,
        requestId,
        error: `moveIndexes must contain 1-${MAX_NODE_ANALYSIS_COUNT} unique positions in range`,
      }
    }
  } else if (msg.type === 'analyze-nodes') {
    return { ok: false, requestId, error: 'moveIndexes is required' }
  }

  if (msg.type === 'analyze-nodes' && variant === 'jieqi') {
    return { ok: false, requestId, error: 'node analysis is unavailable for jieqi' }
  }

  if (Array.isArray(msg.moves) && msg.moves.length > 0 && typeof msg.fen !== 'string') {
    return { ok: false, requestId, error: 'fen is required when moves are provided' }
  }

  if (
    msg.count !== undefined &&
    (typeof msg.count !== 'number' ||
      !Number.isInteger(msg.count) ||
      msg.count < 1 ||
      msg.count > 5)
  ) {
    return { ok: false, requestId, error: 'count must be an integer between 1 and 5' }
  }

  if (
    msg.searchMode !== undefined &&
    (typeof msg.searchMode !== 'string' || !SEARCH_MODES.has(msg.searchMode))
  ) {
    return { ok: false, requestId, error: 'searchMode is invalid' }
  }

  if (
    msg.searchDepth !== undefined &&
    (typeof msg.searchDepth !== 'number' ||
      !Number.isInteger(msg.searchDepth) ||
      msg.searchDepth < 4 ||
      msg.searchDepth > 30)
  ) {
    return { ok: false, requestId, error: 'searchDepth must be an integer between 4 and 30' }
  }

  if (
    msg.searchTimeMs !== undefined &&
    (typeof msg.searchTimeMs !== 'number' ||
      !Number.isInteger(msg.searchTimeMs) ||
      msg.searchTimeMs < 500 ||
      msg.searchTimeMs > 10000)
  ) {
    return { ok: false, requestId, error: 'searchTimeMs must be an integer between 500 and 10000' }
  }

  if (
    msg.engineThreads !== undefined &&
    msg.engineThreads !== 'auto' &&
    (typeof msg.engineThreads !== 'number' ||
      !Number.isInteger(msg.engineThreads) ||
      msg.engineThreads < 1 ||
      msg.engineThreads > 8)
  ) {
    return {
      ok: false,
      requestId,
      error: 'engineThreads must be "auto" or an integer between 1 and 8',
    }
  }

  if (
    msg.engineHashMb !== undefined &&
    (typeof msg.engineHashMb !== 'number' ||
      !Number.isInteger(msg.engineHashMb) ||
      msg.engineHashMb < 16 ||
      msg.engineHashMb > 512)
  ) {
    return { ok: false, requestId, error: 'engineHashMb must be an integer between 16 and 512' }
  }

  if (
    (msg.type === 'move' ||
      msg.type === 'hint' ||
      msg.type === 'analyze' ||
      msg.type === 'candidates' ||
      msg.type === 'review' ||
      msg.type === 'analyze-nodes') &&
    typeof msg.requestId !== 'string'
  ) {
    return { ok: false, error: 'requestId is required' }
  }

  if (msg.fen !== undefined) {
    if (typeof msg.fen !== 'string') {
      return { ok: false, requestId, error: 'fen must be a string' }
    }
    const validation =
      variant === 'jieqi' ? validateJieqiFen(msg.fen) : validateFenPosition(msg.fen)
    if (!validation.ok) {
      return { ok: false, requestId, error: validation.errors[0] || 'Invalid position' }
    }
  }

  if (
    typeof msg.fen === 'string' &&
    Array.isArray(msg.moves) &&
    msg.moves.length > 0 &&
    msg.moves.every((item) => typeof item === 'string')
  ) {
    const validation =
      variant === 'jieqi'
        ? validateJieqiMoveSequence(msg.fen, msg.moves)
        : validateMoveSequence(msg.fen, msg.moves)
    if (!validation.ok) {
      return { ok: false, requestId, error: validation.errors[0] || 'Illegal move sequence' }
    }
  }

  return {
    ok: true,
    message: {
      type: msg.type as RequestKind,
      requestId,
      fen: typeof msg.fen === 'string' ? msg.fen : undefined,
      moves: Array.isArray(msg.moves) ? msg.moves : undefined,
      moveIndexes: Array.isArray(msg.moveIndexes) ? (msg.moveIndexes as number[]) : undefined,
      difficulty:
        typeof msg.difficulty === 'string'
          ? (msg.difficulty as EngineRequest['difficulty'])
          : undefined,
      count: typeof msg.count === 'number' ? msg.count : undefined,
      searchMode:
        typeof msg.searchMode === 'string'
          ? (msg.searchMode as EngineRequest['searchMode'])
          : undefined,
      searchDepth: typeof msg.searchDepth === 'number' ? msg.searchDepth : undefined,
      searchTimeMs: typeof msg.searchTimeMs === 'number' ? msg.searchTimeMs : undefined,
      engineThreads:
        msg.engineThreads === 'auto' || typeof msg.engineThreads === 'number'
          ? (msg.engineThreads as EngineRequest['engineThreads'])
          : undefined,
      engineHashMb: typeof msg.engineHashMb === 'number' ? msg.engineHashMb : undefined,
      variant,
      gameId: typeof msg.gameId === 'string' ? msg.gameId : undefined,
    },
  }
}

export function isStaleEngineResponse(
  pending: { id: string; kind: 'move' | 'hint'; movesKey: string } | null,
  response: { requestId?: string; requestKind?: 'move' | 'hint' },
  currentMovesKey: string,
): boolean {
  if (!pending) return true
  if (response.requestId && response.requestId !== pending.id) return true
  if (response.requestKind && response.requestKind !== pending.kind) return true
  return pending.movesKey !== currentMovesKey
}
