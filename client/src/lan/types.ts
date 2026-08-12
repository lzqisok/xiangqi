import { Board, GameStatus, PieceColor, PieceType } from '../types'

export type LanRole = 'owner' | PieceColor | 'spectator'
export type LanPhase = 'waiting' | 'playing' | 'finished'
export type LanRoomSummary = { id: string; name: string; variant: 'xiangqi' | 'jieqi'; phase: LanPhase; red: string | null; black: string | null; spectatorCount: number; moveCount: number; status: GameStatus; statusReason?: string; createdAt: number; updatedAt: number }
export type LanChatMessage = { id: string; sequence: number; authorId: string; nickname: string; role: LanRole; isOwner: boolean; content: string; createdAt: number }
export type LanChatSettings = { everyoneMuted: boolean; muted: boolean; mutedAuthorIds?: string[]; roomSensitiveWords?: string[] }
export type LanRoomSnapshot = {
  id: string; name: string; variant: 'xiangqi' | 'jieqi'; phase: LanPhase; revision: number; role: LanRole; isOwner: boolean; inviteAvailable: boolean
  seats: Partial<Record<PieceColor, { nickname: string; ready: boolean; online: boolean; hintsRemaining: number }>>
  board: Board; turn: PieceColor
  moves: Array<{ uci: string; color: PieceColor; notation?: string; revealed?: PieceType; captured?: PieceType | null; capturedHidden?: boolean }>
  captured: Array<{ color: PieceColor; type: PieceType | null; hidden: boolean; capturedBy: PieceColor }>
  status: GameStatus; statusReason?: string; spectatorCount: number
  pendingDrawBy?: PieceColor; pendingDrawDeadline?: number
  pendingUndoBy?: PieceColor; pendingUndoDeadline?: number
  pendingSwapBy?: PieceColor; pendingSwapDeadline?: number
  applications?: Array<{ id: string; nickname: string; side: PieceColor }>
  disconnect?: { color: PieceColor; deadline: number }
}
