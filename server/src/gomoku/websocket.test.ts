import assert from 'node:assert/strict'
import test from 'node:test'
import { RapfiRequestGate } from './websocket.js'

test('Rapfi request gate rejects concurrent searches in the same generation', () => {
  const gate = new RapfiRequestGate()
  const first = gate.begin()

  assert.equal(first, 0)
  assert.equal(gate.begin(), null)

  gate.finish(first!)
  assert.equal(gate.begin(), 0)
})

test('Rapfi request gate accepts one replacement search after cancellation', () => {
  const gate = new RapfiRequestGate()
  const cancelled = gate.begin()
  gate.cancel()
  const replacement = gate.begin()

  assert.equal(cancelled, 0)
  assert.equal(replacement, 1)

  gate.finish(cancelled!)
  assert.equal(gate.begin(), null, 'finishing the cancelled search must not clear the replacement')
  gate.finish(replacement!)
  assert.equal(gate.begin(), 1)
})
