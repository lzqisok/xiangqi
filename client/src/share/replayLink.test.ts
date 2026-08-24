import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMoveRecordsFromUci,
  createReplayUrl,
  MAX_REPLAY_MOVES,
  parseReplayStudyFromSearch,
} from './replayLink'
import { addVariationMove, createVariationTree } from '../variations/tree'

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

test('version 2 replay links preserve the full variation tree and study cover metadata', () => {
  const mainRecords = buildMoveRecordsFromUci(INITIAL_FEN, ['h2e2'])
  let tree = createVariationTree(INITIAL_FEN, mainRecords, 0, 100)
  const [alternative] = buildMoveRecordsFromUci(INITIAL_FEN, ['b2e2'])
  const added = addVariationMove(tree, tree.rootId, alternative, 101)
  tree = added.tree
  tree = {
    ...tree,
    nodes: {
      ...tree.nodes,
      [added.nodeId]: {
        ...tree.nodes[added.nodeId],
        annotations: [
          { id: 'shared-circle', type: 'circle', color: 'blue', from: { row: 7, col: 4 } },
        ],
        analysis: { score: 32, depth: 12, bestMove: 'h9g7', updatedAt: 102 },
      },
    },
  }
  const url = createReplayUrl('http://localhost:5173/study', INITIAL_FEN, mainRecords, 0, {
    variationTree: tree,
    name: '中炮研究',
    description: '保留双方分支',
  })
  const parsed = parseReplayStudyFromSearch(new URL(url).search, 123)

  assert.equal(parsed?.ok, true)
  if (parsed?.ok) {
    assert.equal(parsed.study.name, '中炮研究')
    assert.equal(parsed.study.description, '保留双方分支')
    assert.equal(Object.keys(parsed.study.variationTree?.nodes || {}).length, 3)
    assert.equal(parsed.study.variationTree?.nodes[added.nodeId].annotations?.length, 1)
    assert.equal(parsed.study.variationTree?.nodes[added.nodeId].analysis?.score, 32)
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

test('version 2 replay rejects a structurally linked but illegal branch move', () => {
  const payload = encodeReplayPayload({
    version: 2,
    fen: INITIAL_FEN,
    rootId: 'root',
    currentNodeId: 'child',
    nodes: {
      root: { parentId: null, children: ['child'] },
      child: {
        parentId: 'root',
        children: [],
        move: { uci: 'a0a9' },
      },
    },
  })

  assert.deepEqual(parseReplayStudyFromSearch(`?replay=${payload}`), {
    ok: false,
    error: '回放链接解析失败。',
  })
})
