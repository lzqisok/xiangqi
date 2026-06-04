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
  }), {
    ...DEFAULT_ENGINE_SETTINGS,
    candidateCount: 5,
    candidateAutoRefreshDelay: 500,
    searchDepth: 30,
    searchTimeMs: 500,
  })

  assert.deepEqual(normalizeEngineSettings({
    candidateCount: 0,
    candidateAutoRefreshDelay: 8000,
    searchDepth: 1,
    searchTimeMs: 20000,
  }), {
    ...DEFAULT_ENGINE_SETTINGS,
    candidateCount: 1,
    candidateAutoRefreshDelay: 5000,
    searchDepth: 4,
    searchTimeMs: 10000,
  })
})

test('normalizeEngineSettings keeps supported search mode only', () => {
  assert.deepEqual(normalizeEngineSettings({
    searchMode: 'time',
    searchDepth: 18,
    searchTimeMs: 2500,
  }), {
    ...DEFAULT_ENGINE_SETTINGS,
    searchMode: 'time',
    searchDepth: 18,
    searchTimeMs: 2500,
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
  })

  assert.deepEqual(JSON.parse(raw), {
    candidateCount: 4,
    candidateAutoRefreshDelay: 1200,
    hintDifficulty: 'hard',
    searchMode: 'depth',
    searchDepth: 16,
    searchTimeMs: 3000,
  })
})
