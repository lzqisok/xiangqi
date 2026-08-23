import assert from 'node:assert/strict'
import test from 'node:test'
import { INITIAL_FEN } from '../engine/board.js'
import { buildMoveRecordsFromUci } from '../share/replayLink.js'
import {
  addVariationMove,
  buildNodeAnalysisTaskEntries,
  clearVariationAnalysis,
  countVariationBranches,
  createVariationTree,
  deleteVariationBranch,
  deriveAnalysisPoints,
  getNodeIdAtMoveIndex,
  getVariationLine,
  hasReusableNodeAnalysis,
  migrateAnalysisPointsToTree,
  nodeAnalysisSignature,
  selectVariationNode,
  setMainVariation,
  setVariationAnalysis,
  shouldAcceptAnalysisInfo,
  shouldAcceptNodeAnalysisTaskEntry,
  updateVariationAnnotations,
} from './tree.js'

test('linear records migrate to a main variation without changing replay order', () => {
  const records = buildMoveRecordsFromUci(INITIAL_FEN, ['h2e2', 'h7e7'])
  const tree = createVariationTree(INITIAL_FEN, records, 0, 1)
  const line = getVariationLine(tree)

  assert.deepEqual(
    line.records.map((record) => record.notation),
    records.map((record) => record.notation),
  )
  assert.equal(line.currentMoveIndex, 0)
  assert.equal(tree.nodes[tree.rootId].mainChildId, 'variation-node-1')
})

test('adding a move after undo preserves the old continuation as main line', () => {
  const records = buildMoveRecordsFromUci(INITIAL_FEN, ['h2e2', 'h7e7'])
  const alternative = buildMoveRecordsFromUci(records[0].fen, ['b7e7'])[0]
  const original = createVariationTree(INITIAL_FEN, records, 0, 1)
  const parentId = 'variation-node-1'
  const added = addVariationMove(original, parentId, alternative, 2)

  assert.equal(added.created, true)
  assert.equal(added.tree.nodes[parentId].children.length, 2)
  assert.equal(added.tree.nodes[parentId].mainChildId, 'variation-node-2')
  assert.equal(countVariationBranches(added.tree), 1)
  assert.equal(getVariationLine(added.tree).records[1].notation, alternative.notation)
})

test('selecting and promoting a branch changes the derived main continuation', () => {
  const records = buildMoveRecordsFromUci(INITIAL_FEN, ['h2e2', 'h7e7'])
  const alternative = buildMoveRecordsFromUci(records[0].fen, ['b7e7'])[0]
  const base = createVariationTree(INITIAL_FEN, records, 0, 1)
  const added = addVariationMove(base, 'variation-node-1', alternative, 2)
  const analyzed = setVariationAnalysis(added.tree, added.nodeId, {
    complete: true,
    score: 45,
    depth: 16,
    updatedAt: 2,
  })
  const selected = selectVariationNode(analyzed, added.nodeId)
  const promoted = setMainVariation(selected, 'variation-node-1', added.nodeId, 3)
  const parentSelected = selectVariationNode(promoted, 'variation-node-1')

  assert.equal(getVariationLine(parentSelected).records[1].notation, alternative.notation)
  assert.equal(promoted.nodes[added.nodeId].id, added.nodeId)
  assert.equal(promoted.nodes[added.nodeId].analysis?.score, 45)
})

test('deleting a branch removes its descendants and node analysis without changing sibling ids', () => {
  const records = buildMoveRecordsFromUci(INITIAL_FEN, ['h2e2', 'h7e7'])
  const alternativeRecords = buildMoveRecordsFromUci(records[0].fen, ['b7e7', 'b0c2'])
  const base = createVariationTree(INITIAL_FEN, records, 1, 1)
  const branch = addVariationMove(base, 'variation-node-1', alternativeRecords[0], 2)
  const leaf = addVariationMove(branch.tree, branch.nodeId, alternativeRecords[1], 3)
  const analyzed = setVariationAnalysis(
    leaf.tree,
    leaf.nodeId,
    { score: 80, depth: 16, updatedAt: 4 },
    4,
  )
  const selected = selectVariationNode(analyzed, leaf.nodeId)

  const deleted = deleteVariationBranch(selected, branch.nodeId, 5)

  assert.equal(deleted.nodes[branch.nodeId], undefined)
  assert.equal(deleted.nodes[leaf.nodeId], undefined)
  assert.equal(deleted.currentNodeId, 'variation-node-1')
  assert.deepEqual(deleted.nodes['variation-node-1'].children, ['variation-node-2'])
  assert.equal(deleted.nodes['variation-node-1'].mainChildId, 'variation-node-2')
  assert.equal(deleted.nodes['variation-node-2'].id, 'variation-node-2')
})

