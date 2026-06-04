import assert from 'node:assert/strict'
import test from 'node:test'
import { buildGoCommand } from './engine.js'

test('buildGoCommand uses explicit depth limits', () => {
  assert.equal(buildGoCommand(14, { searchMode: 'depth', searchDepth: 18 }), 'go depth 18')
})

test('buildGoCommand uses explicit time limits', () => {
  assert.equal(buildGoCommand(14, { searchMode: 'time', searchTimeMs: 2500 }), 'go movetime 2500')
})

test('buildGoCommand falls back to default depth when limits are incomplete', () => {
  assert.equal(buildGoCommand(14, { searchMode: 'time' }), 'go depth 14')
})
