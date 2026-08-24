import assert from 'node:assert/strict'
import test from 'node:test'
import type { PieceColor, PieceType } from '../types.js'
import {
  JIEQI_PUBLIC_RECORD_FILE_EXTENSION,
  JIEQI_SEAT_BACKUP_FILE_EXTENSION,
  deleteJieqiSeatRecords,
  exportJieqiPublicRecordJson,
  exportJieqiSeatBackupJson,
  importJieqiSeatBackupJson,
  loadJieqiSeatRecords,
  saveJieqiSeatRecords,
  upsertJieqiSeatRecord,
} from './storage.js'
import type { JieqiPublicBoard, JieqiSeatProjection } from './types.js'

test('red and black seat records round-trip only through the dedicated private backup', () => {
  installStorage(new Map())
  const red = makeSeatProjection('red', 'record-red', 100)
  const black = makeSeatProjection('black', 'record-black', 200)

  upsertJieqiSeatRecord(red)
  const stored = upsertJieqiSeatRecord(black)
  assert.deepEqual(
    stored.map((record) => [record.recordId, record.audience]),
    [
      ['record-black', 'black'],
      ['record-red', 'red'],
    ],
  )

  const backup = exportJieqiSeatBackupJson(stored, 300)
  installStorage(new Map())
  const imported = importJieqiSeatBackupJson(backup)

  assert.deepEqual(imported, stored)
  assert.equal(imported[0].privateEvents[0].capturedType, 'c')
  assert.equal(imported[1].privateEvents[0].capturedType, 'n')
  assert.equal(JIEQI_PUBLIC_RECORD_FILE_EXTENSION, '.jieqi.json')
  assert.equal(JIEQI_SEAT_BACKUP_FILE_EXTENSION, '.jqseat')
})

test('storage deduplicates by recordId, sorts by updatedAt, caps at 200, and deletes', () => {
  installStorage(new Map())
  const records = Array.from({ length: 202 }, (_, index) =>
    makeSeatProjection(index % 2 === 0 ? 'red' : 'black', `record-${index}`, index + 1),
  )
  const refreshed = {
    ...makeSeatProjection('red', 'record-1', 999),
    name: '更新后的本人记录',
  }

  const saved = saveJieqiSeatRecords([...records, refreshed])

  assert.equal(saved.length, 200)
  assert.equal(saved[0].recordId, 'record-1')
  assert.equal(saved[0].name, '更新后的本人记录')
  assert.equal(saved.filter((record) => record.recordId === 'record-1').length, 1)
  assert.ok(
    saved.every((record, index) => index === 0 || saved[index - 1].updatedAt >= record.updatedAt),
  )

  const remaining = deleteJieqiSeatRecords(['record-1', 'record-201'])
  assert.equal(
    remaining.some((record) => record.recordId === 'record-1'),
    false,
  )
  assert.equal(
    remaining.some((record) => record.recordId === 'record-201'),
    false,
  )
})

test('malformed local data falls back safely and semantic corruption is filtered', () => {
  installStorage(new Map([['xiangqi.jieqi-seat-records.v1', '{']]))
  assert.deepEqual(loadJieqiSeatRecords(), [])

  const valid = makeSeatProjection('red', 'valid', 10)
  const invalid = makeSeatProjection('black', 'invalid', 20)
  invalid.privateEvents = []
  installStorage(
    new Map([['xiangqi.jieqi-seat-records.v1', JSON.stringify([invalid, { nope: true }, valid])]]),
  )

  assert.deepEqual(loadJieqiSeatRecords(), [valid])
})

test('storage rejects timestamps that Date cannot safely render', () => {
  installStorage(new Map())
  const invalid = makeSeatProjection('red', 'invalid-date', 10)
  invalid.createdAt = 1e20
  invalid.updatedAt = 1e20

  assert.deepEqual(saveJieqiSeatRecords([invalid]), [])
  assert.deepEqual(loadJieqiSeatRecords(), [])
})

