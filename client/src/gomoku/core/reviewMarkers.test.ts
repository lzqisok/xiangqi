import assert from 'node:assert/strict'
import test from 'node:test'
import { BLACK, WHITE, type Move } from './types'
import { buildMoveOrderMap } from './reviewMarkers'

test('Gomoku review markers preserve the one-based move order on each stone', () => {
  const moves: Move[] = [
    { row: 7, col: 7, player: BLACK },
    { row: 6, col: 7, player: WHITE },
    { row: 7, col: 8, player: BLACK },
  ]

  const markers = buildMoveOrderMap(moves)

  assert.equal(markers.get(7 * 15 + 7), 1)
  assert.equal(markers.get(6 * 15 + 7), 2)
  assert.equal(markers.get(7 * 15 + 8), 3)
})
