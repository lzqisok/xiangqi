import assert from 'node:assert/strict'
import test from 'node:test'
import { isStaleEngineResponse, MAX_MOVE_COUNT, parseClientMessage } from './protocol.js'

const VALID_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'

test('parseClientMessage accepts valid move requests', () => {
  const result = parseClientMessage(JSON.stringify({
    type: 'move',
    requestId: 'move-1',
    fen: VALID_FEN,
    moves: ['h2e2'],
    difficulty: 'medium',
    searchMode: 'depth',
    searchDepth: 18,
    searchTimeMs: 2500,
    engineThreads: 'auto',
    engineHashMb: 256,
  }))

  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.message.requestId, 'move-1')
    assert.deepEqual(result.message.moves, ['h2e2'])
    assert.equal(result.message.searchMode, 'depth')
    assert.equal(result.message.searchDepth, 18)
    assert.equal(result.message.searchTimeMs, 2500)
    assert.equal(result.message.engineThreads, 'auto')
    assert.equal(result.message.engineHashMb, 256)
  }
})

test('parseClientMessage accepts candidate requests with bounded count', () => {
  const result = parseClientMessage(JSON.stringify({
    type: 'candidates',
    requestId: 'c1',
    fen: VALID_FEN,
    moves: [],
    count: 3,
  }))

  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.message.count, 3)

  const bad = parseClientMessage(JSON.stringify({
    type: 'candidates',
    requestId: 'c2',
    fen: VALID_FEN,
    count: 9,
  }))
  assert.equal(bad.ok, false)

  const fractional = parseClientMessage(JSON.stringify({
    type: 'candidates',
    requestId: 'c3',
    fen: VALID_FEN,
    count: 1.5,
  }))
  assert.equal(fractional.ok, false)
  if (!fractional.ok) assert.equal(fractional.error, 'count must be an integer between 1 and 5')
})

test('parseClientMessage rejects invalid JSON, missing requestId, and bad FEN', () => {
  assert.deepEqual(parseClientMessage('{'), { ok: false, error: 'Message must be valid JSON' })

  const missingRequest = parseClientMessage(JSON.stringify({ type: 'hint', fen: VALID_FEN }))
  assert.equal(missingRequest.ok, false)
  if (!missingRequest.ok) assert.equal(missingRequest.error, 'requestId is required')

  const badFen = parseClientMessage(JSON.stringify({ type: 'analyze', requestId: 'a1', fen: 'bad fen' }))
  assert.equal(badFen.ok, false)
  if (!badFen.ok) assert.equal(badFen.requestId, 'a1')
})

test('parseClientMessage rejects invalid search limits', () => {
  const badMode = parseClientMessage(JSON.stringify({
    type: 'hint',
    requestId: 'hint-bad-mode',
    fen: VALID_FEN,
    searchMode: 'nodes',
  }))
  assert.equal(badMode.ok, false)
  if (!badMode.ok) assert.equal(badMode.error, 'searchMode is invalid')

  const badDepth = parseClientMessage(JSON.stringify({
    type: 'move',
    requestId: 'move-bad-depth',
    fen: VALID_FEN,
    searchDepth: 40,
  }))
  assert.equal(badDepth.ok, false)
  if (!badDepth.ok) assert.equal(badDepth.error, 'searchDepth must be an integer between 4 and 30')

  const badTime = parseClientMessage(JSON.stringify({
    type: 'candidates',
    requestId: 'candidate-bad-time',
    fen: VALID_FEN,
    searchTimeMs: 20000,
  }))
  assert.equal(badTime.ok, false)
  if (!badTime.ok) assert.equal(badTime.error, 'searchTimeMs must be an integer between 500 and 10000')
})

