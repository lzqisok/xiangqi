import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  JieqiPublicBoard,
  JieqiPublicProjection,
  JieqiSeatProjection,
} from '../jieqi-record/types'
import { authorizeLanJieqiRecord } from './jieqiRecord'

function projection(audience: 'public' | 'red'): JieqiPublicProjection | JieqiSeatProjection {
  const initialBoard: JieqiPublicBoard = Array.from({ length: 10 }, () =>
    Array.from({ length: 9 }, () => null),
  )
  initialBoard[9][4] = { state: 'revealed', color: 'red', type: 'k' }
  initialBoard[0][3] = { state: 'revealed', color: 'black', type: 'k' }
  initialBoard[6][0] = { state: 'covered', color: 'red', movementType: 'p' }
  const base = {
    kind: 'jieqi-record-projection' as const,
    schemaVersion: 1 as const,
    recordId: `lan:${audience}`,
    name: '局域网揭棋',
    createdAt: 1,
    updatedAt: 2,
    startingTurn: 'red' as const,
    initialBoard,
    events: [
      {
        kind: 'move' as const,
        ply: 1,
        color: 'red' as const,
        from: { row: 6, col: 0 },
        to: { row: 5, col: 0 },
        revealed: 'r' as const,
      },
    ],
  }
  return audience === 'public' ? { ...base, audience } : { ...base, audience, privateEvents: [] }
}

test('LAN record authorization binds public and private projections to the current role', () => {
  const publicRecord = projection('public')
  const redRecord = projection('red')

  assert.equal(authorizeLanJieqiRecord(publicRecord, 'spectator'), publicRecord)
  assert.equal(authorizeLanJieqiRecord(publicRecord, 'owner'), publicRecord)
  assert.equal(authorizeLanJieqiRecord(redRecord, 'red'), redRecord)
  assert.equal(authorizeLanJieqiRecord(redRecord, 'black'), null)
  assert.equal(authorizeLanJieqiRecord(redRecord, 'spectator'), null)
  assert.equal(authorizeLanJieqiRecord(publicRecord, 'red'), null)
  assert.equal(authorizeLanJieqiRecord({ ...redRecord, audience: 'referee' }, 'red'), null)
})

test('LAN record authorization rejects an illegal replay', () => {
  const illegal = structuredClone(projection('public'))
  illegal.events[0].to = { row: 4, col: 0 }
  assert.equal(authorizeLanJieqiRecord(illegal, 'spectator'), null)
})