test('deleting the main branch promotes the next surviving child', () => {
  const records = buildMoveRecordsFromUci(INITIAL_FEN, ['h2e2', 'h7e7'])
  const alternative = buildMoveRecordsFromUci(records[0].fen, ['b7e7'])[0]
  const base = createVariationTree(INITIAL_FEN, records, 0, 1)
  const added = addVariationMove(base, 'variation-node-1', alternative, 2)

  const deleted = deleteVariationBranch(added.tree, 'variation-node-2', 3)

  assert.deepEqual(deleted.nodes['variation-node-1'].children, [added.nodeId])
  assert.equal(deleted.nodes['variation-node-1'].mainChildId, added.nodeId)
})

test('annotations stay scoped to their variation node', () => {
  const records = buildMoveRecordsFromUci(INITIAL_FEN, ['h2e2', 'h7e7'])
  const base = createVariationTree(INITIAL_FEN, records, 0, 1)
  const annotation = {
    id: 'mark-1',
    type: 'arrow' as const,
    color: 'red' as const,
    from: { row: 9, col: 7 },
    to: { row: 7, col: 7 },
  }
  const updated = updateVariationAnnotations(base, 'variation-node-1', [annotation], 2)

  assert.deepEqual(updated.nodes['variation-node-1'].annotations, [annotation])
  assert.equal(updated.nodes[base.rootId].annotations, undefined)
  assert.equal(base.nodes['variation-node-1'].annotations, undefined)
  assert.equal(updated.nodes['variation-node-1'].updatedAt, 2)
  assert.equal(
    updateVariationAnnotations(updated, 'variation-node-1', [], 3).nodes['variation-node-1']
      .annotations,
    undefined,
  )
})

test('analysis attaches to its node and clearing removes only that node', () => {
  const records = buildMoveRecordsFromUci(INITIAL_FEN, ['h2e2', 'h7e7'])
  const base = createVariationTree(INITIAL_FEN, records, 0, 1)
  const analysis = {
    score: 32,
    depth: 12,
    bestMove: 'h2e2',
    pv: ['h2e2', 'h7e7'],
    searchLimit: { searchMode: 'depth' as const, searchDepth: 12 },
    engineThreads: 4,
    engineHashMb: 128,
    updatedAt: 2,
  }
  const updated = setVariationAnalysis(base, 'variation-node-1', analysis, 2)

  assert.deepEqual(updated.nodes['variation-node-1'].analysis, analysis)
  assert.equal(updated.nodes['variation-node-1'].updatedAt, 2)
  assert.equal(base.nodes['variation-node-1'].analysis, undefined)
  assert.equal(updated.nodes[base.rootId].analysis, undefined)
  assert.deepEqual(updated.nodes['variation-node-2'].analysis, undefined)

  const cleared = clearVariationAnalysis(updated, 'variation-node-1', 3)
  assert.equal(cleared.nodes['variation-node-1'].analysis, undefined)
  assert.equal(cleared.nodes['variation-node-1'].updatedAt, 3)
})

test('node analysis signature covers search limit and engine options', () => {
  const depthLimit = { searchMode: 'depth' as const, searchDepth: 12 }
  const timeLimit = { searchMode: 'time' as const, searchTimeMs: 3000 }

  assert.equal(nodeAnalysisSignature(depthLimit, 4, 128), nodeAnalysisSignature(depthLimit, 4, 128))
  assert.notEqual(
    nodeAnalysisSignature(depthLimit, 4, 128),
    nodeAnalysisSignature(depthLimit, 8, 128),
  )
  assert.notEqual(
    nodeAnalysisSignature(depthLimit, 4, 128),
    nodeAnalysisSignature({ searchMode: 'depth' as const, searchDepth: 14 }, 4, 128),
  )
  assert.notEqual(
    nodeAnalysisSignature(depthLimit, 4, 128),
    nodeAnalysisSignature(timeLimit, 4, 128),
  )
  assert.notEqual(
    nodeAnalysisSignature({ ...timeLimit, searchDepth: 18 }, 4, 128),
    nodeAnalysisSignature({ ...timeLimit, searchDepth: 18, searchTimeMs: 4000 }, 4, 128),
  )
})

test('reusable analysis requires the same search and runtime configuration', () => {
  const analysis = {
    complete: true,
    score: 12,
    depth: 18,
    searchLimit: { searchMode: 'depth' as const, searchDepth: 18 },
    engineThreads: 2 as const,
    engineHashMb: 128,
    updatedAt: 1,
  }
  assert.equal(
    hasReusableNodeAnalysis(analysis, { searchMode: 'depth', searchDepth: 18 }, 2, 128),
    true,
  )
  assert.equal(
    hasReusableNodeAnalysis(analysis, { searchMode: 'depth', searchDepth: 20 }, 2, 128),
    false,
  )
})

