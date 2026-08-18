import test from 'node:test'
import assert from 'node:assert/strict'
import { runRenjuRegressionCases } from './rules.renju-cases'

test('gomoku Renju regression cases remain valid after migration', () => {
  const results = runRenjuRegressionCases()
  assert.ok(results.length > 0)
  assert.deepEqual(
    results.filter((result) => !result.pass),
    [],
    results.map((result) => `${result.name}: ${result.pass ? 'pass' : 'failed'}`).join('\n'),
  )
})
