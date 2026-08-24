import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMoveRecordsFromUci } from '../share/replayLink.js'
import { analyzeRepetitionCase } from './repetitionAdjudication.js'

const PERPETUAL_CHECK_FEN = '4k4/4R4/9/9/9/9/9/9/9/3K5 b - - 0 1'
const QUIET_CYCLE_FEN = '3k4r/9/9/9/9/9/9/9/9/R3K4 w - - 0 1'

test('executable corpus identifies the only side giving check on every cycle move', () => {
  const records = buildMoveRecordsFromUci(PERPETUAL_CHECK_FEN, [
    'e9f9',
    'e8f8',
    'f9e9',
    'f8e8',
    'e9f9',
    'e8f8',
    'f9e9',
    'f8e8',
  ])

  assert.deepEqual(analyzeRepetitionCase(PERPETUAL_CHECK_FEN, records), {
    kind: 'single-perpetual-check',
    occurrences: 3,
    liableSide: 'red',
    cycleStartPly: 0,
    cycleEndPly: 8,
  })
})

test('executable corpus leaves a legal quiet repetition for chase and idle classification', () => {
  const records = buildMoveRecordsFromUci(QUIET_CYCLE_FEN, [
    'a0a1',
    'i9i8',
    'a1a0',
    'i8i9',
    'a0a1',
    'i9i8',
    'a1a0',
    'i8i9',
  ])

  assert.deepEqual(analyzeRepetitionCase(QUIET_CYCLE_FEN, records), {
    kind: 'requires-chase-classification',
    occurrences: 3,
    checkingSides: [],
    cycleStartPly: 0,
    cycleEndPly: 8,
  })
})

test('fewer than three matching positions never enters adjudication', () => {
  const records = buildMoveRecordsFromUci(PERPETUAL_CHECK_FEN, [
    'e9f9',
    'e8f8',
    'f9e9',
    'f8e8',
  ])
  assert.deepEqual(analyzeRepetitionCase(PERPETUAL_CHECK_FEN, records), {
    kind: 'not-ready',
    occurrences: 2,
  })
})
