import assert from 'node:assert/strict'
import test from 'node:test'
import { GameDocument, StoredGameState } from './types.js'
import { isGameDocument, isStoredGameState, MAX_VARIATION_NODES } from './validation.js'

const INITIAL_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'

function stateWithNodes(count: number): StoredGameState {
  const nodes: StoredGameState['t']['n'] = {}
  for (let index = 0; index < count; index++) {
    const id = `node-${index}`
    const child = index + 1 < count ? `node-${index + 1}` : undefined
    nodes[id] = index === 0
      ? { p: null, c: child ? [child] : [], x: child }
      : { p: `node-${index - 1}`, c: child ? [child] : [], x: child, v: { u: 'a0a1' } }
  }
  return { f: INITIAL_FEN, t: { r: 'node-0', c: `node-${count - 1}`, n: nodes }, s: 'playing' }
}

test('stored state allows the root plus the maximum protocol move count', () => {
  assert.equal(MAX_VARIATION_NODES, 2001)
  assert.equal(isStoredGameState(stateWithNodes(MAX_VARIATION_NODES), 'human-vs-human'), true)
  assert.equal(isStoredGameState(stateWithNodes(MAX_VARIATION_NODES + 1), 'human-vs-human'), false)
})

test('game document requires a canonical UUID-shaped id', () => {
  const base: GameDocument = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    schemaVersion: 2,
    revision: 0,
    name: '测试对局',
    mode: 'human-vs-human',
    config: { difficulty: 'medium', playerSide: 'red', aiRedDifficulty: 'medium', aiBlackDifficulty: 'medium' },
    state: stateWithNodes(1),
    createdAt: 1,
    updatedAt: 1,
  }
  assert.equal(isGameDocument(base), true)
  assert.equal(isGameDocument({ ...base, id: '------------------------------------' }), false)
})
