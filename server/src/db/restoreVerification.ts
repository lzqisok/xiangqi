import assert from 'node:assert/strict'
import type { Queryable } from './database.js'
import { onlinePublicState, readOnlineRefereeState } from '../online/state.js'
import type { MatchVariant } from '../repositories/contracts.js'

const checks: Record<string, string> = {
  account_references: `SELECT COUNT(*) AS failures FROM (
    SELECT p.user_id FROM user_profiles p LEFT JOIN users u ON u.id=p.user_id WHERE u.id IS NULL
    UNION ALL SELECT i.user_id FROM auth_identities i LEFT JOIN users u ON u.id=i.user_id WHERE u.id IS NULL
    UNION ALL SELECT s.user_id FROM sessions s LEFT JOIN users u ON u.id=s.user_id WHERE u.id IS NULL
    UNION ALL SELECT c.user_id FROM password_credentials c LEFT JOIN users u ON u.id=c.user_id WHERE u.id IS NULL
  ) invalid_accounts`,
  rating_statistics: `SELECT COUNT(*) AS failures FROM user_ratings r LEFT JOIN (
    SELECT user_id,pool_key,COUNT(*) games,SUM(outcome='win') wins,SUM(outcome='draw') draws,SUM(outcome='loss') losses FROM (
      SELECT red_user_id user_id,pool_key,IF(result='draw','draw',IF(result='red-wins','win','loss')) outcome FROM match_rating_settlements WHERE voided_at IS NULL
      UNION ALL SELECT black_user_id,pool_key,IF(result='draw','draw',IF(result='black-wins','win','loss')) FROM match_rating_settlements WHERE voided_at IS NULL
    ) outcomes WHERE user_id IS NOT NULL GROUP BY user_id,pool_key
  ) s ON s.user_id=r.user_id AND s.pool_key=r.pool_key WHERE r.games_played<>COALESCE(s.games,0) OR r.wins<>COALESCE(s.wins,0) OR r.draws<>COALESCE(s.draws,0) OR r.losses<>COALESCE(s.losses,0)`,
  account_profiles: `SELECT COUNT(*) AS failures FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE p.user_id IS NULL`,
  match_states: `SELECT COUNT(*) AS failures FROM matches m LEFT JOIN match_states s ON s.match_id=m.id WHERE s.match_id IS NULL OR m.revision<>s.revision`,
  participants: `SELECT COUNT(*) AS failures FROM match_participants p LEFT JOIN matches m ON m.id=p.match_id LEFT JOIN users u ON u.id=p.user_id WHERE m.id IS NULL OR (p.user_id IS NOT NULL AND u.id IS NULL) OR (p.user_id IS NULL AND p.anonymized_at IS NULL)`,
  rating_balances: `SELECT COUNT(*) AS failures FROM user_ratings r LEFT JOIN (SELECT user_id,pool_key,SUM(delta) delta FROM rating_ledger WHERE user_id IS NOT NULL GROUP BY user_id,pool_key) l ON l.user_id=r.user_id AND l.pool_key=r.pool_key WHERE r.rating<>1500+COALESCE(l.delta,0) OR r.games_played<>r.wins+r.draws+r.losses`,
  missing_balances: `SELECT COUNT(*) AS failures FROM rating_ledger l LEFT JOIN user_ratings r ON r.user_id=l.user_id AND r.pool_key=l.pool_key WHERE l.user_id IS NOT NULL AND r.user_id IS NULL`,
  settlement_matches: `SELECT COUNT(*) AS failures FROM match_rating_settlements s LEFT JOIN matches m ON m.id=s.match_id WHERE m.id IS NULL OR m.phase<>'finished' OR m.status<>s.result OR m.competition_mode<>'rated' OR s.pool_key<>IF(m.variant='gomoku',CONCAT('gomoku-',m.gomoku_rule),m.variant)`,
  missing_settlements: `SELECT COUNT(*) AS failures FROM matches m LEFT JOIN match_rating_settlements s ON s.match_id=m.id WHERE m.competition_mode='rated' AND m.phase='finished' AND m.clock_preset<>'none' AND m.matchmaking=true AND m.status_reason IN ('checkmate','stalemate','resignation','agreement','repetition','natural-limit','move-limit','five','forbidden','full-board','timeout') AND s.match_id IS NULL`,
  ledger_settlements: `SELECT COUNT(*) AS failures FROM rating_ledger l LEFT JOIN match_rating_settlements s ON s.match_id=l.match_id WHERE s.match_id IS NULL OR l.pool_key<>s.pool_key OR l.rating_after<>l.rating_before+l.delta OR (l.entry_type='void' AND s.voided_at IS NULL) OR (l.user_id IS NOT NULL AND NOT (l.user_id<=>s.red_user_id OR l.user_id<=>s.black_user_id))`,
  settlement_entries: `SELECT COUNT(*) AS failures FROM match_rating_settlements s WHERE (SELECT COUNT(*) FROM rating_ledger l WHERE l.match_id=s.match_id AND l.entry_type='settlement')<>2 OR (SELECT COUNT(*) FROM rating_ledger l WHERE l.match_id=s.match_id AND l.entry_type='void')<>IF(s.voided_at IS NULL,0,2)`,
  settlement_values: `SELECT COUNT(*) AS failures FROM match_rating_settlements s JOIN rating_ledger l ON l.match_id=s.match_id AND l.entry_type='settlement' WHERE (l.user_id=s.red_user_id AND (l.rating_before<>s.red_rating_before OR l.rating_after<>s.red_rating_after)) OR (l.user_id=s.black_user_id AND (l.rating_before<>s.black_rating_before OR l.rating_after<>s.black_rating_after))`,
}

export const restoreCheckCount = Object.keys(checks).length

export async function verifyRestoredDatabase(db: Queryable) {
  for (const [name, sql] of Object.entries(checks)) {
    const result = await db.query<{ failures: number | string }>(sql)
    assert.equal(Number(result.rows[0]?.failures), 0, `restore check failed: ${name}`)
  }
  // Keyset batches bound memory; errors contain IDs only, never referee payloads.
  let cursor = ''
  let matches = 0
  while (true) {
    const { rows } = await db.query<{
      id: string
      variant: MatchVariant
      gomoku_rule: 'freestyle' | 'renju' | null
      public_state: unknown
      referee_state: unknown
    }>(
      `SELECT m.id,m.variant,m.gomoku_rule,s.public_state,s.referee_state FROM matches m JOIN match_states s ON s.match_id=m.id WHERE m.id>? ORDER BY m.id LIMIT 100`,
      [cursor],
    )
    if (!rows.length) break
    for (const row of rows) {
      try {
        const parse = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value)
        const state = readOnlineRefereeState(parse(row.referee_state), row.variant, row.gomoku_rule)
        assert.deepEqual(parse(row.public_state), onlinePublicState(state))
      } catch {
        throw new Error(`restore state/projection check failed: ${row.id}`)
      }
      matches++
      cursor = row.id
    }
  }
  return { ok: true, checks: Object.keys(checks).length, matches }
}