test('finite analysis task snapshots keep node ids bound to exact history signatures', () => {
  const records = buildMoveRecordsFromUci(INITIAL_FEN, ['h2e2', 'h7e7'])
  const alternative = buildMoveRecordsFromUci(records[0].fen, ['b7e7'])[0]
  const base = createVariationTree(INITIAL_FEN, records, 1, 1)
  const branched = addVariationMove(base, 'variation-node-1', alternative, 2).tree
  const mainEntries = buildNodeAnalysisTaskEntries(branched, [
    branched.rootId,
    'variation-node-1',
    'variation-node-2',
  ])

  assert.deepEqual(
    mainEntries.map(({ nodeId, moveIndex, movesKey }) => ({ nodeId, moveIndex, movesKey })),
    [
      { nodeId: branched.rootId, moveIndex: -1, movesKey: '' },
      { nodeId: 'variation-node-1', moveIndex: 0, movesKey: 'h2e2' },
      { nodeId: 'variation-node-2', moveIndex: 1, movesKey: 'h2e2 h7e7' },
    ],
  )
  assert.equal(shouldAcceptNodeAnalysisTaskEntry(branched, mainEntries[2]), true)

  const changedNode = {
    ...branched.nodes['variation-node-2'],
    move: alternative,
    fen: alternative.fen,
  }
  const changed = {
    ...branched,
    nodes: { ...branched.nodes, 'variation-node-2': changedNode },
  }
  assert.equal(shouldAcceptNodeAnalysisTaskEntry(changed, mainEntries[2]), false)
})

test('legacy analysis points migrate onto their nodes by line index', () => {
  const records = buildMoveRecordsFromUci(INITIAL_FEN, ['h2e2', 'h7e7'])
  const base = createVariationTree(INITIAL_FEN, records, 1, 1)
  const migrated = migrateAnalysisPointsToTree(base, [
    { moveIndex: 0, evaluation: 12, depth: 10 },
    { moveIndex: 1, evaluation: -8, depth: 11 },
  ])

  assert.equal(migrated.nodes['variation-node-1'].analysis?.score, 12)
  assert.equal(migrated.nodes['variation-node-1'].analysis?.depth, 10)
  assert.equal(migrated.nodes['variation-node-2'].analysis?.score, -8)
  assert.equal(migrated.nodes['variation-node-2'].analysis?.updatedAt, 0)
  assert.equal(migrated.nodes[base.rootId].analysis, undefined)
  // 节点结构保持不变,仅增加分析。
  assert.equal(migrated.nodes['variation-node-1'].fen, records[0].fen)
})

test('migration never overwrites existing node analysis', () => {
  const records = buildMoveRecordsFromUci(INITIAL_FEN, ['h2e2', 'h7e7'])
  const base = createVariationTree(INITIAL_FEN, records, 0, 1)
  const existing = { score: 42, depth: 14, updatedAt: 5 }
  const withAnalysis = setVariationAnalysis(base, 'variation-node-1', existing, 5)
  const migrated = migrateAnalysisPointsToTree(withAnalysis, [
    { moveIndex: 0, evaluation: 12, depth: 10 },
  ])

  assert.equal(migrated.nodes['variation-node-1'].analysis?.score, 42)
  assert.equal(migrated.nodes['variation-node-1'].analysis?.updatedAt, 5)
})

test('derived analysis points follow the active line and skip unanalyzed nodes', () => {
  const records = buildMoveRecordsFromUci(INITIAL_FEN, ['h2e2', 'h7e7'])
  const base = createVariationTree(INITIAL_FEN, records, 1, 1)
  const analyzed = setVariationAnalysis(
    setVariationAnalysis(base, 'variation-node-1', { score: 12, depth: 10, updatedAt: 2 }, 2),
    'variation-node-2',
    { score: -8, depth: 11, updatedAt: 3 },
    3,
  )
  const line = getVariationLine(analyzed)

  assert.deepEqual(deriveAnalysisPoints(analyzed, line.nodeIds), [
    { moveIndex: 0, evaluation: 12, depth: 10 },
    { moveIndex: 1, evaluation: -8, depth: 11 },
  ])

  const partial = setVariationAnalysis(
    base,
    'variation-node-2',
    { score: 30, depth: 9, updatedAt: 2 },
    2,
  )
  const partialLine = getVariationLine(partial)
  assert.deepEqual(deriveAnalysisPoints(partial, partialLine.nodeIds), [
    { moveIndex: 1, evaluation: 30, depth: 9 },
  ])
})

