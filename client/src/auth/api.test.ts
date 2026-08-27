import assert from 'node:assert/strict'
import test from 'node:test'
import { AccountApiError, accountCacheKey, resendVerification, verifyEmail } from './api'

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

test('email verification APIs use the account verification endpoints', async () => {
  const previousFetch = globalThis.fetch
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
  globalThis.fetch = async (input, init) => {
    requests.push({ input, init })
    return new Response(JSON.stringify({ verified: true, accepted: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  try {
    assert.deepEqual(await verifyEmail('verification-token'), { verified: true, accepted: true })
    assert.deepEqual(await resendVerification(), { verified: true, accepted: true })
    assert.equal(requests[0].input, '/api/auth/verify-email')
    assert.equal(requests[0].init?.method, 'POST')
    assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
      token: 'verification-token',
    })
    assert.equal(requests[1].input, '/api/auth/verification/resend')
    assert.equal(requests[1].init?.method, 'POST')
  } finally {
    globalThis.fetch = previousFetch
  }
})
