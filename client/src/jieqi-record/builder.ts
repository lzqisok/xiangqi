import { cloneBoard } from '../engine/board'
import { applyJieqiMove } from '../engine/jieqi'
import { getLegalMoves } from '../engine/rules'
import type { Board, MoveRecord, Piece, PieceColor, Position } from '../types'
import { separateJieqiInitialBoard } from './projection'
import type {
  JieqiHiddenCapturePrivateEvent,
  JieqiPublicCapture,
  JieqiPublicMoveEvent,
  JieqiRecord,
} from './types'

export interface BuildJieqiRecordInput {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  initialBoard: Board
  records: MoveRecord[]
}

/**
 * Converts the trusted full local game state into the three-layer Jieqi record.
 * Ordinary record text, FEN, notes, snapshots, and source fields are never copied.
 */
export function buildJieqiRecord(input: BuildJieqiRecordInput): JieqiRecord {
  assertInitialBoard(input.initialBoard)
  const { publicBoard, refereeIdentities } = separateJieqiInitialBoard(input.initialBoard)
  if (refereeIdentities.length !== 30) {
    throw new Error('Jieqi initial board must contain thirty covered pieces')
  }

  const events: JieqiPublicMoveEvent[] = []
  const privateEvents: Record<PieceColor, JieqiHiddenCapturePrivateEvent[]> = {
    red: [],
    black: [],
  }
  let board = cloneBoard(input.initialBoard)
  let turn: PieceColor = 'red'

  for (let index = 0; index < input.records.length; index++) {
    const source = input.records[index]
    const ply = index + 1
    assertPosition(source.move.from)
    assertPosition(source.move.to)
    const moving = board[source.move.from.row][source.move.from.col]
    const captured = board[source.move.to.row][source.move.to.col]
    if (!moving || moving.color !== turn || !samePiece(moving, source.move.piece)) {
      throw new Error(`Invalid Jieqi moving piece at ply ${ply}`)
    }
    if (!sameOptionalPiece(captured, source.move.captured)) {
      throw new Error(`Invalid Jieqi captured piece at ply ${ply}`)
    }
    const legal = getLegalMoves(board, source.move.from, 'jieqi').some(
      (target) => target.row === source.move.to.row && target.col === source.move.to.col,
    )
    if (!legal) throw new Error(`Illegal Jieqi move at ply ${ply}`)
    const elapsedMs = safeElapsedMs(source.elapsedMs, ply)

    events.push({
      kind: 'move',
      ply,
      color: moving.color,
      from: clonePosition(source.move.from),
      to: clonePosition(source.move.to),
      revealed: moving.hidden ? moving.type : undefined,
      capture: captured ? publicCapture(captured) : undefined,
      elapsedMs,
    })
    if (captured?.hidden) {
      privateEvents[moving.color].push({
        kind: 'hidden-capture',
        ply,
        capturedBy: moving.color,
        capturedColor: captured.color,
        capturedType: captured.type,
      })
    }

    board = applyJieqiMove(board, source.move.from, source.move.to).newBoard
    turn = oppositeColor(turn)
  }

  return {
    kind: 'jieqi-record',
    schemaVersion: 1,
    id: input.id,
    name: input.name,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    public: {
      startingTurn: 'red',
      initialBoard: publicBoard,
      events,
    },
    private: {
      red: { events: privateEvents.red },
      black: { events: privateEvents.black },
    },
    referee: { initialIdentities: refereeIdentities },
  }
}

function publicCapture(piece: Piece): JieqiPublicCapture {
  if (piece.hidden) {
    return {
      state: 'covered',
      color: piece.color,
    }
  }
  return {
    state: 'revealed',
    color: piece.color,
    type: piece.type,
  }
}

function sameOptionalPiece(actual: Piece | null, claimed: Piece | undefined): boolean {
  if (!actual || !claimed) return !actual && !claimed
  return samePiece(actual, claimed)
}

function samePiece(actual: Piece, claimed: Piece): boolean {
  return (
    actual.color === claimed.color &&
    actual.type === claimed.type &&
    Boolean(actual.hidden) === Boolean(claimed.hidden) &&
    actual.darkType === claimed.darkType
  )
}

function safeElapsedMs(elapsedMs: number | undefined, ply: number): number | undefined {
  if (elapsedMs === undefined) return undefined
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new Error(`Invalid Jieqi elapsed time at ply ${ply}`)
  }
  return elapsedMs
}

function assertInitialBoard(board: Board): void {
  if (board.length !== 10 || board.some((row) => row.length !== 9)) {
    throw new Error('Invalid Jieqi initial board')
  }
}

function assertPosition(position: Position): void {
  if (
    !Number.isInteger(position.row) ||
    !Number.isInteger(position.col) ||
    position.row < 0 ||
    position.row >= 10 ||
    position.col < 0 ||
    position.col >= 9
  ) {
    throw new Error('Invalid Jieqi record position')
  }
}

function clonePosition(position: Position): Position {
  return { row: position.row, col: position.col }
}

function oppositeColor(color: PieceColor): PieceColor {
  return color === 'red' ? 'black' : 'red'
}
