import assert from 'node:assert/strict'
import test from 'node:test'
import { buildJieqiRoomProjection } from './jieqiRecord.js'
import type { StoredRoom } from './types.js'

function finishedRoom(): StoredRoom {
  const layout = 'rraabbnnccppppprraabbnnccppppp'
  return {
    schemaVersion: 1,
    id: '00000000-0000-4000-8000-000000000001',
    name: '局域网揭棋隐私记录',
    variant: 'jieqi',
    phase: 'finished',
    revision: 9,
    ownerHash: '0'.repeat(64),
    seats: {},
    initialLayout: layout,
    moves: [
      { uci: 'a3a4', color: 'red', notation: 'SECRET_NOTATION', captured: 'k' },
      { uci: 'c6c5', color: 'black' },
      { uci: 'a4a5', color: 'red' },
      { uci: 'c5c4', color: 'black' },
      { uci: 'a5a6', color: 'red' },
      { uci: 'c4c3', color: 'black' },
    ],
    status: 'draw',
    statusReason: 'agreement',
    createdAt: 100,
    updatedAt: 300,
    startedAt: 150,
    finishedAt: 250,
  }
}

test('finished room emits public and per-seat projections from replayed referee truth', () => {
  const room = finishedRoom()
  const publicRecord = buildJieqiRoomProjection(room, 'public')
  const redRecord = buildJieqiRoomProjection(room, 'red')
  const blackRecord = buildJieqiRoomProjection(room, 'black')

  assert.equal(publicRecord.audience, 'public')
  assert.equal(redRecord.audience, 'red')
  assert.equal(blackRecord.audience, 'black')
  assert.equal(redRecord.privateEvents.length, 1)
  assert.equal(redRecord.privateEvents[0].ply, 5)
  assert.equal(blackRecord.privateEvents.length, 1)
  assert.equal(blackRecord.privateEvents[0].ply, 6)
  assert.deepEqual(publicRecord.events, redRecord.events)
  assert.deepEqual(publicRecord.events, blackRecord.events)
  assert.equal(publicRecord.events[0].revealed, 'r')
  assert.equal(publicRecord.events[0].capture, undefined)
  assert.deepEqual(publicRecord.events[4].capture, { state: 'covered', color: 'black' })
  assert.deepEqual(publicRecord.events[5].capture, { state: 'covered', color: 'red' })

  const publicJson = JSON.stringify(publicRecord)
  assert.equal(publicJson.includes(room.initialLayout!), false)
  assert.equal(publicJson.includes('SECRET_NOTATION'), false)
  assert.equal(publicJson.includes('privateEvents'), false)
  assert.equal(publicJson.includes('capturedType'), false)
  assert.equal(publicJson.includes('referee'), false)
})

test('room record builder rejects illegal persisted moves instead of trusting metadata', () => {
  const room = finishedRoom()
  room.moves[0] = { uci: 'a3a5', color: 'red', revealed: 'r' }
  assert.throws(() => buildJieqiRoomProjection(room, 'public'), /非法着法/)
})