test('move index maps to node ids with -1 as the root', () => {
  const records = buildMoveRecordsFromUci(INITIAL_FEN, ['h2e2', 'h7e7'])
  const tree = createVariationTree(INITIAL_FEN, records, 1, 1)
  const line = getVariationLine(tree)

  assert.equal(getNodeIdAtMoveIndex(tree, line.nodeIds, -1), tree.rootId)
  assert.equal(getNodeIdAtMoveIndex(tree, line.nodeIds, 0), 'variation-node-1')
  assert.equal(getNodeIdAtMoveIndex(tree, line.nodeIds, 1), 'variation-node-2')
  assert.equal(getNodeIdAtMoveIndex(tree, line.nodeIds, 5), null)
})

test('only -1 maps to the root and other negatives are rejected', () => {
  const records = buildMoveRecordsFromUci(INITIAL_FEN, ['h2e2', 'h7e7'])
  const tree = createVariationTree(INITIAL_FEN, records, 1, 1)
  const line = getVariationLine(tree)

  // 旧版 analysisPoints 只校验数组,可能含有非 -1 的非法负数索引。
  // 它们不应被当作根节点索引处理,避免错误写入根节点分析。
  assert.equal(getNodeIdAtMoveIndex(tree, line.nodeIds, -2), null)
  assert.equal(getNodeIdAtMoveIndex(tree, line.nodeIds, -99), null)
})

test('root analysis migrates from moveIndex -1 and appears first in the derived curve', () => {
  const records = buildMoveRecordsFromUci(INITIAL_FEN, ['h2e2'])
  const base = createVariationTree(INITIAL_FEN, records, 0, 1)
  const migrated = migrateAnalysisPointsToTree(base, [
    { moveIndex: -1, evaluation: 5, depth: 9 },
    { moveIndex: 0, evaluation: 12, depth: 10 },
  ])

  assert.equal(migrated.nodes[base.rootId].analysis?.score, 5)
  assert.equal(migrated.nodes[base.rootId].analysis?.updatedAt, 0)
  assert.equal(migrated.nodes['variation-node-1'].analysis?.score, 12)

  const line = getVariationLine(migrated)
  assert.deepEqual(deriveAnalysisPoints(migrated, line.nodeIds), [
    { moveIndex: -1, evaluation: 5, depth: 9 },
    { moveIndex: 0, evaluation: 12, depth: 10 },
  ])
})

test('out-of-range move indices are skipped during migration', () => {
  const records = buildMoveRecordsFromUci(INITIAL_FEN, ['h2e2'])
  const base = createVariationTree(INITIAL_FEN, records, 0, 1)
  const migrated = migrateAnalysisPointsToTree(base, [{ moveIndex: 9, evaluation: 99, depth: 12 }])

  assert.equal(migrated, base)
  assert.equal(migrated.nodes['variation-node-1'].analysis, undefined)
  assert.equal(migrated.nodes[base.rootId].analysis, undefined)
})

test('analysis info from another branch at the same step is rejected without cross-writing', () => {
  const target = { id: 'analyze-branch-a', movesKey: 'h2e2 h7e7' }
  // 分支 B 与分支 A 同一步数但走法不同,签名不一致,不会串写到 A 的节点。
  assert.equal(shouldAcceptAnalysisInfo(target, 'analyze-branch-a', 'h2e2 b7e7'), false)
})

test('delayed info from a previous branch is dropped after switching', () => {
  const target = { id: 'analyze-1', movesKey: 'h2e2 h7e7' }
  // 切分支后当前签名已变,旧请求的延迟 info 被丢弃。
  assert.equal(shouldAcceptAnalysisInfo(target, 'analyze-1', 'h2e2 b7e7'), false)
  // requestId 不匹配同样丢弃。
  assert.equal(shouldAcceptAnalysisInfo(target, 'analyze-other', 'h2e2 h7e7'), false)
  // 签名与 requestId 都匹配时接受。
  assert.equal(shouldAcceptAnalysisInfo(target, 'analyze-1', 'h2e2 h7e7'), true)
  // 没有进行中的请求时拒绝。
  assert.equal(shouldAcceptAnalysisInfo(null, undefined, 'h2e2 h7e7'), false)
})

test('info without a requestId is rejected even when the target exists', () => {
  const target = { id: 'analyze-1', movesKey: 'h2e2 h7e7' }
  // 即使走法签名一致,缺少 requestId 也无法归属,必须拒绝,避免污染当前节点。
  assert.equal(shouldAcceptAnalysisInfo(target, undefined, 'h2e2 h7e7'), false)
})
