import { getLegalMoves } from '../engine/rules'
import type { Board, PieceColor, PieceType, Position } from '../types'
import type {
  JieqiHiddenCapturePrivateEvent,
  JieqiPublicMoveEvent,
  JieqiRecordProjection,
  JieqiReplayBoard,
  JieqiReplayCapture,
  JieqiReplayFrame,
  JieqiReplayPiece,
  JieqiRefereeIdentity,
} from './types'

const ROWS = 10
const COLS = 9

/**
 * Rebuilds every visible frame forward from the projected public dark board.
 * It never consumes ordinary FEN, move snapshots, or a future board state.
 */
export function buildJieqiReplayFrames(projection: JieqiRecordProjection): JieqiReplayFrame[] {
  assertInitialBoard(projection.initialBoard)
  const refereeIdentities = getRefereeIdentityMap(projection)
  const privateEvents = getPrivateEventMap(projection)
  validatePrivateEvents(projection.events, privateEvents, projection.audience)

  let board: JieqiReplayBoard = projection.initialBoard.map((row, rowIndex) =>
    row.map((piece, colIndex): JieqiReplayPiece | null => {
      if (!piece) return null
      if (piece.state === 'revealed') {
        return {
          state: 'revealed',
          color: piece.color,
          type: piece.type,
        }
      }
      const refereeIdentity = refereeIdentities.get(positionKey({ row: rowIndex, col: colIndex }))
      if (projection.audience === 'referee') {
        if (!refereeIdentity || refereeIdentity.color !== piece.color) {
          throw new Error('Incomplete Jieqi referee initial identities')
        }
      }
      return {
        state: 'covered',
        color: piece.color,
        movementType: piece.movementType,
        identity: refereeIdentity?.type || null,
      }
    }),
  )
  let turn = projection.startingTurn
  const captured: JieqiReplayCapture[] = []
  const frames: JieqiReplayFrame[] = [createFrame(0, projection.audience, turn, board, captured)]

  for (let index = 0; index < projection.events.length; index++) {
    const event = projection.events[index]
    if (event.ply !== index + 1) throw new Error('Invalid Jieqi event sequence')
    if (event.color !== turn) throw new Error('Invalid Jieqi turn sequence')
    assertPosition(event.from)
    assertPosition(event.to)

    const moving = board[event.from.row][event.from.col]
    const destination = board[event.to.row][event.to.col]
    if (!moving || moving.color !== event.color) throw new Error('Invalid Jieqi moving piece')
    const legal = getLegalMoves(toRulesBoard(board), event.from, 'jieqi').some(
      (target) => target.row === event.to.row && target.col === event.to.col,
    )
    if (!legal) throw new Error('Illegal Jieqi replay move')
    validateCapture(event, destination)

    if (destination) {
      const privateEvent = privateEvents.get(event.ply)
      const visibleType =
        destination.state === 'revealed' ? destination.type : privateEvent?.capturedType || null
      captured.push({
        ply: event.ply,
        capturedBy: event.color,
        color: destination.color,
        wasCovered: destination.state === 'covered',
        visibleType,
      })
    }

    let arrived: JieqiReplayPiece
    if (moving.state === 'covered') {
      if (!event.revealed) throw new Error('Covered Jieqi move is missing its public reveal')
      if (moving.identity && moving.identity !== event.revealed) {
        throw new Error('Jieqi reveal conflicts with referee identity')
      }
      arrived = {
        state: 'revealed',
        color: moving.color,
        type: event.revealed,
      }
    } else {
      if (event.revealed) throw new Error('Revealed Jieqi move cannot reveal again')
      arrived = {
        state: 'revealed',
        color: moving.color,
        type: moving.type,
      }
    }

    board = cloneReplayBoard(board)
    board[event.from.row][event.from.col] = null
    board[event.to.row][event.to.col] = arrived
    turn = oppositeColor(turn)
    frames.push(createFrame(event.ply, projection.audience, turn, board, captured))
  }

  return frames
}

function validateCapture(event: JieqiPublicMoveEvent, destination: JieqiReplayPiece | null): void {
  if (!destination && event.capture) throw new Error('Jieqi capture has no destination piece')
  if (destination && !event.capture) throw new Error('Jieqi capture metadata is missing')
  if (!destination || !event.capture) return
  if (destination.color === event.color || destination.color !== event.capture.color) {
    throw new Error('Jieqi captured color does not match the board')
  }
  if (destination.state !== event.capture.state) {
    throw new Error('Jieqi captured visibility does not match the board')
  }
  if (
    destination.state === 'revealed' &&
    event.capture.state === 'revealed' &&
    destination.type !== event.capture.type
  ) {
    throw new Error('Jieqi public captured identity does not match the board')
  }
}

