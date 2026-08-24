import assert from 'node:assert/strict'
import test from 'node:test'
import { INITIAL_FEN } from '../engine/board.js'
import { buildMoveRecordsFromUci } from '../share/replayLink.js'
import { identifyOpening, OPENING_CATALOG } from './catalog.js'

test('every bundled opening line is legal and matches its deepest named position', () => {
  for (const opening of OPENING_CATALOG) {
    const records = buildMoveRecordsFromUci(INITIAL_FEN, opening.moves)
    assert.equal(identifyOpening(INITIAL_FEN, records)?.id, opening.id)
  }
})

test('opening recognition remains attached after the line leaves the small catalog', () => {
  const records = buildMoveRecordsFromUci(INITIAL_FEN, ['h2e2', 'h9g7', 'h0g2', 'b9c7', 'i3i4'])
  const match = identifyOpening(INITIAL_FEN, records)

  assert.equal(match?.name, '中炮对屏风马')
  assert.equal(match?.matchedPly, 4)
})

test('custom FEN studies do not receive a misleading standard-opening name', () => {
  assert.equal(identifyOpening('4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1', []), null)
})
