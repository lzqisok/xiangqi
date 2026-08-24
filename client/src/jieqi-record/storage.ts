import type { PieceColor, PieceType, Position } from '../types'
import { buildJieqiReplayFrames } from './replay'
import type {
  JieqiHiddenCapturePrivateEvent,
  JieqiPublicBoard,
  JieqiPublicCapture,
  JieqiPublicMoveEvent,
  JieqiPublicPiece,
  JieqiPublicProjection,
  JieqiSeatProjection,
} from './types'

const STORAGE_KEY = 'xiangqi.jieqi-seat-records.v1'
const MAX_JIEQI_SEAT_RECORDS = 200
const MAX_JIEQI_RECORD_EVENTS = 2000
const MAX_DATE_TIMESTAMP = 8_640_000_000_000_000
const BOARD_ROWS = 10
const BOARD_COLS = 9
const PIECE_TYPES = new Set<PieceType>(['k', 'a', 'b', 'n', 'r', 'c', 'p'])

export const JIEQI_PUBLIC_RECORD_FILE_EXTENSION = '.jieqi.json'
export const JIEQI_SEAT_BACKUP_FILE_EXTENSION = '.jqseat'

export interface JieqiPublicRecordExportEnvelope {
  kind: 'jieqi-public-record-export'
  schemaVersion: 1
  exportedAt: number
  record: JieqiPublicProjection
}

