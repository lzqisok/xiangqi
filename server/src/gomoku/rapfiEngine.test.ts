import assert from 'node:assert/strict'
import test from 'node:test'
import { getRapfiThreadCount } from './rapfiEngine.js'

test('Rapfi thread count follows difficulty without exceeding available CPUs', () => {
  assert.equal(getRapfiThreadCount('easy', 8), 2)
  assert.equal(getRapfiThreadCount('medium', 8), 4)
  assert.equal(getRapfiThreadCount('hard', 8), 6)
  assert.equal(getRapfiThreadCount('master', 8), 8)
  assert.equal(getRapfiThreadCount('master', 4), 4)
})
