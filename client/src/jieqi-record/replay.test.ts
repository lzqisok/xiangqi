import assert from 'node:assert/strict'
import test from 'node:test'
import { createJieqiInitialBoard } from '../engine/jieqi'
import type { PieceColor, PieceType } from '../types'
import { projectJieqiRecord, separateJieqiInitialBoard } from './projection'
import { buildJieqiReplayFrames, visibleCapturedTypeAt } from './replay'
import type { JieqiHiddenCapturePrivateEvent, JieqiPublicMoveEvent, JieqiRecord } from './types'

test('red, black, and public replays reveal only knowledge available at each ply', () => {
  const record = createRecord()
  const redFrames = buildJieqiReplayFrames(projectJieqiRecord(record, 'red'))
  const blackFrames = buildJieqiReplayFrames(projectJieqiRecord(record, 'black'))
  const publicFrames = buildJieqiReplayFrames(projectJieqiRecord(record, 'public'))
  const refereeFrames = buildJieqiReplayFrames(projectJieqiRecord(record, 'referee'))
  const redCapturedType = record.private.red.events[0].capturedType
  const blackCapturedType = record.private.black.events[0].capturedType

  assert.equal(redFrames.length, 7)
  assert.deepEqual(
    redFrames.map((frame) => frame.turn),
    ['red', 'black', 'red', 'black', 'red', 'black', 'red'],
  )

  const redInitialPiece = redFrames[0].board[6][0]
  const refereeInitialPiece = refereeFrames[0].board[6][0]
  assert.equal(redInitialPiece?.state, 'covered')
  assert.equal(redInitialPiece?.state === 'covered' ? redInitialPiece.identity : 'invalid', null)
  assert.equal(refereeInitialPiece?.state, 'covered')
  assert.equal(
    refereeInitialPiece?.state === 'covered' ? refereeInitialPiece.identity : 'invalid',
    record.referee.initialIdentities.find(
      (identity) => identity.position.row === 6 && identity.position.col === 0,
    )?.type,
  )

  assert.equal(redFrames[0].board[5][0], null)
  assert.equal(redFrames[1].board[6][0], null)
  assert.equal(redFrames[1].board[5][0]?.state, 'revealed')
  assert.equal(
    redFrames[1].board[5][0]?.state === 'revealed' ? redFrames[1].board[5][0]?.type : undefined,
    record.public.events[0].revealed,
  )
  assert.equal(redFrames[0].board[6][0]?.state, 'covered')

  assert.equal(redFrames[4].captured.length, 0)
  assert.equal(visibleCapturedTypeAt(redFrames, 5), redCapturedType)
  assert.equal(visibleCapturedTypeAt(blackFrames, 5), null)
  assert.equal(visibleCapturedTypeAt(publicFrames, 5), null)
  assert.equal(visibleCapturedTypeAt(refereeFrames, 5), redCapturedType)

  assert.equal(visibleCapturedTypeAt(redFrames, 6), null)
  assert.equal(visibleCapturedTypeAt(blackFrames, 6), blackCapturedType)
  assert.equal(visibleCapturedTypeAt(publicFrames, 6), null)
  assert.equal(visibleCapturedTypeAt(refereeFrames, 6), blackCapturedType)

  assert.equal(blackFrames[6].captured.find((capture) => capture.ply === 5)?.visibleType, null)
  assert.equal(redFrames[6].captured.find((capture) => capture.ply === 6)?.visibleType, null)
})

test('replay rejects private events that do not match a covered public capture', () => {
  const record = createRecord()
  record.private.red.events[0].ply = 3
  const projection = projectJieqiRecord(record, 'red')
  assert.throws(
    () => buildJieqiReplayFrames(projection),
    /private capture does not match its public event/,
  )
})

test('replay rejects structurally valid events whose move is illegal', () => {
  const projection = projectJieqiRecord(createRecord(), 'red')
  projection.events[0] = {
    ...projection.events[0],
    to: { row: 4, col: 0 },
  }

  assert.throws(() => buildJieqiReplayFrames(projection), /Illegal Jieqi replay move/)
})

test('serialized public and seat frames contain no unauthorized hidden-capture identities', () => {
  const record = createRecord()
  const publicFrames = buildJieqiReplayFrames(projectJieqiRecord(record, 'public'))
  const redFrames = buildJieqiReplayFrames(projectJieqiRecord(record, 'red'))
  const blackFrames = buildJieqiReplayFrames(projectJieqiRecord(record, 'black'))

  const publicCaptures = publicFrames[publicFrames.length - 1].captured
  const redCaptures = redFrames[redFrames.length - 1].captured
  const blackCaptures = blackFrames[blackFrames.length - 1].captured
  assert.deepEqual(
    publicCaptures.filter((capture) => capture.wasCovered).map((capture) => capture.visibleType),
    [null, null],
  )
  assert.deepEqual(
    redCaptures.filter((capture) => capture.wasCovered).map((capture) => capture.visibleType),
    [record.private.red.events[0].capturedType, null],
  )
  assert.deepEqual(
    blackCaptures.filter((capture) => capture.wasCovered).map((capture) => capture.visibleType),
    [null, record.private.black.events[0].capturedType],
  )

  const publicJson = JSON.stringify(publicFrames)
  assert.equal(publicJson.includes('"identity":"'), false)
  assert.equal(publicJson.includes('"capturedType"'), false)
  assert.equal(publicJson.includes('"referee"'), false)
})

function createRecord(): JieqiRecord {
  const initialBoard = createJieqiInitialBoard(() => 0)
  const { publicBoard, refereeIdentities } = separateJieqiInitialBoard(initialBoard)
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
        move(1, 'red', 6, 0, 5, 0, initialBoard[6][0]!.type),
        move(2, 'black', 3, 2, 4, 2, initialBoard[3][2]!.type),
        move(3, 'red', 5, 0, 4, 0),
        move(4, 'black', 4, 2, 5, 2),
        move(5, 'red', 4, 0, 3, 0, undefined, { state: 'covered', color: 'black' }),
        move(6, 'black', 5, 2, 6, 2, undefined, { state: 'covered', color: 'red' }),
      ],
    },
    private: {
      red: {
        events: [privateCapture(5, 'red', 'black', initialBoard[3][0]!.type)],
      },
      black: {
        events: [privateCapture(6, 'black', 'red', initialBoard[6][2]!.type)],
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