test('private import rejects a structurally valid but illegal move', () => {
  installStorage(new Map())
  const invalid = makeSeatProjection('red', 'illegal-move', 10)
  invalid.events[0].to = { row: 4, col: 0 }
  invalid.initialBoard[4][0] = invalid.initialBoard[5][0]
  invalid.initialBoard[5][0] = null

  assert.throws(
    () =>
      importJieqiSeatBackupJson(
        JSON.stringify({
          kind: 'jieqi-seat-backup',
          schemaVersion: 1,
          exportedAt: 20,
          records: [invalid],
        }),
      ),
    /Invalid Jieqi seat projection/,
  )
})

test('default public export strips seat captures and any injected hidden-identity sentinel', () => {
  const seat = makeSeatProjection('red', 'share-record', 100)
  const sentinel = 'TOP_SECRET_HIDDEN_CAPTURE'
  ;(seat.privateEvents[0] as unknown as Record<string, unknown>).secret = sentinel
  ;(seat as unknown as Record<string, unknown>).referee = {
    initialIdentities: [{ type: sentinel }],
  }

  const json = exportJieqiPublicRecordJson(seat, 300)
  const envelope = JSON.parse(json) as {
    kind: string
    schemaVersion: number
    record: { audience: string }
  }

  assert.equal(envelope.kind, 'jieqi-public-record-export')
  assert.equal(envelope.schemaVersion, 1)
  assert.equal(envelope.record.audience, 'public')
  assert.equal(json.includes('privateEvents'), false)
  assert.equal(json.includes('capturedType'), false)
  assert.equal(json.includes('referee'), false)
  assert.equal(json.includes(sentinel), false)
})

test('private import rejects ordinary payloads and referee projections without changing storage', () => {
  const current = makeSeatProjection('red', 'current', 100)
  const data = new Map<string, string>()
  installStorage(data)
  saveJieqiSeatRecords([current])

  assert.throws(() => importJieqiSeatBackupJson(JSON.stringify([current])), /backup envelope/)

  const referee = {
    ...makeSeatProjection('red', 'referee-record', 200),
    audience: 'referee',
    privateEvents: { red: [], black: [] },
    referee: { initialIdentities: [] },
  }
  assert.throws(
    () =>
      importJieqiSeatBackupJson(
        JSON.stringify({
          kind: 'jieqi-seat-backup',
          schemaVersion: 1,
          exportedAt: 300,
          records: [referee],
        }),
      ),
    /referee records cannot be imported/,
  )
  assert.deepEqual(loadJieqiSeatRecords(), [current])
})

function makeSeatProjection(
  audience: PieceColor,
  recordId: string,
  updatedAt: number,
): JieqiSeatProjection {
  const initialBoard: JieqiPublicBoard = Array.from({ length: 10 }, () =>
    Array.from({ length: 9 }, () => null),
  )
  const isRed = audience === 'red'
  const from = { row: isRed ? 6 : 3, col: 0 }
  const to = { row: isRed ? 5 : 4, col: 0 }
  const capturedColor: PieceColor = isRed ? 'black' : 'red'
  const capturedType: PieceType = isRed ? 'n' : 'c'
  initialBoard[9][4] = { state: 'revealed', color: 'red', type: 'k' }
  initialBoard[0][3] = { state: 'revealed', color: 'black', type: 'k' }
  initialBoard[from.row][from.col] = {
    state: 'covered',
    color: audience,
    movementType: 'p',
  }
  initialBoard[to.row][to.col] = {
    state: 'covered',
    color: capturedColor,
    movementType: 'p',
  }
  return {
    kind: 'jieqi-record-projection',
    schemaVersion: 1,
    recordId,
    name: `${audience} 本人视角`,
    createdAt: updatedAt - 1,
    updatedAt,
    startingTurn: audience,
    initialBoard,
    events: [
      {
        kind: 'move',
        ply: 1,
        color: audience,
        from,
        to,
        revealed: 'r',
        capture: { state: 'covered', color: capturedColor },
      },
    ],
    audience,
    privateEvents: [
      {
        kind: 'hidden-capture',
        ply: 1,
        capturedBy: audience,
        capturedColor,
        capturedType,
      },
    ],
  }
}

function installStorage(data: Map<string, string>): void {
  globalThis.window = {
    localStorage: {
      getItem: (key: string) => data.get(key) || null,
      setItem: (key: string, value: string) => data.set(key, value),
    },
  } as unknown as Window & typeof globalThis
}
