import assert from 'node:assert/strict'
import test from 'node:test'
import { createLanCommandId } from './browser'

test('LAN command IDs do not require crypto.randomUUID or a secure context', () => {
  const commandId = createLanCommandId(null)
  assert.match(commandId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test('LAN command IDs use getRandomValues when randomUUID is unavailable', () => {
  const commandId = createLanCommandId({
    getRandomValues: array => {
      new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(0x12)
      return array
    },
  })
  assert.equal(commandId, '12121212-1212-4212-9212-121212121212')
})
