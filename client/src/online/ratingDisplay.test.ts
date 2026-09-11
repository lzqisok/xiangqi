import assert from 'node:assert/strict'
import test from 'node:test'
import { ratingDetailText } from './ratingDisplay'
import type { MatchRatingDetail } from './types'

test('rating detail distinguishes original settlement, compensation and unscored games', () => {
  const detail: MatchRatingDetail = {
    matchId: 'test',
    state: 'settled',
    reason: null,
    before: 1500,
    after: 1480,
    delta: -20,
    voidReason: null,
  }
  assert.equal(ratingDetailText(detail), '1500 → 1480（-20）')
  assert.match(
    ratingDetailText({ ...detail, state: 'voided', voidReason: '服务故障' }),
    /原结算.*已作废：服务故障/,
  )
  for (const reason of ['service_restart', 'admin_abort', 'abandoned', 'casual'])
    assert.match(
      ratingDetailText({
        ...detail,
        state: 'unrated',
        reason,
        before: null,
        after: null,
        delta: null,
      }),
      /不计分/,
    )
})
