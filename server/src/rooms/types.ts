export type RoomVariant = 'xiangqi' | 'jieqi' | 'gomoku'
export type RoomColor = 'red' | 'black'
export type RoomPhase = 'waiting' | 'playing' | 'finished'
export type RoomRole = 'owner' | RoomColor | 'spectator'
export type RoomStatus = 'playing' | 'red-wins' | 'black-wins' | 'draw'
export type RoomStatusReason =
  | 'checkmate'
  | 'stalemate'
  | 'resignation'
  | 'agreement'
  | 'repetition'
  | 'natural-limit'
  | 'move-limit'
  | 'disconnect'
  | 'abandoned'
  | 'five'
  | 'forbidden'
  | 'full-board'

export type RoomChatMessage = {
  id: string
  sequence: number
  authorId: string
  nickname: string
  role: RoomRole
  isOwner: boolean
  content: string
  createdAt: number
}

export type StoredRoomChat = {
  schemaVersion: 1
  roomId: string
  sequence: number
  messages: RoomChatMessage[]
  everyoneMuted: boolean
  mutedAuthorIds: string[]
  roomSensitiveWords: string[]
}

export type RoomChatSettings = {
  everyoneMuted: boolean
  muted: boolean
  mutedAuthorIds?: string[]
  roomSensitiveWords?: string[]
}

export type RoomPiece = {
  type: 'k' | 'a' | 'b' | 'n' | 'r' | 'c' | 'p'
  color: RoomColor
  hidden?: boolean
  darkType?: RoomPiece['type']
}
export type RoomBoard = (RoomPiece | null)[][]
export type GomokuRoomCell = RoomColor | null
export type GomokuRoomBoard = GomokuRoomCell[][]

export type RoomMove = {
  uci: string
  color: RoomColor
  notation?: string
  revealed?: RoomPiece['type']
  captured?: RoomPiece['type']
  capturedColor?: RoomColor
  capturedHidden?: boolean
  row?: number
  col?: number
}

export type RoomSeat = {
  nickname: string
  credentialHash: string
  ready: boolean
  hintsUsed: number
}

export type StoredRoom = {
  schemaVersion: 1
  id: string
  name: string
  variant: RoomVariant
  gomokuRule?: 'freestyle' | 'renju'
  phase: RoomPhase
  revision: number
  ownerHash: string
  inviteHash?: string
  seats: Partial<Record<RoomColor, RoomSeat>>
  initialLayout?: string
  moves: RoomMove[]
  status: RoomStatus
  statusReason?: RoomStatusReason
  createdAt: number
  updatedAt: number
  startedAt?: number
  finishedAt?: number
}

export type RoomSummary = {
  id: string
  name: string
  variant: RoomVariant
  gomokuRule?: 'freestyle' | 'renju'
  phase: RoomPhase
  red: string | null
  black: string | null
  spectatorCount: number
  moveCount: number
  status: RoomStatus
  statusReason?: RoomStatusReason
  createdAt: number
  updatedAt: number
}

export type PublicCapturedPiece = {
  color: RoomColor
  type: RoomPiece['type'] | null
  hidden: boolean
  capturedBy: RoomColor
}

export type RoomSnapshot = {
  id: string
  name: string
  variant: RoomVariant
  gomokuRule?: 'freestyle' | 'renju'
  phase: RoomPhase
  revision: number
  role: RoomRole
  isOwner: boolean
  inviteAvailable: boolean
  seats: Partial<
    Record<RoomColor, { nickname: string; ready: boolean; online: boolean; hintsRemaining: number }>
  >
  board: RoomBoard | GomokuRoomBoard
  turn: RoomColor
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
  captured: PublicCapturedPiece[]
  status: RoomStatus
  statusReason?: RoomStatusReason
  spectatorCount: number
  pendingDrawBy?: RoomColor
  pendingDrawDeadline?: number
  pendingUndoBy?: RoomColor
  pendingUndoDeadline?: number
  pendingSwapBy?: RoomColor
  pendingSwapDeadline?: number
  applications?: Array<{ id: string; nickname: string; side: RoomColor }>
  disconnect?: { color: RoomColor; deadline: number }
}
