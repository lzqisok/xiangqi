import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_ENGINE_SETTINGS,
  normalizeEngineSettings,
  serializeEngineSettings,
} from './engineSettings'

test('normalizeEngineSettings clamps numeric search settings', () => {
  assert.deepEqual(normalizeEngineSettings({
    candidateCount: 9,
    candidateAutoRefreshDelay: 200,
    searchDepth: 99,
    searchTimeMs: 100,
    engineThreads: 12,
    engineHashMb: 4,
  }), {
    ...DEFAULT_ENGINE_SETTINGS,
    candidateCount: 5,
    candidateAutoRefreshDelay: 500,
    searchDepth: 30,
    searchTimeMs: 500,
    engineThreads: 8,
    engineHashMb: 16,
  })

  assert.deepEqual(normalizeEngineSettings({
    candidateCount: 0,
    candidateAutoRefreshDelay: 8000,
    searchDepth: 1,
    searchTimeMs: 20000,
    engineThreads: 0,
    engineHashMb: 2048,
  }), {
    ...DEFAULT_ENGINE_SETTINGS,
    candidateCount: 1,
    candidateAutoRefreshDelay: 5000,
    searchDepth: 4,
    searchTimeMs: 10000,
    engineThreads: 1,
    engineHashMb: 512,
  })
})

test('normalizeEngineSettings keeps supported search mode only', () => {
  assert.deepEqual(normalizeEngineSettings({
    searchMode: 'time',
    searchDepth: 18,
    searchTimeMs: 2500,
    engineThreads: 'auto',
    engineHashMb: 256,
  }), {
    ...DEFAULT_ENGINE_SETTINGS,
    searchMode: 'time',
    searchDepth: 18,
    searchTimeMs: 2500,
    engineThreads: 'auto',
    engineHashMb: 256,
  })

  assert.deepEqual(normalizeEngineSettings({
    searchMode: 'invalid' as never,
  }), DEFAULT_ENGINE_SETTINGS)
})

test('serializeEngineSettings stores only normalized values', () => {
  const raw = serializeEngineSettings({
    candidateCount: 4,
    candidateAutoRefreshDelay: 1200,
    hintDifficulty: 'hard',
    searchMode: 'depth',
    searchDepth: 16,
    searchTimeMs: 3000,
    engineThreads: 4,
    engineHashMb: 256,
  })

  assert.deepEqual(JSON.parse(raw), {
    candidateCount: 4,
    candidateAutoRefreshDelay: 1200,
    hintDifficulty: 'hard',
    searchMode: 'depth',
    searchDepth: 16,
    searchTimeMs: 3000,
    engineThreads: 4,
    engineHashMb: 256,
  })
})
