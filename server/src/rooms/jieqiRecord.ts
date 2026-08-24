import { executeRoomMoveFromState, rebuildRoomBoard } from './core.js'
import type {
  JieqiRecordPrivateEvent,
  JieqiRecordPublicEvent,
  JieqiRecordPublicPiece,
  JieqiRoomPublicProjection,
  JieqiRoomSeatProjection,
  RoomBoard,
  RoomColor,
  StoredRoom,
} from './types.js'

const MAX_DATE_TIMESTAMP = 8_640_000_000_000_000

function timestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_DATE_TIMESTAMP) {
    throw new Error(`Invalid Jieqi room ${label}`)
  }
  return value
}

function position(square: string) {
  if (!/^[a-i][0-9]$/.test(square)) throw new Error('Invalid Jieqi room move position')
  return { col: square.charCodeAt(0) - 97, row: 9 - Number(square[1]) }
}

function publicInitialBoard(board: RoomBoard): (JieqiRecordPublicPiece | null)[][] {
  return board.map((row) =>
    row.map((piece) => {
      if (!piece) return null
      if (piece.hidden) {
        return {
          state: 'covered' as const,
          color: piece.color,
          movementType: piece.darkType || piece.type,
        }
      }
      return { state: 'revealed' as const, color: piece.color, type: piece.type }
    }),
  )
}

/**
 * Replays the persisted referee state and emits a field-allowlisted projection.
 * Persisted notation/reveal/capture metadata is deliberately ignored.
 */
export function buildJieqiRoomProjection(
  room: StoredRoom,
  audience: 'public' | RoomColor,
): JieqiRoomPublicProjection | JieqiRoomSeatProjection {
  if (room.variant !== 'jieqi' || room.phase !== 'finished' || !room.initialLayout) {
    throw new Error('Jieqi room projection is available only after a finished game')
  }
  const initial = rebuildRoomBoard('jieqi', room.initialLayout, [])
  let rebuilt = initial
  const canonicalMoves = [] as StoredRoom['moves']
  const events: JieqiRecordPublicEvent[] = []
  const privateEvents: Record<RoomColor, JieqiRecordPrivateEvent[]> = { red: [], black: [] }

  for (const [index, persisted] of room.moves.entries()) {
    const result = executeRoomMoveFromState(
      'jieqi',
      rebuilt,
      canonicalMoves,
      persisted.uci,
      persisted.color,
    )
    const from = position(persisted.uci.slice(0, 2))
    const to = position(persisted.uci.slice(2, 4))
    const event: JieqiRecordPublicEvent = {
      kind: 'move',
      ply: index + 1,
      color: persisted.color,
      from,
      to,
    }
    if (result.revealed) event.revealed = result.revealed
    if (result.captured) {
      event.capture = result.captured.hidden
        ? { state: 'covered', color: result.captured.color }
        : {
            state: 'revealed',
            color: result.captured.color,
            type: result.captured.type,
          }
      if (result.captured.hidden) {
        privateEvents[persisted.color].push({
          kind: 'hidden-capture',
          ply: index + 1,
          capturedBy: persisted.color,
          capturedColor: result.captured.color,
          capturedType: result.captured.type,
        })
      }
    }
    events.push(event)
    canonicalMoves.push(result.move)
    rebuilt = { board: result.board, turn: result.turn }
  }

  const createdAt = timestamp(room.startedAt ?? room.createdAt, 'created timestamp')
  const updatedAt = timestamp(room.finishedAt ?? room.updatedAt, 'updated timestamp')
  if (createdAt > updatedAt) throw new Error('Invalid Jieqi room timestamp order')
  const base = {
    kind: 'jieqi-record-projection' as const,
    schemaVersion: 1 as const,
    recordId: `lan-room:${room.id}:${audience}`,
    name: room.name,
    createdAt,
    updatedAt,
    startingTurn: 'red' as const,
    initialBoard: publicInitialBoard(initial.board),
    events,
  }
  if (audience === 'public') return { ...base, audience }
  return { ...base, audience, privateEvents: privateEvents[audience] }
}