export interface JieqiSeatBackupEnvelope {
  kind: 'jieqi-seat-backup'
  schemaVersion: 1
  exportedAt: number
  records: JieqiSeatProjection[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isValidTimestamp(value: unknown): value is number {
  return (
    isFiniteNumber(value) &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_DATE_TIMESTAMP
  )
}

function isPieceColor(value: unknown): value is PieceColor {
  return value === 'red' || value === 'black'
}

function isPieceType(value: unknown): value is PieceType {
  return typeof value === 'string' && PIECE_TYPES.has(value as PieceType)
}

function rebuildPosition(value: unknown): Position | null {
  if (!isObject(value)) return null
  const { row, col } = value
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    (row as number) < 0 ||
    (row as number) >= BOARD_ROWS ||
    (col as number) < 0 ||
    (col as number) >= BOARD_COLS
  ) {
    return null
  }
  return { row: row as number, col: col as number }
}

function rebuildPublicPiece(value: unknown): JieqiPublicPiece | null | undefined {
  if (value === null) return null
  if (!isObject(value) || !isPieceColor(value.color)) return undefined
  if (value.state === 'covered' && isPieceType(value.movementType)) {
    return {
      state: 'covered',
      color: value.color,
      movementType: value.movementType,
    }
  }
  if (value.state === 'revealed' && isPieceType(value.type)) {
    return {
      state: 'revealed',
      color: value.color,
      type: value.type,
    }
  }
  return undefined
}

function rebuildPublicBoard(value: unknown): JieqiPublicBoard | null {
  if (!Array.isArray(value) || value.length !== BOARD_ROWS) return null
  const board: JieqiPublicBoard = []
  for (const candidateRow of value) {
    if (!Array.isArray(candidateRow) || candidateRow.length !== BOARD_COLS) return null
    const row: JieqiPublicBoard[number] = []
    for (const candidatePiece of candidateRow) {
      const piece = rebuildPublicPiece(candidatePiece)
      if (piece === undefined) return null
      row.push(piece)
    }
    board.push(row)
  }
  return board
}

function rebuildPublicCapture(value: unknown): JieqiPublicCapture | null {
  if (!isObject(value) || !isPieceColor(value.color)) return null
  if (value.state === 'covered') {
    return { state: 'covered', color: value.color }
  }
  if (value.state === 'revealed' && isPieceType(value.type)) {
    return { state: 'revealed', color: value.color, type: value.type }
  }
  return null
}

function rebuildPublicEvent(value: unknown): JieqiPublicMoveEvent | null {
  if (
    !isObject(value) ||
    value.kind !== 'move' ||
    !Number.isInteger(value.ply) ||
    (value.ply as number) <= 0 ||
    !isPieceColor(value.color)
  ) {
    return null
  }
  const from = rebuildPosition(value.from)
  const to = rebuildPosition(value.to)
  if (!from || !to) return null
  if (value.revealed !== undefined && !isPieceType(value.revealed)) return null
  const capture = value.capture === undefined ? undefined : rebuildPublicCapture(value.capture)
  if (capture === null) return null
  if (value.elapsedMs !== undefined && (!isFiniteNumber(value.elapsedMs) || value.elapsedMs < 0)) {
    return null
  }
  const event: JieqiPublicMoveEvent = {
    kind: 'move',
    ply: value.ply as number,
    color: value.color,
    from,
    to,
  }
  if (value.revealed !== undefined) event.revealed = value.revealed as PieceType
  if (capture !== undefined) event.capture = capture
  if (value.elapsedMs !== undefined) event.elapsedMs = value.elapsedMs as number
  return event
}

function rebuildPrivateEvent(value: unknown): JieqiHiddenCapturePrivateEvent | null {
  if (
    !isObject(value) ||
    value.kind !== 'hidden-capture' ||
    !Number.isInteger(value.ply) ||
    (value.ply as number) <= 0 ||
    !isPieceColor(value.capturedBy) ||
    !isPieceColor(value.capturedColor) ||
    !isPieceType(value.capturedType)
  ) {
    return null
  }
  return {
    kind: 'hidden-capture',
    ply: value.ply as number,
    capturedBy: value.capturedBy,
    capturedColor: value.capturedColor,
    capturedType: value.capturedType,
  }
}

/**
 * Reconstructs a seat projection from an explicit field allow-list, then replays it to
 * reject structurally valid but semantically inconsistent records.
 */
function rebuildSeatProjection(value: unknown): JieqiSeatProjection | null {
  if (
    !isObject(value) ||
    value.kind !== 'jieqi-record-projection' ||
    value.schemaVersion !== 1 ||
    !isPieceColor(value.audience) ||
    typeof value.recordId !== 'string' ||
    value.recordId.length === 0 ||
    value.recordId.length > 200 ||
    typeof value.name !== 'string' ||
    value.name.trim().length === 0 ||
    value.name.length > 100 ||
    !isValidTimestamp(value.createdAt) ||
    !isValidTimestamp(value.updatedAt) ||
    value.createdAt > value.updatedAt ||
    !isPieceColor(value.startingTurn) ||
    !Array.isArray(value.events) ||
    value.events.length > MAX_JIEQI_RECORD_EVENTS ||
    !Array.isArray(value.privateEvents) ||
    value.privateEvents.length > MAX_JIEQI_RECORD_EVENTS
  ) {
    return null
  }
  const initialBoard = rebuildPublicBoard(value.initialBoard)
  const events = value.events.map(rebuildPublicEvent)
  const privateEvents = value.privateEvents.map(rebuildPrivateEvent)
  if (
    !initialBoard ||
    events.some((event) => event === null) ||
    privateEvents.some((event) => event === null)
  ) {
    return null
  }
  const projection: JieqiSeatProjection = {
    kind: 'jieqi-record-projection',
    schemaVersion: 1,
    recordId: value.recordId,
    name: value.name,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    startingTurn: value.startingTurn,
    initialBoard,
    events: events as JieqiPublicMoveEvent[],
    audience: value.audience,
    privateEvents: privateEvents as JieqiHiddenCapturePrivateEvent[],
  }
  try {
    buildJieqiReplayFrames(projection)
    return projection
  } catch {
    return null
  }
}

function requireSeatProjection(value: unknown): JieqiSeatProjection {
  const projection = rebuildSeatProjection(value)
  if (!projection) throw new Error('Invalid Jieqi seat projection')
  return projection
}

function normalizeRecords(records: readonly unknown[]): JieqiSeatProjection[] {
  const recordsById = new Map<string, JieqiSeatProjection>()
  for (const value of records) {
    const record = rebuildSeatProjection(value)
    if (!record) continue
    const existing = recordsById.get(record.recordId)
    if (!existing || record.updatedAt >= existing.updatedAt) {
      recordsById.set(record.recordId, record)
    }
  }
  return [...recordsById.values()]
    .sort(
      (left, right) =>
        right.updatedAt - left.updatedAt || left.recordId.localeCompare(right.recordId),
    )
    .slice(0, MAX_JIEQI_SEAT_RECORDS)
}

export function loadJieqiSeatRecords(): JieqiSeatProjection[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? normalizeRecords(parsed) : []
  } catch {
    return []
  }
}

