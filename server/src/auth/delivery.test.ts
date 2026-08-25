import assert from 'node:assert/strict'
import test from 'node:test'
import { createAuthTokenDelivery } from './delivery.js'

test('production auth token delivery requires an authenticated HTTPS webhook', () => {
  assert.throws(() => createAuthTokenDelivery({}, true), /AUTH_DELIVERY_WEBHOOK_URL/)
  assert.throws(
    () => createAuthTokenDelivery({ AUTH_DELIVERY_WEBHOOK_URL: 'http://mailer.test/token' }, true),
    /must use HTTPS/,
  )
  assert.throws(
    () => createAuthTokenDelivery({ AUTH_DELIVERY_WEBHOOK_URL: 'https://mailer.test/token' }, true),
    /WEBHOOK_TOKEN/,
  )
})

test('webhook delivery sends the token only to the configured endpoint', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const delivery = createAuthTokenDelivery(
    {
      AUTH_DELIVERY_WEBHOOK_URL: 'https://mailer.test/token',
      AUTH_DELIVERY_WEBHOOK_TOKEN: 'delivery-secret',
    },
    true,
    (async (input, init) => {
      calls.push({ url: String(input), init })
      return new Response(null, { status: 202 })
    }) as typeof fetch,
  )
  await delivery.deliver({
    purpose: 'verify_email',
    email: 'player@example.test',
    token: 'one-time-token',
    expiresAt: new Date('2026-08-25T00:10:00.000Z'),
  })
  assert.equal(calls[0].url, 'https://mailer.test/token')
  assert.equal(new Headers(calls[0].init?.headers).get('authorization'), 'Bearer delivery-secret')
  assert.match(String(calls[0].init?.body), /one-time-token/)
})
