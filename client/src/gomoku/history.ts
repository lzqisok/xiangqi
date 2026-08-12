import { GameMode, Move, Player, WinResult } from './core/types'
import { applyMove, createEmptyBoard, isBoardFull } from './core/board'
import { checkWinResult } from './core/rules'
import type { Board } from './core/board'

export type GomokuGameRecord = {
  id: string
  createdAt: number
  mode: GameMode
  forbiddenEnabled: boolean
  winner: Player | null
  draw: boolean
  moves: Move[]
}

const KEY = 'gomoku-game-history-v1'

function replayStoredMoves(moves: Move[], forbiddenEnabled: boolean): { board: Board; ended: WinResult | null } | null {
  const occupied = new Set<string>()
  let board = createEmptyBoard()
  let ended: WinResult | null = null

  for (const [index, move] of moves.entries()) {
    const point = `${move?.row},${move?.col}`
    if (!move || ended || !Number.isInteger(move.row) || !Number.isInteger(move.col) || move.row < 0 || move.row >= 15 || move.col < 0 || move.col >= 15 || move.player !== (index % 2 === 0 ? 1 : 2) || occupied.has(point)) return null
    occupied.add(point)
    board = applyMove(board, move)
    ended = checkWinResult(board, move, move.player, { forbiddenEnabled })
    // A forbidden point is rejected by the game flow and must never appear in a saved record.
    if (ended?.reason === 'forbidden') return null
  }

  return { board, ended }
}

export function loadGomokuHistory(): GomokuGameRecord[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '[]') as unknown
    if (!Array.isArray(value)) return []
    return value.filter((record): record is GomokuGameRecord => {
      if (!record || typeof record !== 'object') return false
      const item = record as Partial<GomokuGameRecord>
      if (typeof item.id !== 'string' || !Number.isFinite(item.createdAt) || !['pvp', 'ai', 'ai-vs-ai'].includes(item.mode || '') || typeof item.forbiddenEnabled !== 'boolean' || typeof item.draw !== 'boolean' || item.winner !== null && item.winner !== 1 && item.winner !== 2 || !Array.isArray(item.moves) || item.moves.length > 225) return false
      const replay = replayStoredMoves(item.moves, item.forbiddenEnabled)
      if (!replay) return false
      return item.draw ? item.winner === null && !replay.ended && isBoardFull(replay.board) : Boolean(replay.ended && replay.ended.winner === item.winner)
    }).slice(0, 50)
  } catch { return [] }
}
export function saveGomokuRecord(record: Omit<GomokuGameRecord, 'id' | 'createdAt'>) {
  const createdAt = Date.now()
  const saved = { ...record, id: `${createdAt}-${record.moves.length}`, createdAt }
  const history = [saved, ...loadGomokuHistory()].slice(0, 50)
  try { localStorage.setItem(KEY, JSON.stringify(history)) } catch { /* History is optional when storage is unavailable. */ }
  return history
}
export function clearGomokuHistory() { try { localStorage.removeItem(KEY) } catch { /* optional */ } }
