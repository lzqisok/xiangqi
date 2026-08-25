import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AuthRateLimiter,
  assertPassword,
  hashPassword,
  normalizeDisplayName,
  normalizeEmail,
  parseCookies,
  serializeCookie,
  tokenHash,
  tokenMatches,
  verifyPassword,
} from './security.js'

test('email, display name, password, and opaque token validation are canonical', async () => {
  assert.equal(normalizeEmail('  Player@Example.COM '), 'player@example.com')
  assert.equal(normalizeDisplayName('  云端棋手  '), '云端棋手')
  assert.throws(() => normalizeEmail('missing-at.example.com'))
  assert.throws(() => normalizeDisplayName('一'))
  assert.throws(() => assertPassword('too-short'))

  const password = 'correct horse battery'
  const digest = await hashPassword(password)
  assert.match(digest, /^\$argon2id\$/)
  assert.equal(await verifyPassword(digest, password), true)
  assert.equal(await verifyPassword(digest, 'wrong password value'), false)
  assert.equal(await verifyPassword(undefined, password), false)

  const token = 'opaque-session-token'
  assert.equal(tokenMatches(token, tokenHash(token)), true)
  assert.equal(tokenMatches(`${token}-changed`, tokenHash(token)), false)
})

test('cookie helpers preserve encoded values and production security attributes', () => {
  const cookie = serializeCookie('__Host-xiangqi_session', 'a/b+c', {
    httpOnly: true,
    secure: true,
    maxAgeSeconds: 60,
  })
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /Secure/)
  assert.match(cookie, /SameSite=Lax/)
  assert.equal(parseCookies(cookie).get('__Host-xiangqi_session'), 'a/b+c')
})

test('login limiter applies all keys and supplies a bounded retry time', () => {
  const limiter = new AuthRateLimiter(2, 10_000)
  assert.equal(limiter.consume(['ip:a', 'email:a'], 1_000).allowed, true)
  assert.equal(limiter.consume(['ip:a', 'email:a'], 1_001).allowed, true)
  const blocked = limiter.consume(['ip:a', 'email:b'], 1_002)
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.retryAfterSeconds, 10)
  limiter.reset(['ip:a'])
  assert.equal(limiter.consume(['ip:a', 'email:b'], 1_003).allowed, true)
})
