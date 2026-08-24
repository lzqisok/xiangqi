import assert from 'node:assert/strict'
import test from 'node:test'
import { createJieqiInitialBoard } from '../engine/jieqi'
import type { PieceColor, PieceType } from '../types'
import {
  canReadJieqiRecordScope,
  getJieqiEventScope,
  isJieqiEventVisibleTo,
  projectJieqiRecord,
  separateJieqiInitialBoard,
} from './projection'
import type {
  JieqiHiddenCapturePrivateEvent,
  JieqiPublicMoveEvent,
  JieqiRecord,
  JieqiRecordAudience,
  JieqiRecordScope,
} from './types'

test('public, seat, and referee access use one explicit visibility matrix', () => {
  const expected: Record<JieqiRecordAudience, Record<JieqiRecordScope, boolean>> = {
    public: { public: true, 'red-private': false, 'black-private': false, referee: false },
    red: { public: true, 'red-private': true, 'black-private': false, referee: false },
    black: { public: true, 'red-private': false, 'black-private': true, referee: false },
    referee: { public: true, 'red-private': true, 'black-private': true, referee: true },
  }

  for (const audience of Object.keys(expected) as JieqiRecordAudience[]) {
    for (const scope of Object.keys(expected[audience]) as JieqiRecordScope[]) {
      assert.equal(canReadJieqiRecordScope(audience, scope), expected[audience][scope])
    }
  }

  const publicEvent = createRecord().public.events[0]
  const redPrivateEvent = createRecord().private.red.events[0]
  assert.equal(getJieqiEventScope(publicEvent), 'public')
  assert.equal(getJieqiEventScope(redPrivateEvent), 'red-private')
  assert.equal(isJieqiEventVisibleTo(redPrivateEvent, 'red'), true)
  assert.equal(isJieqiEventVisibleTo(redPrivateEvent, 'black'), false)
  assert.equal(isJieqiEventVisibleTo(redPrivateEvent, 'referee'), true)
})

test('projection is built from field allowlists and never carries another scope secrets', () => {
  const record = createRecord()
  const unsafeRecord = record as JieqiRecord & { debugSecret?: string }
  unsafeRecord.debugSecret = 'ROOT_REFEREE_SECRET'
  ;(record.referee as typeof record.referee & { debugSecret?: string }).debugSecret =
    'REFEREE_LAYOUT_SECRET'
  ;(
    record.private.red.events[0] as JieqiHiddenCapturePrivateEvent & { debugSecret?: string }
  ).debugSecret = 'RED_CAPTURE_SECRET'
  ;(
    record.private.black.events[0] as JieqiHiddenCapturePrivateEvent & { debugSecret?: string }
  ).debugSecret = 'BLACK_CAPTURE_SECRET'
  ;(record.public.events[0] as JieqiPublicMoveEvent & { futureIdentity?: string }).futureIdentity =
    'FUTURE_EVENT_SECRET'
  ;(record.public.events[4] as JieqiPublicMoveEvent & { notation?: string }).notation =
    '兵进一（获R）'

  const publicProjection = projectJieqiRecord(record, 'public')
  const redProjection = projectJieqiRecord(record, 'red')
  const blackProjection = projectJieqiRecord(record, 'black')
  const refereeProjection = projectJieqiRecord(record, 'referee')
  const publicJson = JSON.stringify(publicProjection)
  const redJson = JSON.stringify(redProjection)
  const blackJson = JSON.stringify(blackProjection)

  assert.equal('privateEvents' in publicProjection, false)
  assert.equal('referee' in publicProjection, false)
  assert.deepEqual(
    redProjection.privateEvents.map((event) => event.ply),
    [5],
  )
  assert.deepEqual(
    blackProjection.privateEvents.map((event) => event.ply),
    [6],
  )
  assert.equal('referee' in redProjection, false)
  assert.equal('referee' in blackProjection, false)
  assert.deepEqual(
    refereeProjection.privateEvents.red.map((event) => event.ply),
    [5],
  )
  assert.deepEqual(
    refereeProjection.privateEvents.black.map((event) => event.ply),
    [6],
  )
  assert.equal(refereeProjection.referee.initialIdentities.length, 30)

  assert.equal(publicJson.includes('capturedType'), false)
  assert.equal(publicJson.includes('initialIdentities'), false)
  assert.equal(redJson.includes('"ply":6,"capturedBy":"black"'), false)
  assert.equal(blackJson.includes('"ply":5,"capturedBy":"red"'), false)
  for (const json of [publicJson, redJson, blackJson, JSON.stringify(refereeProjection)]) {
    assert.equal(json.includes('ROOT_REFEREE_SECRET'), false)
    assert.equal(json.includes('REFEREE_LAYOUT_SECRET'), false)
    assert.equal(json.includes('RED_CAPTURE_SECRET'), false)
    assert.equal(json.includes('BLACK_CAPTURE_SECRET'), false)
    assert.equal(json.includes('FUTURE_EVENT_SECRET'), false)
    assert.equal(json.includes('获R'), false)
  }
})

function createRecord(): JieqiRecord {
  const initialBoard = createJieqiInitialBoard(() => 0)
  const { publicBoard, refereeIdentities } = separateJieqiInitialBoard(initialBoard)
  const revealedRed = initialBoard[6][0]!.type
  const revealedBlack = initialBoard[3][2]!.type
  const redCaptured = initialBoard[3][0]!.type
  const blackCaptured = initialBoard[6][2]!.type
  return {
    kind: 'jieqi-record',
    schemaVersion: 1,
    id: 'record-1',
    name: '揭棋隐私回放样例',
    createdAt: 100,
    updatedAt: 200,
    public: {
      startingTurn: 'red',
      initialBoard: publicBoard,
      events: [
        move(1, 'red', 6, 0, 5, 0, revealedRed),
        move(2, 'black', 3, 2, 4, 2, revealedBlack),
        move(3, 'red', 5, 0, 4, 0),
        move(4, 'black', 4, 2, 5, 2),
        move(5, 'red', 4, 0, 3, 0, undefined, { state: 'covered', color: 'black' }),
        move(6, 'black', 5, 2, 6, 2, undefined, { state: 'covered', color: 'red' }),
      ],
    },
    private: {
      red: {
        events: [privateCapture(5, 'red', 'black', redCaptured)],
      },
      black: {
        events: [privateCapture(6, 'black', 'red', blackCaptured)],
      },
    },
    referee: { initialIdentities: refereeIdentities },
  }
}

function move(
  ply: number,
  color: PieceColor,
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number,
  revealed?: PieceType,
  capture?: JieqiPublicMoveEvent['capture'],
): JieqiPublicMoveEvent {
  return {
    kind: 'move',
    ply,
    color,
    from: { row: fromRow, col: fromCol },
    to: { row: toRow, col: toCol },
    revealed,
    capture,
  }
}

function privateCapture(
  ply: number,
  capturedBy: PieceColor,
  capturedColor: PieceColor,
  capturedType: PieceType,
): JieqiHiddenCapturePrivateEvent {
  return { kind: 'hidden-capture', ply, capturedBy, capturedColor, capturedType }
}
