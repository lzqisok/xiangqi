import assert from 'node:assert/strict'
import test from 'node:test'
import { verifyRestoredDatabase, restoreCheckCount } from './restoreVerification.js'
import type { Queryable } from './database.js'

function fake(failAt = -1, state?: unknown): Queryable {
  let check = 0,
    read = false
  return {
    query: async <R>() => {
      if (check < restoreCheckCount)
        return { rows: [{ failures: check++ === failAt ? 1 : 0 }] as R[], rowCount: 1 }
      if (state && !read) {
        read = true
        return { rows: [state] as R[], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    },
  }
}
test('every false restore consistency check rejects rather than printing success', async () => {
  for (let i = 0; i < restoreCheckCount; i++)
    await assert.rejects(verifyRestoredDatabase(fake(i)), /restore check failed/)
  assert.equal((await verifyRestoredDatabase(fake())).ok, true)
})
test('restore rejects missing or leaked Jieqi projection and malformed referee data', async () => {
  for (const state of [
    null,
    { schemaVersion: 1, name: '测试对局', initialLayout: 'secret', moves: [] },
  ]) {
    await assert.rejects(
      verifyRestoredDatabase(
        fake(-1, {
          id: 'test',
          variant: 'jieqi',
          gomoku_rule: null,
          public_state: state,
          referee_state: state,
        }),
      ),
      /state\/projection/,
    )
  }
})
