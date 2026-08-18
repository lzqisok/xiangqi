export type GomokuPlayer = 1 | 2
export type GomokuDifficulty = 'easy' | 'medium' | 'hard' | 'master'

export interface GomokuMove {
  row: number
  col: number
  player: GomokuPlayer
}

export type RapfiClientMessage =
  | { type: 'init' }
  | { type: 'stop'; requestId?: string }
  | {
      type: 'move'
      requestId: string
      moves: GomokuMove[]
      aiPlayer: GomokuPlayer
      difficulty: GomokuDifficulty
      forbiddenEnabled: boolean
    }

export type RapfiProtocolValidation =
  { ok: true; message: RapfiClientMessage } | { ok: false; requestId?: string; error: string }

const DIFFICULTIES = new Set<GomokuDifficulty>(['easy', 'medium', 'hard', 'master'])
export const RAPFI_BOARD_SIZE = 15
export const RAPFI_MAX_MOVES = RAPFI_BOARD_SIZE * RAPFI_BOARD_SIZE

export const RAPFI_TIME_LIMITS: Record<GomokuDifficulty, number> = {
  easy: 300,
  medium: 1_000,
  hard: 5_000,
  master: 10_000,
}

export const RAPFI_THREAD_LIMITS: Record<GomokuDifficulty, number> = {
  easy: 2,
  medium: 4,
  hard: 6,
  master: 8,
}

export function parseRapfiClientMessage(raw: string): RapfiProtocolValidation {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'Message must be valid JSON' }
  }
  if (!value || typeof value !== 'object') return { ok: false, error: 'Message must be an object' }

  const input = value as Record<string, unknown>
  const requestId = typeof input.requestId === 'string' ? input.requestId : undefined
  if (input.type === 'init') return { ok: true, message: { type: 'init' } }
  if (input.type === 'stop') return { ok: true, message: { type: 'stop', requestId } }
  if (input.type !== 'move') return { ok: false, requestId, error: 'Unsupported message type' }

  if (!requestId?.trim()) return { ok: false, error: 'requestId is required' }
  if (input.aiPlayer !== 1 && input.aiPlayer !== 2)
    return { ok: false, requestId, error: 'aiPlayer is invalid' }
  if (
    typeof input.difficulty !== 'string' ||
    !DIFFICULTIES.has(input.difficulty as GomokuDifficulty)
  ) {
    return { ok: false, requestId, error: 'difficulty is invalid' }
  }
  if (typeof input.forbiddenEnabled !== 'boolean') {
    return { ok: false, requestId, error: 'forbiddenEnabled must be a boolean' }
  }
  if (!Array.isArray(input.moves) || input.moves.length > RAPFI_MAX_MOVES) {
    return { ok: false, requestId, error: `moves must contain at most ${RAPFI_MAX_MOVES} items` }
  }

  const occupied = new Set<string>()
  const moves: GomokuMove[] = []
  for (let index = 0; index < input.moves.length; index++) {
    const item = input.moves[index]
    if (!item || typeof item !== 'object')
      return { ok: false, requestId, error: `moves[${index}] is invalid` }
    const move = item as Record<string, unknown>
    const expectedPlayer: GomokuPlayer = index % 2 === 0 ? 1 : 2
    if (
      typeof move.row !== 'number' ||
      !Number.isInteger(move.row) ||
      move.row < 0 ||
      move.row >= RAPFI_BOARD_SIZE ||
      typeof move.col !== 'number' ||
      !Number.isInteger(move.col) ||
      move.col < 0 ||
      move.col >= RAPFI_BOARD_SIZE ||
      move.player !== expectedPlayer
    ) {
      return { ok: false, requestId, error: `moves[${index}] is invalid` }
    }
    const key = `${move.row},${move.col}`
    if (occupied.has(key))
      return { ok: false, requestId, error: `moves[${index}] repeats an occupied point` }
    occupied.add(key)
    moves.push({ row: move.row, col: move.col, player: move.player as GomokuPlayer })
  }

  const sideToMove: GomokuPlayer = moves.length % 2 === 0 ? 1 : 2
  if (sideToMove !== input.aiPlayer) {
    return { ok: false, requestId, error: 'aiPlayer must be the side to move' }
  }

  return {
    ok: true,
    message: {
      type: 'move',
      requestId,
      moves,
      aiPlayer: input.aiPlayer,
      difficulty: input.difficulty as GomokuDifficulty,
      forbiddenEnabled: input.forbiddenEnabled,
    },
  }
}

export function buildRapfiBoardCommand(moves: GomokuMove[], aiPlayer: GomokuPlayer): string[] {
  return [
    'BOARD',
    ...moves.map((move) => `${move.col},${move.row},${move.player === aiPlayer ? 1 : 2}`),
    'DONE',
  ]
}

export function parseRapfiMove(line: string): { row: number; col: number } | null {
  const match = /^(\d{1,2}),(\d{1,2})$/.exec(line.trim())
  if (!match) return null
  const col = Number(match[1])
  const row = Number(match[2])
  if (row < 0 || row >= RAPFI_BOARD_SIZE || col < 0 || col >= RAPFI_BOARD_SIZE) return null
  return { row, col }
}
