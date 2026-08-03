import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCandidatePreview, getCandidatePreviewFrame } from './candidatePreview'
import { MoveCandidate } from '../types'

const INITIAL_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'

const CANDIDATE: MoveCandidate = {
  move: 'h2e2',
  notation: '炮二平五',
  pv: ['h2e2', 'h7e7'],
  pvNotation: ['炮二平五', '砲8平5'],
  score: 12,
  depth: 16,
}

test('buildCandidatePreview replays the full candidate variation', () => {
  const records = buildCandidatePreview(INITIAL_FEN, CANDIDATE)

  assert.equal(records.length, 2)
  assert.equal(records[0].notation, '炮二平五')
  assert.match(records[1].fen, / w /)
})

test('buildCandidatePreview prepends the selected move when PV omits it', () => {
  const records = buildCandidatePreview(INITIAL_FEN, {
    ...CANDIDATE,
    pv: ['h7e7'],
  })

  assert.equal(records.length, 2)
  assert.equal(records[0].notation, '炮二平五')
})

test('getCandidatePreviewFrame clamps navigation without mutating records', () => {
  const records = buildCandidatePreview(INITIAL_FEN, CANDIDATE)
  const initial = getCandidatePreviewFrame(INITIAL_FEN, records, -1)
  const last = getCandidatePreviewFrame(INITIAL_FEN, records, 99)

  assert.equal(initial.notation, '当前局面')
  assert.equal(initial.turn, 'red')
  assert.equal(last.notation.length > 0, true)
  assert.equal(last.turn, 'red')
  assert.equal(records.length, 2)
})