export function saveJieqiSeatRecords(
  records: readonly JieqiSeatProjection[],
): JieqiSeatProjection[] {
  const normalized = normalizeRecords(records)
  if (typeof window === 'undefined') return normalized
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  } catch {
    // A full or unavailable localStorage must not break the finished-game screen.
  }
  return normalized
}

export function upsertJieqiSeatRecord(record: JieqiSeatProjection): JieqiSeatProjection[] {
  const rebuilt = requireSeatProjection(record)
  return saveJieqiSeatRecords([...loadJieqiSeatRecords(), rebuilt])
}

export function deleteJieqiSeatRecords(recordIds: readonly string[]): JieqiSeatProjection[] {
  const selected = new Set(recordIds)
  return saveJieqiSeatRecords(
    loadJieqiSeatRecords().filter((record) => !selected.has(record.recordId)),
  )
}

function rebuildPublicProjection(record: JieqiSeatProjection): JieqiPublicProjection {
  const seat = requireSeatProjection(record)
  const projection: JieqiPublicProjection = {
    kind: 'jieqi-record-projection',
    schemaVersion: 1,
    recordId: seat.recordId,
    name: seat.name,
    createdAt: seat.createdAt,
    updatedAt: seat.updatedAt,
    startingTurn: seat.startingTurn,
    initialBoard: seat.initialBoard,
    events: seat.events,
    audience: 'public',
  }
  buildJieqiReplayFrames(projection)
  return projection
}

/** Default share/export format. It deliberately has no seat-private event field. */
export function exportJieqiPublicRecordJson(
  record: JieqiSeatProjection,
  exportedAt = Date.now(),
): string {
  const envelope: JieqiPublicRecordExportEnvelope = {
    kind: 'jieqi-public-record-export',
    schemaVersion: 1,
    exportedAt,
    record: rebuildPublicProjection(record),
  }
  return JSON.stringify(envelope, null, 2)
}

/** Explicit private backup format; callers should require a second confirmation before download. */
export function exportJieqiSeatBackupJson(
  records: readonly JieqiSeatProjection[] = loadJieqiSeatRecords(),
  exportedAt = Date.now(),
): string {
  const rebuilt = records.map(requireSeatProjection)
  const envelope: JieqiSeatBackupEnvelope = {
    kind: 'jieqi-seat-backup',
    schemaVersion: 1,
    exportedAt,
    records: normalizeRecords(rebuilt),
  }
  return JSON.stringify(envelope, null, 2)
}

/** Imports only the dedicated private envelope and never accepts a public or referee projection. */
export function importJieqiSeatBackupJson(raw: string): JieqiSeatProjection[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new Error('Invalid Jieqi seat backup JSON')
  }
  if (
    !isObject(parsed) ||
    parsed.kind !== 'jieqi-seat-backup' ||
    parsed.schemaVersion !== 1 ||
    !isValidTimestamp(parsed.exportedAt) ||
    !Array.isArray(parsed.records) ||
    parsed.records.length > MAX_JIEQI_SEAT_RECORDS
  ) {
    throw new Error('Invalid Jieqi seat backup envelope')
  }
  const imported = parsed.records.map((candidate) => {
    if (isObject(candidate) && (candidate.audience === 'referee' || 'referee' in candidate)) {
      throw new Error('Jieqi referee records cannot be imported as seat backups')
    }
    return requireSeatProjection(candidate)
  })
  return saveJieqiSeatRecords([...loadJieqiSeatRecords(), ...imported])
}
