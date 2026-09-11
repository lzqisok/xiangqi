import type { Database } from '../db/database.js'
import { RepositoryNotFoundError } from '../db/errors.js'
import type { RatingPool } from './rating.js'

export type MatchRatingDetail = {
  matchId: string
  state: 'pending' | 'settled' | 'voided' | 'unrated'
  reason: string | null
  before: number | null
  after: number | null
  delta: number | null
  voidReason: string | null
}
export type RatingLedgerEntry = {
  id: string
  matchId: string
  pool: RatingPool
  type: 'settlement' | 'void'
  before: number
  after: number
  delta: number
  reason: string
  createdAt: string
  voided: boolean
}

export async function matchRatingDetail(
  database: Database,
  userId: string,
  matchId: string,
): Promise<MatchRatingDetail> {
  const result = await database.query<{
    phase: string
    competition_mode: string
    matchmaking: number
    clock_preset: string
    started_at: Date | null
    status_reason: string | null
    side: string | null
    rating_before: number | null
    rating_after: number | null
    delta: number | null
    voided_at: Date | null
    void_reason: string | null
    interruption: string | null
  }>(
    `SELECT m.phase, m.competition_mode, m.matchmaking, m.clock_preset, m.started_at, m.status_reason, p.side,
       l.rating_before, l.rating_after, l.delta, s.voided_at, s.void_reason, i.source AS interruption
     FROM matches m JOIN match_participants p ON p.match_id = m.id AND p.user_id = ?
     LEFT JOIN rating_ledger l ON l.match_id = m.id AND l.user_id = p.user_id AND l.entry_type = 'settlement'
     LEFT JOIN match_rating_settlements s ON s.match_id = l.match_id
     LEFT JOIN match_interruptions i ON i.match_id = m.id
     WHERE m.id = ?`,
    [userId, matchId],
  )
  const row = result.rows[0]
  if (!row) throw new RepositoryNotFoundError()
  const settled = row.rating_before !== null
  const reason = settled
    ? null
    : row.interruption ||
      (row.competition_mode !== 'rated'
        ? 'casual'
        : !row.matchmaking
          ? 'not_matchmaking'
          : row.clock_preset === 'none'
            ? 'no_clock'
            : row.phase !== 'finished'
              ? 'pending'
              : !row.started_at
                ? 'not_started'
                : !row.side
                  ? 'not_player'
                  : row.status_reason === 'abandoned'
                    ? 'abandoned'
                    : 'ineligible_or_legacy')
  return {
    matchId,
    state: settled
      ? row.voided_at
        ? 'voided'
        : 'settled'
      : reason === 'pending'
        ? 'pending'
        : 'unrated',
    reason,
    before: settled ? Number(row.rating_before) : null,
    after: settled ? Number(row.rating_after) : null,
    delta: settled ? Number(row.delta) : null,
    voidReason: row.void_reason,
  }
}

export async function ratingLedgerPage(
  database: Database,
  userId: string,
  limit: number,
  cursor?: string,
): Promise<{ entries: RatingLedgerEntry[]; nextCursor?: string }> {
  return database.connection(async (client) => {
    if (cursor) {
      const anchor = await client.query(
        'SELECT id FROM rating_ledger WHERE id = ? AND user_id = ?',
        [cursor, userId],
      )
      if (!anchor.rowCount) throw new RepositoryNotFoundError()
    }
    const rows = await client.query<{
      id: string
      match_id: string
      pool_key: RatingPool
      entry_type: 'settlement' | 'void'
      rating_before: number
      rating_after: number
      delta: number
      reason: string
      created_at: Date
      voided_at: Date | null
    }>(
      `SELECT l.*, s.voided_at FROM rating_ledger l JOIN match_rating_settlements s ON s.match_id = l.match_id
       WHERE l.user_id = ? ${cursor ? 'AND (l.created_at, l.id) < (SELECT created_at, id FROM rating_ledger WHERE id = ? AND user_id = ?)' : ''}
       ORDER BY l.created_at DESC, l.id DESC LIMIT ?`,
      [userId, ...(cursor ? [cursor, userId] : []), limit + 1],
    )
    const entries = rows.rows.slice(0, limit).map((r) => ({
      id: r.id,
      matchId: r.match_id,
      pool: r.pool_key,
      type: r.entry_type,
      before: Number(r.rating_before),
      after: Number(r.rating_after),
      delta: Number(r.delta),
      reason: r.reason,
      createdAt: r.created_at.toISOString(),
      voided: r.voided_at !== null,
    }))
    return { entries, ...(rows.rows.length > limit ? { nextCursor: entries.at(-1)!.id } : {}) }
  })
}
