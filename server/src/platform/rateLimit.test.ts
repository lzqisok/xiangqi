import assert from 'node:assert/strict'
import test from 'node:test'
import type { Database, Queryable } from '../db/database.js'
import {
  chatRateRules,
  MySqlRateLimitStore,
  RateLimitExceededError,
  type RateLimitRule,
} from './rateLimit.js'

function persistedStore() {
  const counts = new Map<string, number>()
  let pendingKey = ''
  const client: Queryable = {
    async query<R>(sql: string, values: readonly unknown[] = []) {
      if (sql.startsWith('INSERT INTO rate_limit_buckets')) {
        pendingKey = (values[0] as Buffer).toString('hex')
        counts.set(pendingKey, (counts.get(pendingKey) || 0) + 1)
        return { rows: [] as R[], rowCount: 1 }
      }
      if (sql.startsWith('SELECT request_count')) {
        return { rows: [{ request_count: counts.get(pendingKey) || 0 }] as R[], rowCount: 1 }
      }
      return { rows: [] as R[], rowCount: 0 }
    },
  }
  const database = {
    transaction: <T>(action: (queryable: Queryable) => Promise<T>) => action(client),
    query: async () => ({ rows: [], rowCount: 0 }),
  } as unknown as Database
  return new MySqlRateLimitStore(database)
}

test('persistent fixed-window limiter rejects over-cap requests with a bounded retry time', async () => {
  const store = persistedStore()
  const rule: RateLimitRule = { scope: 'login_ip', key: '203.0.113.8', limit: 1, windowMs: 60_000 }
  const now = new Date('2026-08-25T00:00:20.000Z')
  await store.consume([rule], now)
  await assert.rejects(
    store.consume([rule], now),
    (error: unknown) => error instanceof RateLimitExceededError && error.retryAfterSeconds === 40,
  )
})

test('chat limiter uses independent IP, user, and match resource dimensions', () => {
  assert.deepEqual(
    chatRateRules({ ip: '203.0.113.8', userId: 'user-a', matchId: 'match-a' }).map(
      ({ scope, key }) => [scope, key],
    ),
    [
      ['chat_ip', '203.0.113.8'],
      ['chat_user', 'user-a'],
      ['chat_match', 'match-a'],
    ],
  )
})
