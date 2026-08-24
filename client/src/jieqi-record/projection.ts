import type { Board, PieceColor, Position } from '../types'
import type {
  JieqiHiddenCapturePrivateEvent,
  JieqiPublicBoard,
  JieqiPublicCapture,
  JieqiPublicMoveEvent,
  JieqiPublicPiece,
  JieqiPublicProjection,
  JieqiRecord,
  JieqiRecordAudience,
  JieqiRecordProjection,
  JieqiRecordScope,
  JieqiRefereeIdentity,
  JieqiRefereeProjection,
  JieqiSeatProjection,
} from './types'

export function canReadJieqiRecordScope(
  audience: JieqiRecordAudience,
  scope: JieqiRecordScope,
): boolean {
  if (scope === 'public') return true
  if (audience === 'referee') return true
  return (
    (audience === 'red' && scope === 'red-private') ||
    (audience === 'black' && scope === 'black-private')
  )
}

export function getJieqiEventScope(
  event: JieqiPublicMoveEvent | JieqiHiddenCapturePrivateEvent,
): JieqiRecordScope {
  if (event.kind === 'move') return 'public'
  return event.capturedBy === 'red' ? 'red-private' : 'black-private'
}

export function isJieqiEventVisibleTo(
  event: JieqiPublicMoveEvent | JieqiHiddenCapturePrivateEvent,
  audience: JieqiRecordAudience,
): boolean {
  return canReadJieqiRecordScope(audience, getJieqiEventScope(event))
}

/**
 * Separates a real initial board into its public dark-board shape and referee identities.
 * Public pieces are reconstructed field by field so their real `type` can never be copied.
 */
export function separateJieqiInitialBoard(board: Board): {
  publicBoard: JieqiPublicBoard
  refereeIdentities: JieqiRefereeIdentity[]
} {
  const refereeIdentities: JieqiRefereeIdentity[] = []
  const publicBoard = board.map((row, rowIndex) =>
    row.map((piece, colIndex): JieqiPublicPiece | null => {
      if (!piece) return null
      if (!piece.hidden) {
        return {
          state: 'revealed',
          color: piece.color,
          type: piece.type,
        }
      }
      if (!piece.darkType) throw new Error('Covered Jieqi initial piece has no movement type')
      refereeIdentities.push({
        position: { row: rowIndex, col: colIndex },
        color: piece.color,
        type: piece.type,
      })
      return {
        state: 'covered',
        color: piece.color,
        movementType: piece.darkType,
      }
    }),
  )
  return { publicBoard, refereeIdentities }
}

export function projectJieqiRecord(record: JieqiRecord, audience: 'public'): JieqiPublicProjection
export function projectJieqiRecord(record: JieqiRecord, audience: PieceColor): JieqiSeatProjection
export function projectJieqiRecord(record: JieqiRecord, audience: 'referee'): JieqiRefereeProjection
export function projectJieqiRecord(
  record: JieqiRecord,
  audience: JieqiRecordAudience,
): JieqiRecordProjection
export function projectJieqiRecord(
  record: JieqiRecord,
  audience: JieqiRecordAudience,
): JieqiRecordProjection {
  const base = {
    kind: 'jieqi-record-projection' as const,
    schemaVersion: 1 as const,
    recordId: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    startingTurn: record.public.startingTurn,
    initialBoard: clonePublicBoard(record.public.initialBoard),
    events: record.public.events.map(clonePublicEvent),
  }

  if (audience === 'public') {
    return {
      kind: base.kind,
      schemaVersion: base.schemaVersion,
      recordId: base.recordId,
      name: base.name,
      createdAt: base.createdAt,
      updatedAt: base.updatedAt,
      startingTurn: base.startingTurn,
      initialBoard: base.initialBoard,
      events: base.events,
      audience: 'public',
    }
  }

  if (audience === 'red' || audience === 'black') {
    return {
      kind: base.kind,
      schemaVersion: base.schemaVersion,
      recordId: base.recordId,
      name: base.name,
      createdAt: base.createdAt,
      updatedAt: base.updatedAt,
      startingTurn: base.startingTurn,
      initialBoard: base.initialBoard,
      events: base.events,
      audience,
      privateEvents: record.private[audience].events.map(clonePrivateEvent),
    }
  }

  return {
    kind: base.kind,
    schemaVersion: base.schemaVersion,
    recordId: base.recordId,
    name: base.name,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
    startingTurn: base.startingTurn,
    initialBoard: base.initialBoard,
    events: base.events,
    audience: 'referee',
    privateEvents: {
      red: record.private.red.events.map(clonePrivateEvent),
      black: record.private.black.events.map(clonePrivateEvent),
    },
    referee: {
      initialIdentities: record.referee.initialIdentities.map(cloneRefereeIdentity),
    },
  }
}

function clonePosition(position: Position): Position {
  return { row: position.row, col: position.col }
}

function clonePublicPiece(piece: JieqiPublicPiece | null): JieqiPublicPiece | null {
  if (!piece) return null
  if (piece.state === 'covered') {
    return {
      state: 'covered',
      color: piece.color,
      movementType: piece.movementType,
    }
  }
  return {
    state: 'revealed',
    color: piece.color,
    type: piece.type,
  }
}

function clonePublicBoard(board: JieqiPublicBoard): JieqiPublicBoard {
  return board.map((row) => row.map(clonePublicPiece))
}

function clonePublicCapture(capture: JieqiPublicCapture): JieqiPublicCapture {
  if (capture.state === 'covered') {
    return {
      state: 'covered',
      color: capture.color,
    }
  }
  return {
    state: 'revealed',
    color: capture.color,
    type: capture.type,
  }
}

function clonePublicEvent(event: JieqiPublicMoveEvent): JieqiPublicMoveEvent {
  return {
    kind: 'move',
    ply: event.ply,
    color: event.color,
    from: clonePosition(event.from),
    to: clonePosition(event.to),
    revealed: event.revealed,
    capture: event.capture ? clonePublicCapture(event.capture) : undefined,
    elapsedMs: event.elapsedMs,
  }
}

function clonePrivateEvent(event: JieqiHiddenCapturePrivateEvent): JieqiHiddenCapturePrivateEvent {
  return {
    kind: 'hidden-capture',
    ply: event.ply,
    capturedBy: event.capturedBy,
    capturedColor: event.capturedColor,
    capturedType: event.capturedType,
  }
}

function cloneRefereeIdentity(identity: JieqiRefereeIdentity): JieqiRefereeIdentity {
  return {
    position: clonePosition(identity.position),
    color: identity.color,
    type: identity.type,
  }
}

export function privateScopeForSeat(color: PieceColor): JieqiRecordScope {
  return color === 'red' ? 'red-private' : 'black-private'
}
