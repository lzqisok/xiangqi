import assert from 'node:assert/strict'
import test from 'node:test'
import { AccountApiError, accountCacheKey } from './api'

test('account cache keys always include the authenticated user namespace', () => {
  assert.equal(accountCacheKey('user-a', 'studies'), 'xiangqi:user:user-a:studies')
  assert.notEqual(accountCacheKey('user-a', 'studies'), accountCacheKey('user-b', 'studies'))
})

test('account API errors preserve stable status and retry metadata', () => {
  const error = new AccountApiError(429, 'rate_limited', 60)
  assert.equal(error.status, 429)
  assert.equal(error.code, 'rate_limited')
  assert.equal(error.retryAfterSeconds, 60)
})
