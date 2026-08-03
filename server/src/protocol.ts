import { validateFenPosition, validateMoveSequence } from './validation.js'

export type RequestKind = 'move' | 'hint' | 'analyze' | 'candidates' | 'review' | 'stop' | 'init'

export interface EngineRequest {
  type: RequestKind
  requestId?: string
  fen?: string
  moves?: string[]
  difficulty?: 'easy' | 'medium' | 'hard' | 'master'
  count?: number
  searchMode?: 'depth' | 'time'
  searchDepth?: number
  searchTimeMs?: number
  engineThreads?: 'auto' | number
  engineHashMb?: number
}

export type ProtocolValidation =
  | { ok: true; message: EngineRequest }
  | { ok: false; requestId?: string; error: string }

const DIFFICULTIES = new Set(['easy', 'medium', 'hard', 'master'])
const SEARCH_MODES = new Set(['depth', 'time'])
const UCI_MOVE_RE = /^[a-i][0-9][a-i][0-9]$/
export const MAX_MOVE_COUNT = 600
export const MAX_REVIEW_MOVE_COUNT = 120

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

  if (!['move', 'hint', 'analyze', 'candidates', 'review', 'stop', 'init'].includes(msg.type)) {
    return { ok: false, requestId, error: `Unsupported message type: ${msg.type}` }
  }

  if (msg.requestId !== undefined && (typeof msg.requestId !== 'string' || msg.requestId.trim() === '')) {
    return { ok: false, error: 'requestId must be a non-empty string' }
  }

  if (msg.difficulty !== undefined && (typeof msg.difficulty !== 'string' || !DIFFICULTIES.has(msg.difficulty))) {
    return { ok: false, requestId, error: 'difficulty is invalid' }
  }

  if (msg.moves !== undefined && (!Array.isArray(msg.moves) || !msg.moves.every(item => typeof item === 'string' && UCI_MOVE_RE.test(item)))) {
    return { ok: false, requestId, error: 'moves must be an array of UCI strings' }
  }

  if (Array.isArray(msg.moves) && msg.moves.length > MAX_MOVE_COUNT) {
    return { ok: false, requestId, error: `moves must contain at most ${MAX_MOVE_COUNT} items` }
  }

  if (msg.type === 'review' && Array.isArray(msg.moves) && msg.moves.length > MAX_REVIEW_MOVE_COUNT) {
    return { ok: false, requestId, error: `review moves must contain at most ${MAX_REVIEW_MOVE_COUNT} items` }
  }

  if (Array.isArray(msg.moves) && msg.moves.length > 0 && typeof msg.fen !== 'string') {
    return { ok: false, requestId, error: 'fen is required when moves are provided' }
  }

  if (msg.count !== undefined && (typeof msg.count !== 'number' || !Number.isInteger(msg.count) || msg.count < 1 || msg.count > 5)) {
    return { ok: false, requestId, error: 'count must be an integer between 1 and 5' }
  }

  if (msg.searchMode !== undefined && (typeof msg.searchMode !== 'string' || !SEARCH_MODES.has(msg.searchMode))) {
    return { ok: false, requestId, error: 'searchMode is invalid' }
  }

  if (msg.searchDepth !== undefined && (typeof msg.searchDepth !== 'number' || !Number.isInteger(msg.searchDepth) || msg.searchDepth < 4 || msg.searchDepth > 30)) {
    return { ok: false, requestId, error: 'searchDepth must be an integer between 4 and 30' }
  }

  if (msg.searchTimeMs !== undefined && (typeof msg.searchTimeMs !== 'number' || !Number.isInteger(msg.searchTimeMs) || msg.searchTimeMs < 500 || msg.searchTimeMs > 10000)) {
    return { ok: false, requestId, error: 'searchTimeMs must be an integer between 500 and 10000' }
  }

  if (
    msg.engineThreads !== undefined &&
    msg.engineThreads !== 'auto' &&
    (typeof msg.engineThreads !== 'number' || !Number.isInteger(msg.engineThreads) || msg.engineThreads < 1 || msg.engineThreads > 8)
  ) {
    return { ok: false, requestId, error: 'engineThreads must be "auto" or an integer between 1 and 8' }
  }

  if (msg.engineHashMb !== undefined && (typeof msg.engineHashMb !== 'number' || !Number.isInteger(msg.engineHashMb) || msg.engineHashMb < 16 || msg.engineHashMb > 512)) {
    return { ok: false, requestId, error: 'engineHashMb must be an integer between 16 and 512' }
  }

  if ((msg.type === 'move' || msg.type === 'hint' || msg.type === 'analyze' || msg.type === 'candidates' || msg.type === 'review') && typeof msg.requestId !== 'string') {
    return { ok: false, error: 'requestId is required' }
  }

  if (msg.fen !== undefined) {
    if (typeof msg.fen !== 'string') {
      return { ok: false, requestId, error: 'fen must be a string' }
    }
    const validation = validateFenPosition(msg.fen)
    if (!validation.ok) {
      return { ok: false, requestId, error: validation.errors[0] || 'Invalid position' }
    }
  }

  if (
    typeof msg.fen === 'string' &&
    Array.isArray(msg.moves) &&
    msg.moves.length > 0 &&
    msg.moves.every(item => typeof item === 'string')
  ) {
    const validation = validateMoveSequence(msg.fen, msg.moves)
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
      difficulty: typeof msg.difficulty === 'string' ? msg.difficulty as EngineRequest['difficulty'] : undefined,
      count: typeof msg.count === 'number' ? msg.count : undefined,
      searchMode: typeof msg.searchMode === 'string' ? msg.searchMode as EngineRequest['searchMode'] : undefined,
      searchDepth: typeof msg.searchDepth === 'number' ? msg.searchDepth : undefined,
      searchTimeMs: typeof msg.searchTimeMs === 'number' ? msg.searchTimeMs : undefined,
      engineThreads: msg.engineThreads === 'auto' || typeof msg.engineThreads === 'number' ? msg.engineThreads as EngineRequest['engineThreads'] : undefined,
      engineHashMb: typeof msg.engineHashMb === 'number' ? msg.engineHashMb : undefined,
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
