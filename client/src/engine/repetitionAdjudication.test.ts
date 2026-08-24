import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMoveRecordsFromUci } from '../share/replayLink.js'
import { analyzeRepetitionCase } from './repetitionAdjudication.js'

const PERPETUAL_CHECK_FEN = '4k4/4R4/9/9/9/9/9/9/9/3K5 b - - 0 1'
const QUIET_CYCLE_FEN = '3k4r/9/9/9/9/9/9/9/9/R3K4 w - - 0 1'

function adjudicate(fen: string, moves: string[]) {
  const analysis = analyzeRepetitionCase(fen, buildMoveRecordsFromUci(fen, moves))
  assert.equal(analysis.kind, 'adjudicated')
  if (analysis.kind !== 'adjudicated') throw new Error('expected adjudication')
  return analysis
}

test('executable corpus makes the only perpetual-checking side lose', () => {
  const analysis = adjudicate(PERPETUAL_CHECK_FEN, [
    'e9f9',
    'e8f8',
    'f9e9',
    'f8e8',
    'e9f9',
    'e8f8',
    'f9e9',
    'f8e8',
  ])

  assert.equal(analysis.outcome, 'black-wins')
  assert.equal(analysis.liableSide, 'red')
  assert.equal(analysis.violation, 'perpetual-check')
  assert.deepEqual(analysis.sides.red.moveKinds, ['check', 'check', 'check', 'check'])
})

test('executable corpus classifies a rook repeatedly chasing the same rook', () => {
  const fen = '5k3/9/9/9/1r7/9/9/9/9/R2K5 w - - 0 1'
  const analysis = adjudicate(fen, [
    'a0b0',
    'b5c5',
    'b0c0',
    'c5b5',
    'c0b0',
    'b5c5',
    'b0c0',
    'c5b5',
    'c0b0',
  ])

  assert.equal(analysis.outcome, 'black-wins')
  assert.equal(analysis.liableSide, 'red')
  assert.equal(analysis.violation, 'perpetual-chase')
  assert.equal(analysis.sides.red.chasedPieceIds.length, 1)
})

test('king-only perpetual chase is an allowed repetition under the CXA exception', () => {
  const fen = '5k3/9/9/9/9/9/9/9/4c4/3K5 w - - 0 1'
  const analysis = adjudicate(fen, [
    'd0e0',
    'e1d1',
    'e0d0',
    'd1e1',
    'd0e0',
    'e1d1',
    'e0d0',
    'd1e1',
  ])

  assert.equal(analysis.outcome, 'draw')
  assert.equal(analysis.sides.red.violation, undefined)
  assert.deepEqual(analysis.sides.red.moveKinds, ['idle', 'idle', 'idle', 'idle'])
})

test('alternate check and chase is attributed to the responsible side', () => {
  const fen = '4k4/4r4/3P5/9/3C5/9/9/9/9/3K5 w - - 0 1'
  const analysis = adjudicate(fen, [
    'd5e5',
    'e8d8',
    'e5d5',
    'd8e8',
    'd5e5',
    'e8d8',
    'e5d5',
    'd8e8',
  ])

  assert.equal(analysis.outcome, 'black-wins')
  assert.equal(analysis.violation, 'check-and-chase')
  assert.deepEqual(analysis.sides.red.moveKinds, ['check', 'chase', 'check', 'chase'])
})

test('quiet repetitions stay draws and use the latest two cycles after a fourth occurrence', () => {
  const cycle = ['a0a1', 'i9i8', 'a1a0', 'i8i9']
  const analysis = adjudicate(QUIET_CYCLE_FEN, [...cycle, ...cycle, ...cycle])

  assert.equal(analysis.occurrences, 4)
  assert.equal(analysis.cycleStartPly, 4)
  assert.equal(analysis.cycleEndPly, 12)
  assert.equal(analysis.outcome, 'draw')
  assert.deepEqual(analysis.sides.red.moveKinds, ['idle', 'idle', 'idle', 'idle'])
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
