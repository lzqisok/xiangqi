import { validateFenPosition } from './validation.js'

export type RequestKind = 'move' | 'hint' | 'analyze' | 'candidates' | 'stop' | 'init'

export interface EngineRequest {
  type: RequestKind
  requestId?: string
  fen?: string
  moves?: string[]
  difficulty?: 'easy' | 'medium' | 'hard' | 'master'
  count?: number
}

export type ProtocolValidation =
  | { ok: true; message: EngineRequest }
  | { ok: false; requestId?: string; error: string }

const DIFFICULTIES = new Set(['easy', 'medium', 'hard', 'master'])

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

  if (!['move', 'hint', 'analyze', 'candidates', 'stop', 'init'].includes(msg.type)) {
    return { ok: false, requestId, error: `Unsupported message type: ${msg.type}` }
  }

  if (msg.requestId !== undefined && typeof msg.requestId !== 'string') {
    return { ok: false, error: 'requestId must be a string' }
  }

  if (msg.difficulty !== undefined && (typeof msg.difficulty !== 'string' || !DIFFICULTIES.has(msg.difficulty))) {
    return { ok: false, requestId, error: 'difficulty is invalid' }
  }

  if (msg.moves !== undefined && (!Array.isArray(msg.moves) || !msg.moves.every(item => typeof item === 'string'))) {
    return { ok: false, requestId, error: 'moves must be an array of UCI strings' }
  }

  if (msg.count !== undefined && (typeof msg.count !== 'number' || !Number.isInteger(msg.count) || msg.count < 1 || msg.count > 5)) {
    return { ok: false, requestId, error: 'count must be an integer between 1 and 5' }
  }

  if ((msg.type === 'move' || msg.type === 'hint' || msg.type === 'analyze' || msg.type === 'candidates') && typeof msg.requestId !== 'string') {
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

  return {
    ok: true,
    message: {
      type: msg.type as RequestKind,
      requestId,
      fen: typeof msg.fen === 'string' ? msg.fen : undefined,
      moves: Array.isArray(msg.moves) ? msg.moves : undefined,
      difficulty: typeof msg.difficulty === 'string' ? msg.difficulty as EngineRequest['difficulty'] : undefined,
      count: typeof msg.count === 'number' ? msg.count : undefined,
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
