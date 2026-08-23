import assert from 'node:assert/strict'
import test from 'node:test'
import { INITIAL_FEN } from '../engine/board.js'
import { buildMoveRecordsFromUci } from '../share/replayLink.js'
import { addVariationMove, createVariationTree, setVariationAnalysis } from './tree.js'
import { buildBranchComparison, scoreToRedWinRate } from './comparison.js'

test('scoreToRedWinRate is symmetric and bounded', () => {
  assert.equal(scoreToRedWinRate(0), 50)
  assert.equal(scoreToRedWinRate(2000), 100)
  assert.equal(scoreToRedWinRate(-2000), 0)
  assert.equal(scoreToRedWinRate(120) + scoreToRedWinRate(-120), 100)
})

test('branch comparison keeps node identity and ranks the largest analyzed divergence', () => {
  const main = buildMoveRecordsFromUci(INITIAL_FEN, ['h2e2', 'h7e7', 'h0g2'])
  const branchMoves = buildMoveRecordsFromUci(main[0].fen, ['b7e7', 'b0c2'])
  let tree = createVariationTree(INITIAL_FEN, main, 0, 1)
  const branch = addVariationMove(tree, 'variation-node-1', branchMoves[0], 2)
  const branchLeaf = addVariationMove(branch.tree, branch.nodeId, branchMoves[1], 3)
  tree = branchLeaf.tree
  tree = setVariationAnalysis(tree, 'variation-node-2', {
    score: 20,
    depth: 16,
    pv: ['h0g2'],
    updatedAt: 4,
  })
  tree = setVariationAnalysis(tree, 'variation-node-3', {
    score: 180,
    depth: 16,
    updatedAt: 5,
  })
  tree = setVariationAnalysis(tree, branch.nodeId, {
    score: -40,
    depth: 16,
    pv: ['b0c2'],
    updatedAt: 6,
  })
  tree = setVariationAnalysis(tree, branchLeaf.nodeId, {
    score: -220,
    depth: 16,
    updatedAt: 7,
  })

  const comparison = buildBranchComparison(
    tree,
    'variation-node-1',
    'variation-node-2',
    branch.nodeId,
  )

  assert.ok(comparison)
  assert.equal(comparison.left.isMain, true)
  assert.equal(comparison.right.isMain, false)
  assert.equal(comparison.left.latest?.nodeId, 'variation-node-3')
  assert.equal(comparison.right.latest?.nodeId, branchLeaf.nodeId)
  assert.equal(comparison.keyPoints[0].offset, 2)
  assert.equal(comparison.keyPoints[0].scoreDelta, 400)
  assert.deepEqual(comparison.keyPoints[1].left.recommendedLine, ['马二进三'])
})
