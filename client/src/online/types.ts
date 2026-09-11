import type { Board, GameStatus, PieceColor, PieceType } from '../types'

export type OnlineVariant = 'xiangqi' | 'jieqi' | 'gomoku'
export type OnlineMatchSummary = {
  id: string
  name: string
  variant: OnlineVariant
  gomokuRule?: 'freestyle' | 'renju'
  matchmaking: boolean
  competitionMode: 'casual' | 'rated'
  clockPreset: 'none' | '10m' | '15m-10s' | '30m'
  visibility: 'public' | 'invite' | 'private'
  phase: 'waiting' | 'playing' | 'finished'
  red: string | null
  black: string | null
  moveCount: number
  status: GameStatus
  statusReason?: string
  previousMatchId?: string
  createdAt: string
  updatedAt: string
}

export type OnlineLobbyMatch = Pick<
  OnlineMatchSummary,
  'id' | 'name' | 'variant' | 'gomokuRule' | 'clockPreset' | 'red' | 'black' | 'createdAt'
> & {
  openSeats: PieceColor[]
}

export type OnlineMatchSnapshot = OnlineMatchSummary & {
  revision: number
  role: 'owner' | PieceColor | 'spectator'
  side: PieceColor | null
  isOwner: boolean
  seats: Partial<
    Record<
      PieceColor,
      { nickname: string; ready: boolean; online: boolean; disconnectDeadline?: string }
    >
  >
  board: Board | Array<Array<PieceColor | null>>
  turn: PieceColor
  clock?: {
    redRemainingMs: number
    blackRemainingMs: number
    incrementMs: number
    delayMs: number
    activeSide: PieceColor | null
    deadlineAt: string | null
    serverNow: string
  }
  moves: Array<{
    uci: string
    color: PieceColor
    row?: number
    col?: number
    notation?: string
    revealed?: PieceType
    captured?: PieceType | null
    capturedHidden?: boolean
  }>
  captured: Array<{
    color: PieceColor
    type: PieceType | null
    hidden: boolean
    capturedBy: PieceColor
  }>
  proposal?: {
    id: string
    kind: 'undo' | 'draw' | 'swap'
    proposedBySide: PieceColor
    deadline: string
    canRespond: boolean
    canWithdraw: boolean
  }
}

export type OnlineChatMessage = {
  id: string
  sequence: number
  authorUserId: string | null
  nickname: string
  role: 'owner' | PieceColor | 'spectator'
  content: string
  createdAt: string
}

export type OnlineRating = {
  pool: 'xiangqi' | 'jieqi' | 'gomoku-freestyle' | 'gomoku-renju'
  rating: number
  gamesPlayed: number
  wins: number
  draws: number
  losses: number
  provisional: boolean
  updatedAt: string
}

export type MatchRatingDetail = {
  matchId: string
  state: 'pending' | 'settled' | 'voided' | 'unrated'
  reason: string | null
  before: number | null
  after: number | null
  delta: number | null
  voidReason: string | null
}
export type RatingLedgerEntry = {
  id: string
  matchId: string
  pool: OnlineRating['pool']
  type: 'settlement' | 'void'
  before: number
  after: number
  delta: number
  reason: string
  createdAt: string
  voided: boolean
}
