import assert from 'node:assert/strict'
import test from 'node:test'
import { BLACK, WHITE } from './core/types'
import { clearGomokuHistory, loadGomokuHistory, saveGomokuRecord } from './history'

function storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size },
  } satisfies Storage
}

test('local Gomoku history stores completed records and clears them', () => {
  const previous = globalThis.localStorage
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage() })
  try {
    const history = saveGomokuRecord({ mode: 'pvp', forbiddenEnabled: false, winner: BLACK, draw: false, moves: [
      { row: 7, col: 3, player: BLACK }, { row: 0, col: 0, player: WHITE },
      { row: 7, col: 4, player: BLACK }, { row: 0, col: 1, player: WHITE },
      { row: 7, col: 5, player: BLACK }, { row: 0, col: 2, player: WHITE },
      { row: 7, col: 6, player: BLACK }, { row: 0, col: 3, player: WHITE },
      { row: 7, col: 7, player: BLACK },
    ] })
    assert.equal(history.length, 1)
    assert.deepEqual(loadGomokuHistory()[0].moves, history[0].moves)
    clearGomokuHistory()
    assert.deepEqual(loadGomokuHistory(), [])
  } finally { Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previous }) }
})

test('local Gomoku history rejects duplicate, out-of-turn, and out-of-board moves', () => {
  const previous = globalThis.localStorage
  const fake = storage()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: fake })
  try {
    fake.setItem('gomoku-game-history-v1', JSON.stringify([
      { id: 'duplicate', createdAt: 1, mode: 'pvp', forbiddenEnabled: false, winner: BLACK, draw: false, moves: [{ row: 7, col: 7, player: BLACK }, { row: 7, col: 7, player: WHITE }] },
      { id: 'turn', createdAt: 2, mode: 'pvp', forbiddenEnabled: false, winner: BLACK, draw: false, moves: [{ row: 7, col: 7, player: WHITE }] },
      { id: 'bounds', createdAt: 3, mode: 'pvp', forbiddenEnabled: false, winner: BLACK, draw: false, moves: [{ row: 15, col: 7, player: BLACK }] },
    ]))
    assert.deepEqual(loadGomokuHistory(), [])
  } finally { Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previous }) }
})
