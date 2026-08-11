import assert from 'node:assert/strict'
import test from 'node:test'
import { isStaleEngineResponse, MAX_MOVE_COUNT, MAX_REVIEW_MOVE_COUNT, parseClientMessage } from './protocol.js'

const VALID_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'
const JIEQI_FEN = 'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P5N2B2r2a2c2p5n2b2 0 1'

test('parseClientMessage validates game lease messages', () => {
  const gameId = '123e4567-e89b-12d3-a456-426614174000'
  const claim = parseClientMessage(JSON.stringify({ type: 'claim-game', requestId: 'lease-1', gameId }))
  assert.equal(claim.ok, true)
  const release = parseClientMessage(JSON.stringify({ type: 'release-game', gameId }))
  assert.equal(release.ok, true)
  assert.equal(parseClientMessage(JSON.stringify({ type: 'takeover-game', gameId })).ok, false)
  assert.equal(parseClientMessage(JSON.stringify({ type: 'claim-game', requestId: 'lease-2', gameId: '../games.json' })).ok, false)
})

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

test('parseClientMessage accepts extended reveal moves for the Jieqi engine only', () => {
  const result = parseClientMessage(JSON.stringify({
    type: 'move',
    requestId: 'jieqi-1',
    variant: 'jieqi',
    fen: JIEQI_FEN,
    moves: ['a3a4N', 'a6a5p'],
    difficulty: 'hard',
  }))

  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.message.variant, 'jieqi')
    assert.deepEqual(result.message.moves, ['a3a4N', 'a6a5p'])
  }

  const standard = parseClientMessage(JSON.stringify({
    type: 'move',
    requestId: 'standard-extended',
    fen: VALID_FEN,
    moves: ['a3a4N'],
  }))
  assert.equal(standard.ok, false)
})

test('parseClientMessage validates Jieqi rank widths, kings, and reserve inventory', () => {
  const request = (fen: string) => parseClientMessage(JSON.stringify({
    type: 'move',
    requestId: 'jieqi-invalid',
    variant: 'jieqi',
    fen,
    moves: [],
  }))

  assert.equal(request('99/9/9/9/9/9/9/9/9/4K4 w R1r1 0 1').ok, false)
  assert.equal(request('xxxx1xxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P5N2B2r2a2c2p5n2b2 0 1').ok, false)
  assert.equal(request('xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R3A1C2P5N2B2r2a2c2p5n2b2 0 1').ok, false)
  assert.equal(request('xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P4N2B2r2a2c2p5n2b2 0 1').ok, false)
  assert.equal(request('1xxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P5N2B2r1a2c2p5n2b2 0 1').ok, false)
  assert.equal(request('xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R1R1A2C2P5N2B2r2a2c2p5n2b2 0 1').ok, false)
  assert.equal(request('xxxx1xxxx/9/1x5x1/x1x1x1x1x/3k5/5K3/X1X1X1X1X/1X5X1/9/XXXX1XXXX w R2A2C2P5N2B2r2a2c2p5n2b2 0 1').ok, false)
})

test('parseClientMessage replays Jieqi moves and validates identity suffixes', () => {
  const request = (moves: string[]) => parseClientMessage(JSON.stringify({
    type: 'move',
    requestId: 'jieqi-replay',
    variant: 'jieqi',
    fen: JIEQI_FEN,
    moves,
  }))

  assert.equal(request(['a0a1R', 'a6a5p']).ok, true)
  assert.equal(request(['a0a9R']).ok, false)
  assert.equal(request(['e0e1r']).ok, false)
  assert.equal(request(['a0a1r']).ok, false)
  assert.equal(request(['a0a1R', 'a6a5P']).ok, false)
})

test('parseClientMessage keeps captured hidden identities scoped to the current viewer', () => {
  const request = (moves: string[]) => parseClientMessage(JSON.stringify({
    type: 'hint',
    requestId: 'jieqi-private-capture',
    variant: 'jieqi',
    fen: JIEQI_FEN,
    moves,
  }))
  const beforeCapture = ['c3c4R', 'a6a5p', 'c4b4', 'c6c5p']

  // After red captures, it is black's turn, so black must not receive the identity.
  assert.equal(request([...beforeCapture, 'b2b7C']).ok, true)
  assert.equal(request([...beforeCapture, 'b2b7Cn']).ok, false)

  // Once black replies and red is the viewer again, red must receive its private capture.
  assert.equal(request([...beforeCapture, 'b2b7Cn', 'a5a4']).ok, true)
  assert.equal(request([...beforeCapture, 'b2b7C', 'a5a4']).ok, false)
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

test('parseClientMessage accepts bounded review requests and requires an id', () => {
  const result = parseClientMessage(JSON.stringify({
    type: 'review',
    requestId: 'review-1',
    fen: VALID_FEN,
    moves: [],
    searchDepth: 12,
  }))
  assert.equal(result.ok, true)

  const missingId = parseClientMessage(JSON.stringify({ type: 'review', fen: VALID_FEN, moves: [] }))
  assert.equal(missingId.ok, false)
  if (!missingId.ok) assert.equal(missingId.error, 'requestId is required')

  const oversized = parseClientMessage(JSON.stringify({
    type: 'review',
    requestId: 'review-long',
    fen: VALID_FEN,
    moves: Array.from({ length: MAX_REVIEW_MOVE_COUNT + 1 }, () => 'h2e2'),
  }))
  assert.equal(oversized.ok, false)
  if (!oversized.ok) assert.equal(oversized.error, `review moves must contain at most ${MAX_REVIEW_MOVE_COUNT} items`)
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
