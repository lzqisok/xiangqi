import assert from 'node:assert/strict'
import test from 'node:test'
import { userDocumentDefinition, userDocumentSummary } from './registry.js'

const INITIAL_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'

test('study documents preserve a connected variation tree and reject identity or hidden snapshots', () => {
  const validate = userDocumentDefinition('studies')!.validate
  const valid = {
    id: 'study-1',
    name: '研究一',
    initialFen: INITIAL_FEN,
    moves: [],
    currentMoveIndex: -1,
    analysisPoints: [],
    variationTree: {
      rootId: 'root',
      currentNodeId: 'root',
      nodes: {
        root: {
          id: 'root',
          parentId: null,
          fen: INITIAL_FEN,
          children: [],
          createdAt: 1,
          updatedAt: 1,
        },
      },
    },
    createdAt: 1,
    updatedAt: 1,
  }
  assert.equal(validate(valid), true)
  assert.deepEqual(userDocumentSummary('studies', valid), {
    id: 'study-1',
    name: '研究一',
    description: '',
    moveCount: 0,
    updatedAt: 1,
  })
  assert.equal(validate({ ...valid, ownerUserId: 'spoofed' }), false)
  assert.equal(validate({ ...valid, moves: [{ snapshot: { board: [] } }] }), false)
  const disconnected = {
    ...valid,
    variationTree: {
      ...valid.variationTree,
      nodes: {
        ...valid.variationTree.nodes,
        orphan: { ...valid.variationTree.nodes.root, id: 'orphan', parentId: 'missing' },
      },
    },
  }
  assert.equal(validate(disconnected), false)
})

test('Gomoku cloud history is accepted only when its result follows a legal replay', () => {
  const validate = userDocumentDefinition('gomoku-history')!.validate
  const moves = [
    { row: 7, col: 3, player: 1 },
    { row: 0, col: 0, player: 2 },
    { row: 7, col: 4, player: 1 },
    { row: 0, col: 1, player: 2 },
    { row: 7, col: 5, player: 1 },
    { row: 0, col: 2, player: 2 },
    { row: 7, col: 6, player: 1 },
    { row: 0, col: 3, player: 2 },
    { row: 7, col: 7, player: 1 },
  ]
  const valid = {
    id: 'gomoku-1',
    createdAt: 1,
    mode: 'pvp',
    forbiddenEnabled: false,
    winner: 1,
    draw: false,
    moves,
  }
  assert.equal(validate(valid), true)
  assert.equal(validate({ ...valid, winner: 2 }), false)
  assert.equal(validate({ ...valid, moves: [...moves, { row: 8, col: 8, player: 2 }] }), false)
})

test('Jieqi seat records remain a server-managed private resource', () => {
  const definition = userDocumentDefinition('jieqi-seat-records')!
  assert.equal(definition.serverManaged, true)
  assert.equal(userDocumentDefinition('unknown'), null)
})
