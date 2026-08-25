import assert from 'node:assert/strict'
import test from 'node:test'
import { payloadWithinLimits, TrustedProxyPolicy, requestOriginAllowed } from './security.js'

test('trusted proxy policy accepts only configured addresses and ignores spoofed forwarding directly', () => {
  const policy = new TrustedProxyPolicy(['10.0.0.0/8', '::1/128'])
  assert.equal(policy.isTrusted('10.2.3.4'), true)
  assert.equal(policy.isTrusted('::1'), true)
  assert.equal(policy.isTrusted('192.168.1.4'), false)
  const direct = {
    socket: { remoteAddress: '192.168.1.4' },
    headers: { 'x-forwarded-for': '203.0.113.9' },
  }
  assert.equal(policy.clientAddress(direct as never), '192.168.1.4')
})

test('origin validation is same-origin by default and exact-list only for cross origin', () => {
  const request = (origin?: string, host = 'chess.test') =>
    ({ headers: { ...(origin ? { origin } : {}), host } }) as never
  const development = { production: false, allowedOrigins: [] }
  const production = { production: true, allowedOrigins: ['https://app.chess.test'] }
  assert.equal(requestOriginAllowed(request(undefined), development), true)
  assert.equal(requestOriginAllowed(request(undefined), production), false)
  assert.equal(requestOriginAllowed(request('https://chess.test'), production), true)
  assert.equal(requestOriginAllowed(request('https://app.chess.test'), production), true)
  assert.equal(requestOriginAllowed(request('https://evil.test'), production), false)
  assert.equal(requestOriginAllowed(request('http://chess.test'), production), false)
  assert.equal(requestOriginAllowed(request('https://chess.test/path'), production), false)
})

test('payload complexity rejects deep and wide objects without recursive traversal', () => {
  const root: { next?: unknown } = {}
  let current = root
  for (let index = 0; index < 20_000; index++) {
    const next: { next?: unknown } = {}
    current.next = next
    current = next
  }
  assert.equal(payloadWithinLimits(root, 12, 2_000), false)
  assert.equal(payloadWithinLimits({ safe: [{ value: 1 }] }, 12, 2_000), true)
  assert.equal(payloadWithinLimits({ many: Array.from({ length: 51 }) }, 12, 50), false)
})
