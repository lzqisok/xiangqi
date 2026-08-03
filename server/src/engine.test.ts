import assert from 'node:assert/strict'
import test from 'node:test'
import { buildGoCommand, normalizeEngineRuntimeOptions } from './engine.js'

test('buildGoCommand uses explicit depth limits', () => {
  assert.equal(buildGoCommand(14, { searchMode: 'depth', searchDepth: 18 }), 'go depth 18')
})

test('buildGoCommand uses explicit time limits', () => {
  assert.equal(buildGoCommand(14, { searchMode: 'time', searchTimeMs: 2500 }), 'go movetime 2500')
})

test('buildGoCommand falls back to default depth when limits are incomplete', () => {
  assert.equal(buildGoCommand(14, { searchMode: 'time' }), 'go depth 14')
})

test('normalizeEngineRuntimeOptions keeps safe runtime ranges', () => {
  assert.deepEqual(normalizeEngineRuntimeOptions(), {
    engineThreads: 'auto',
    engineHashMb: 128,
  })
  assert.deepEqual(normalizeEngineRuntimeOptions({ engineThreads: 12, engineHashMb: 8 }), {
    engineThreads: 8,
    engineHashMb: 16,
  })
  assert.deepEqual(normalizeEngineRuntimeOptions({ engineThreads: 0, engineHashMb: 2048 }), {
    engineThreads: 1,
    engineHashMb: 512,
  })
})
