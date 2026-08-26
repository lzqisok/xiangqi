import assert from 'node:assert/strict'
import test from 'node:test'
import { canAccessPublicOnline, canStartPublicOnlineOperation } from './rollout.js'

const actor = { userId: 'test-user' }

test('public rollout modes separate access from starting new online operations', () => {
  const allowedUserIds = new Set(['test-user'])
  assert.equal(canAccessPublicOnline({ mode: 'off', allowedUserIds }, actor), false)
  assert.equal(canAccessPublicOnline({ mode: 'controlled', allowedUserIds }, actor), true)
  assert.equal(
    canAccessPublicOnline({ mode: 'controlled', allowedUserIds: new Set() }, actor),
    false,
  )
  assert.equal(canStartPublicOnlineOperation({ mode: 'open', allowedUserIds }, actor), true)
  assert.equal(canAccessPublicOnline({ mode: 'drain', allowedUserIds }, actor), true)
  assert.equal(canStartPublicOnlineOperation({ mode: 'drain', allowedUserIds }, actor), false)
})
