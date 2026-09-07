import type { UserActor } from '../auth/types.js'
import type { MatchEntity, MatchVariant } from '../repositories/contracts.js'
import type {
  JieqiRoomPublicProjection,
  JieqiRoomSeatProjection,
  RoomBoard,
  RoomColor,
  RoomMove,
  RoomPiece,
  RoomStatusReason,
} from '../rooms/types.js'
import type { OnlineClockState } from './clock.js'
import type { RatingPool } from './rating.js'

export type OnlineActor = Pick<UserActor, 'userId' | 'sessionId' | 'ipKey' | 'capabilities'>

export type OnlineRefereeState = {
  schemaVersion: 1
  name: string
  initialLayout?: string
  moves: RoomMove[]
  clock?: OnlineClockState
}

export type OnlinePublicState = {
  schemaVersion: 1
  name: string
  moveCount: number
}

export type OnlineParticipant = {
  id: string
  userId: string | null
  side: RoomColor | null
  isOwner: boolean
  displayNameSnapshot: string
  ready: boolean
  hintsUsed: number
  joinedAt: Date
  disconnectedAt: Date | null
  disconnectDeadline: Date | null
}

export type OnlineProposal = {
  id: string
  kind: 'undo' | 'draw' | 'swap'
  proposedByUserId: string
  deadline: Date
}

export type OnlineMatchRecord = {
  match: MatchEntity
  participants: OnlineParticipant[]
  state: OnlineRefereeState
  proposal: OnlineProposal | null
}

export type OnlineRole = 'owner' | RoomColor | 'spectator'

export type OnlineMatchSummary = {
  id: string
  name: string
  variant: MatchVariant
  gomokuRule?: 'freestyle' | 'renju'
  matchmaking: boolean
  competitionMode: MatchEntity['competitionMode']
  clockPreset: MatchEntity['clockPreset']
  visibility: MatchEntity['visibility']
  phase: MatchEntity['phase']
  red: string | null
  black: string | null
  moveCount: number
  status: MatchEntity['status']
  statusReason?: RoomStatusReason
  previousMatchId?: string
  createdAt: string
  updatedAt: string
}

export type OnlineLobbyMatch = Pick<
  OnlineMatchSummary,
  'id' | 'name' | 'variant' | 'gomokuRule' | 'clockPreset' | 'red' | 'black' | 'createdAt'
> & {
  openSeats: RoomColor[]
}

export type OnlineMatchSnapshot = OnlineMatchSummary & {
  revision: number
  role: OnlineRole
  side: RoomColor | null
  isOwner: boolean
  seats: Partial<
    Record<
      RoomColor,
      {
        nickname: string
        ready: boolean
        online: boolean
        disconnectDeadline?: string
      }
    >
  >
  board: RoomBoard | Array<Array<RoomColor | null>>
  turn: RoomColor
  clock?: {
    redRemainingMs: number
    blackRemainingMs: number
    incrementMs: number
    delayMs: number
    activeSide: RoomColor | null
    deadlineAt: string | null
    serverNow: string
  }
  moves: Array<{
    uci: string
    color: RoomColor
    row?: number
    col?: number
    notation?: string
    revealed?: RoomPiece['type']
    captured?: RoomPiece['type'] | null
    capturedHidden?: boolean
  }>
  captured: Array<{
    color: RoomColor
    type: RoomPiece['type'] | null
    hidden: boolean
    capturedBy: RoomColor
  }>
  statusReason?: RoomStatusReason
  proposal?: {
    id: string
    kind: OnlineProposal['kind']
    proposedBySide: RoomColor
    deadline: string
    canRespond: boolean
    canWithdraw: boolean
  }
  jieqiRecord?: JieqiRoomPublicProjection | JieqiRoomSeatProjection
}

export type OnlineChatMessage = {
  id: string
  sequence: number
  authorUserId: string | null
  nickname: string
  role: OnlineRole
  content: string
  createdAt: string
}

export type OnlineHistoryPage = {
  matches: OnlineMatchSummary[]
  nextCursor?: string
}

export type OnlineRating = {
  pool: RatingPool
  rating: number
  gamesPlayed: number
  wins: number
  draws: number
  losses: number
  provisional: boolean
  updatedAt: string
}
