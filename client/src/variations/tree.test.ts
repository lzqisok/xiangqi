import assert from 'node:assert/strict'
import test from 'node:test'
import { INITIAL_FEN } from '../engine/board.js'
import { buildMoveRecordsFromUci } from '../share/replayLink.js'
import { addVariationMove, countVariationBranches, createVariationTree, getVariationLine, selectVariationNode, setMainVariation, updateVariationAnnotations } from './tree.js'

test('linear records migrate to a main variation without changing replay order', () => {
  const records = buildMoveRecordsFromUci(INITIAL_FEN, ['h2e2', 'h7e7'])
  const tree = createVariationTree(INITIAL_FEN, records, 0, 1)
  const line = getVariationLine(tree)

  assert.deepEqual(line.records.map(record => record.notation), records.map(record => record.notation))
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
  const selected = selectVariationNode(added.tree, added.nodeId)
  const promoted = setMainVariation(selected, 'variation-node-1', added.nodeId, 3)
  const parentSelected = selectVariationNode(promoted, 'variation-node-1')

  assert.equal(getVariationLine(parentSelected).records[1].notation, alternative.notation)
})

test('annotations stay scoped to their variation node', () => {
  const records = buildMoveRecordsFromUci(INITIAL_FEN, ['h2e2', 'h7e7'])
  const base = createVariationTree(INITIAL_FEN, records, 0, 1)
  const annotation = { id: 'mark-1', type: 'arrow' as const, color: 'red' as const, from: { row: 9, col: 7 }, to: { row: 7, col: 7 } }
  const updated = updateVariationAnnotations(base, 'variation-node-1', [annotation], 2)

  assert.deepEqual(updated.nodes['variation-node-1'].annotations, [annotation])
  assert.equal(updated.nodes[base.rootId].annotations, undefined)
  assert.equal(base.nodes['variation-node-1'].annotations, undefined)
  assert.equal(updated.nodes['variation-node-1'].updatedAt, 2)
  assert.equal(updateVariationAnnotations(updated, 'variation-node-1', [], 3).nodes['variation-node-1'].annotations, undefined)
})
