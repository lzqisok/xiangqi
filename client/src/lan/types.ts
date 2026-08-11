import { Board, GameStatus, PieceColor, PieceType } from '../types'

export type LanRole = 'owner' | PieceColor | 'spectator'
export type LanPhase = 'waiting' | 'playing' | 'finished'
export type LanRoomSummary = { id: string; name: string; variant: 'xiangqi' | 'jieqi'; phase: LanPhase; red: string | null; black: string | null; spectatorCount: number; moveCount: number; createdAt: number }
export type LanRoomSnapshot = {
  id: string; name: string; variant: 'xiangqi' | 'jieqi'; phase: LanPhase; revision: number; role: LanRole; isOwner: boolean
  seats: Partial<Record<PieceColor, { nickname: string; ready: boolean; online: boolean; hintsRemaining: number }>>
  board: Board; turn: PieceColor
  moves: Array<{ uci: string; color: PieceColor; revealed?: PieceType; captured?: PieceType | null; capturedHidden?: boolean }>
  captured: Array<{ color: PieceColor; type: PieceType | null; hidden: boolean; capturedBy: PieceColor }>
  status: GameStatus; statusReason?: string; spectatorCount: number
  pendingDrawBy?: PieceColor; pendingUndoBy?: PieceColor; pendingSwapBy?: PieceColor
  applications?: Array<{ id: string; nickname: string; side: PieceColor }>
  disconnect?: { color: PieceColor; deadline: number }
}
