import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMoveRecordsFromUci,
  createReplayUrl,
  MAX_REPLAY_MOVES,
  parseReplayStudyFromSearch,
} from './replayLink'

const INITIAL_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'

function encodeReplayPayload(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

test('buildMoveRecordsFromUci replays legal UCI moves into records', () => {
  const records = buildMoveRecordsFromUci(INITIAL_FEN, ['h2e2'])

  assert.equal(records.length, 1)
  assert.equal(records[0].notation.length > 0, true)
  assert.match(records[0].fen, / b /)
})

test('createReplayUrl and parseReplayStudyFromSearch roundtrip replay data', () => {
  const records = buildMoveRecordsFromUci(INITIAL_FEN, ['h2e2'])
  const url = createReplayUrl('http://localhost:5173/study', INITIAL_FEN, records, 0)
  const parsed = parseReplayStudyFromSearch(new URL(url).search, 123)

  assert.equal(parsed?.ok, true)
  if (parsed?.ok) {
    assert.equal(parsed.study.id, 'shared-replay-123')
    assert.equal(parsed.study.initialFen, INITIAL_FEN)
    assert.equal(parsed.study.moves.length, 1)
    assert.equal(parsed.study.currentMoveIndex, 0)
  }
})

test('parseReplayStudyFromSearch reports invalid payloads without throwing', () => {
  const parsed = parseReplayStudyFromSearch('?replay=bad')

  assert.deepEqual(parsed, { ok: false, error: '回放链接解析失败。' })
})

test('parseReplayStudyFromSearch rejects oversized move arrays before replaying records', () => {
  const payload = encodeReplayPayload({
    fen: INITIAL_FEN,
    moves: Array.from({ length: MAX_REPLAY_MOVES + 1 }, () => 'a0a1'),
    currentMoveIndex: 0,
  })
  const parsed = parseReplayStudyFromSearch(`?replay=${payload}`)

  assert.deepEqual(parsed, {
    ok: false,
    error: `回放链接最多支持 ${MAX_REPLAY_MOVES} 手。`,
  })
})
