import type { PieceColor, PieceType, Position } from '../types'

/**
 * `public` is the only projection suitable for spectators or sharing.
 * Seat projections add only captures learned by that seat; `referee` is the full record.
 */
export type JieqiRecordAudience = 'public' | PieceColor | 'referee'

export type JieqiRecordScope = 'public' | 'red-private' | 'black-private' | 'referee'

export type JieqiPublicPiece =
  | {
      state: 'covered'
      color: PieceColor
      /** The original-square role used while the piece remains covered. */
      movementType: PieceType
    }
  | {
      state: 'revealed'
      color: PieceColor
      type: PieceType
    }

export type JieqiPublicBoard = (JieqiPublicPiece | null)[][]

export type JieqiPublicCapture =
  | {
      state: 'covered'
      color: PieceColor
    }
  | {
      state: 'revealed'
      color: PieceColor
      type: PieceType
    }

/**
 * Public move events intentionally contain no hidden captured identity.
 * A covered mover's revealed identity is public from this ply onward.
 */
export interface JieqiPublicMoveEvent {
  kind: 'move'
  ply: number
  color: PieceColor
  from: Position
  to: Position
  revealed?: PieceType
  capture?: JieqiPublicCapture
  elapsedMs?: number
}

/** A covered capture is learned only by its capturing seat and the referee. */
export interface JieqiHiddenCapturePrivateEvent {
  kind: 'hidden-capture'
  ply: number
  capturedBy: PieceColor
  capturedColor: PieceColor
  capturedType: PieceType
}

export interface JieqiRefereeIdentity {
  position: Position
  color: PieceColor
  type: PieceType
}

export interface JieqiRecord {
  kind: 'jieqi-record'
  schemaVersion: 1
  id: string
  name: string
  createdAt: number
  updatedAt: number
  public: {
    startingTurn: PieceColor
    initialBoard: JieqiPublicBoard
    events: JieqiPublicMoveEvent[]
  }
  private: Record<
    PieceColor,
    {
      events: JieqiHiddenCapturePrivateEvent[]
    }
  >
  referee: {
    initialIdentities: JieqiRefereeIdentity[]
  }
}

interface JieqiProjectionBase {
  kind: 'jieqi-record-projection'
  schemaVersion: 1
  recordId: string
  name: string
  createdAt: number
  updatedAt: number
  startingTurn: PieceColor
  initialBoard: JieqiPublicBoard
  events: JieqiPublicMoveEvent[]
}

export interface JieqiPublicProjection extends JieqiProjectionBase {
  audience: 'public'
}

export interface JieqiSeatProjection extends JieqiProjectionBase {
  audience: PieceColor
  privateEvents: JieqiHiddenCapturePrivateEvent[]
}

export interface JieqiRefereeProjection extends JieqiProjectionBase {
  audience: 'referee'
  privateEvents: Record<PieceColor, JieqiHiddenCapturePrivateEvent[]>
  referee: {
    initialIdentities: JieqiRefereeIdentity[]
  }
}

export type JieqiRecordProjection =
  JieqiPublicProjection | JieqiSeatProjection | JieqiRefereeProjection

export type JieqiReplayPiece =
  | {
      state: 'covered'
      color: PieceColor
      movementType: PieceType
      /** Null outside the referee projection. */
      identity: PieceType | null
    }
  | {
      state: 'revealed'
      color: PieceColor
      type: PieceType
    }

export type JieqiReplayBoard = (JieqiReplayPiece | null)[][]

export interface JieqiReplayCapture {
  ply: number
  capturedBy: PieceColor
  color: PieceColor
  wasCovered: boolean
  /** Null when this audience never learned the covered identity. */
  visibleType: PieceType | null
}

export interface JieqiReplayFrame {
  ply: number
  audience: JieqiRecordAudience
  turn: PieceColor
  board: JieqiReplayBoard
  captured: JieqiReplayCapture[]
}