test('parseClientMessage validates engine runtime options', () => {
  const valid = parseClientMessage(JSON.stringify({
    type: 'init',
    difficulty: 'medium',
    engineThreads: 4,
    engineHashMb: 128,
  }))
  assert.equal(valid.ok, true)
  if (valid.ok) {
    assert.equal(valid.message.engineThreads, 4)
    assert.equal(valid.message.engineHashMb, 128)
  }

  const badThreads = parseClientMessage(JSON.stringify({
    type: 'init',
    difficulty: 'medium',
    engineThreads: 12,
  }))
  assert.equal(badThreads.ok, false)
  if (!badThreads.ok) assert.equal(badThreads.error, 'engineThreads must be "auto" or an integer between 1 and 8')

  const badHash = parseClientMessage(JSON.stringify({
    type: 'init',
    difficulty: 'medium',
    engineHashMb: 8,
  }))
  assert.equal(badHash.ok, false)
  if (!badHash.ok) assert.equal(badHash.error, 'engineHashMb must be an integer between 16 and 512')
})

test('parseClientMessage rejects empty requestId and malformed UCI moves', () => {
  const emptyRequestId = parseClientMessage(JSON.stringify({ type: 'move', requestId: '', fen: VALID_FEN, moves: [] }))
  assert.equal(emptyRequestId.ok, false)
  if (!emptyRequestId.ok) assert.equal(emptyRequestId.error, 'requestId must be a non-empty string')

  const badMoves = parseClientMessage(JSON.stringify({
    type: 'move',
    requestId: 'move-bad',
    fen: VALID_FEN,
    moves: ['h2e2', 'bad'],
  }))
  assert.equal(badMoves.ok, false)
  if (!badMoves.ok) assert.equal(badMoves.error, 'moves must be an array of UCI strings')
})

test('parseClientMessage rejects oversized move lists before replay validation', () => {
  const result = parseClientMessage(JSON.stringify({
    type: 'move',
    requestId: 'move-too-long',
    fen: VALID_FEN,
    moves: Array.from({ length: MAX_MOVE_COUNT + 1 }, () => 'h2e2'),
  }))

  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.requestId, 'move-too-long')
    assert.equal(result.error, `moves must contain at most ${MAX_MOVE_COUNT} items`)
  }
})

test('parseClientMessage rejects UCI move lists that cannot legally replay from FEN', () => {
  const ownPieceCapture = parseClientMessage(JSON.stringify({
    type: 'move',
    requestId: 'move-illegal',
    fen: VALID_FEN,
    moves: ['a0b0'],
  }))

  assert.equal(ownPieceCapture.ok, false)
  if (!ownPieceCapture.ok) {
    assert.equal(ownPieceCapture.requestId, 'move-illegal')
    assert.match(ownPieceCapture.error, /Illegal move/)
  }
})

test('parseClientMessage rejects move lists without a FEN replay base', () => {
  const missingFen = parseClientMessage(JSON.stringify({
    type: 'move',
    requestId: 'move-no-fen',
    moves: ['h2e2'],
  }))

  assert.equal(missingFen.ok, false)
  if (!missingFen.ok) {
    assert.equal(missingFen.requestId, 'move-no-fen')
    assert.equal(missingFen.error, 'fen is required when moves are provided')
  }
})

test('isStaleEngineResponse guards request id, kind, and move history', () => {
  const pending = { id: 'move-1', kind: 'move' as const, movesKey: 'h2e2' }

  assert.equal(isStaleEngineResponse(pending, { requestId: 'move-1', requestKind: 'move' }, 'h2e2'), false)
  assert.equal(isStaleEngineResponse(pending, { requestId: 'move-2', requestKind: 'move' }, 'h2e2'), true)
  assert.equal(isStaleEngineResponse(pending, { requestId: 'move-1', requestKind: 'hint' }, 'h2e2'), true)
  assert.equal(isStaleEngineResponse(pending, { requestId: 'move-1', requestKind: 'move' }, 'h2e2 h9g7'), true)
  assert.equal(isStaleEngineResponse(null, { requestId: 'move-1', requestKind: 'move' }, 'h2e2'), true)
})
