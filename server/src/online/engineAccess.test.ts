import assert from 'node:assert/strict'
import test from 'node:test'
import { engineAccessAllowed } from './engineAccess.js'

test('engine authorization rechecks active state at delivery and fails closed', async () => {
  let active = false
  const lookup = async () => active
  assert.equal(await engineAccessAllowed(lookup), true)
  active = true
  assert.equal(await engineAccessAllowed(lookup), false)
  assert.equal(
    await engineAccessAllowed(async () => {
      throw new Error('database offline')
    }),
    false,
  )
  active = false
  assert.equal(await engineAccessAllowed(lookup), true)
  assert.equal(await engineAccessAllowed(undefined), true)
})
