import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import {
  buildGoCommand,
  getDifficultyDepth,
  getEngineDirectory,
  normalizeEngineRuntimeOptions,
  waitForBestMoveWithStop,
} from './engine.js'

test('engine directory is resolved from the server module instead of the launch directory', () => {
  assert.equal(getEngineDirectory(), fileURLToPath(new URL('../../engine', import.meta.url)))
})

test('buildGoCommand uses explicit depth limits', () => {
  assert.equal(buildGoCommand(14, { searchMode: 'depth', searchDepth: 18 }), 'go depth 18')
})

test('buildGoCommand uses explicit time limits', () => {
  assert.equal(buildGoCommand(14, { searchMode: 'time', searchTimeMs: 2500 }), 'go movetime 2500')
})

test('buildGoCommand falls back to default depth when limits are incomplete', () => {
  assert.equal(buildGoCommand(14, { searchMode: 'time' }), 'go depth 14')
})

test('difficulty levels map to distinct playing strengths', () => {
  assert.deepEqual(
    (['easy', 'medium', 'hard', 'master'] as const).map(getDifficultyDepth),
    [8, 14, 20, 26],
  )
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

test('waitForBestMoveWithStop returns a normal result before the deadline', async () => {
  const emitter = new EventEmitter()
  let stopCalls = 0
  const pending = waitForBestMoveWithStop(emitter, () => { stopCalls++ }, 50, 20)

  emitter.emit('line', 'bestmove h2e2')

  assert.deepEqual(await pending, { line: 'bestmove h2e2', searchCapped: false })
  assert.equal(stopCalls, 0)
})

test('waitForBestMoveWithStop stops at the deadline and keeps the current best move', async () => {
  const emitter = new EventEmitter()
  let stopCalls = 0
  const pending = waitForBestMoveWithStop(emitter, () => {
    stopCalls++
    emitter.emit('line', 'bestmove b2e2')
  }, 5, 20)

  assert.deepEqual(await pending, { line: 'bestmove b2e2', searchCapped: true })
  assert.equal(stopCalls, 1)
})

test('waitForBestMoveWithStop rejects when the engine ignores stop', async () => {
  const emitter = new EventEmitter()
  await assert.rejects(
    waitForBestMoveWithStop(emitter, () => undefined, 5, 5),
    /did not return bestmove after stop/,
  )
})