function validatePrivateEvents(
  publicEvents: JieqiPublicMoveEvent[],
  privateEvents: Map<number, JieqiHiddenCapturePrivateEvent>,
  audience: JieqiRecordProjection['audience'],
): void {
  for (const privateEvent of privateEvents.values()) {
    const publicEvent = publicEvents[privateEvent.ply - 1]
    if (
      !publicEvent ||
      publicEvent.ply !== privateEvent.ply ||
      publicEvent.color !== privateEvent.capturedBy ||
      publicEvent.capture?.state !== 'covered' ||
      publicEvent.capture.color !== privateEvent.capturedColor
    ) {
      throw new Error('Jieqi private capture does not match its public event')
    }
    if (audience !== 'referee' && audience !== privateEvent.capturedBy) {
      throw new Error('Jieqi projection contains another seat private event')
    }
  }

  if (audience === 'public') return
  for (const event of publicEvents) {
    if (event.capture?.state !== 'covered') continue
    const shouldKnow = audience === 'referee' || audience === event.color
    if (shouldKnow && !privateEvents.has(event.ply)) {
      throw new Error('Jieqi projection is missing an authorized private capture')
    }
  }
}

function getPrivateEventMap(
  projection: JieqiRecordProjection,
): Map<number, JieqiHiddenCapturePrivateEvent> {
  const events =
    projection.audience === 'public'
      ? []
      : projection.audience === 'referee'
        ? [...projection.privateEvents.red, ...projection.privateEvents.black]
        : projection.privateEvents
  const result = new Map<number, JieqiHiddenCapturePrivateEvent>()
  for (const event of events) {
    if (result.has(event.ply)) throw new Error('Duplicate Jieqi private capture event')
    result.set(event.ply, event)
  }
  return result
}

function getRefereeIdentityMap(
  projection: JieqiRecordProjection,
): Map<string, JieqiRefereeIdentity> {
  const result = new Map<string, JieqiRefereeIdentity>()
  if (projection.audience !== 'referee') return result
  for (const identity of projection.referee.initialIdentities) {
    assertPosition(identity.position)
    const key = positionKey(identity.position)
    if (result.has(key)) throw new Error('Duplicate Jieqi referee identity')
    result.set(key, identity)
  }
  return result
}

function assertInitialBoard(board: unknown[][]): void {
  if (board.length !== ROWS || board.some((row) => row.length !== COLS)) {
    throw new Error('Invalid Jieqi public initial board')
  }
}

function assertPosition(position: Position): void {
  if (
    !Number.isInteger(position.row) ||
    !Number.isInteger(position.col) ||
    position.row < 0 ||
    position.row >= ROWS ||
    position.col < 0 ||
    position.col >= COLS
  ) {
    throw new Error('Invalid Jieqi record position')
  }
}

function createFrame(
  ply: number,
  audience: JieqiRecordProjection['audience'],
  turn: PieceColor,
  board: JieqiReplayBoard,
  captured: JieqiReplayCapture[],
): JieqiReplayFrame {
  return {
    ply,
    audience,
    turn,
    board: cloneReplayBoard(board),
    captured: captured.map((item) => ({
      ply: item.ply,
      capturedBy: item.capturedBy,
      color: item.color,
      wasCovered: item.wasCovered,
      visibleType: item.visibleType,
    })),
  }
}

function cloneReplayBoard(board: JieqiReplayBoard): JieqiReplayBoard {
  return board.map((row) =>
    row.map((piece): JieqiReplayPiece | null => {
      if (!piece) return null
      if (piece.state === 'covered') {
        return {
          state: 'covered',
          color: piece.color,
          movementType: piece.movementType,
          identity: piece.identity,
        }
      }
      return {
        state: 'revealed',
        color: piece.color,
        type: piece.type,
      }
    }),
  )
}

/**
 * Converts only the information available in this projection into the rules board.
 * Covered pieces deliberately use their public movement role as a placeholder identity;
 * the rules engine reads `darkType` while covered and ignores covered attackers for check.
 */
function toRulesBoard(board: JieqiReplayBoard): Board {
  return board.map((row) =>
    row.map((piece) => {
      if (!piece) return null
      if (piece.state === 'covered') {
        return {
          color: piece.color,
          type: piece.movementType,
          hidden: true,
          darkType: piece.movementType,
        }
      }
      return { color: piece.color, type: piece.type }
    }),
  )
}

function positionKey(position: Position): string {
  return `${position.row}:${position.col}`
}

function oppositeColor(color: PieceColor): PieceColor {
  return color === 'red' ? 'black' : 'red'
}

export function visibleCapturedTypeAt(
  frames: JieqiReplayFrame[],
  ply: number,
): PieceType | null | undefined {
  return frames[frames.length - 1]?.captured.find((item) => item.ply === ply)?.visibleType
}
