import { createHash, randomInt, randomUUID } from 'node:crypto'
import type { Database, Queryable } from '../db/database.js'
import {
  RepositoryNotFoundError,
  RepositoryRevisionConflictError,
  RepositoryUniqueConflictError,
} from '../db/errors.js'
import type { MatchEntity, MatchVariant } from '../repositories/contracts.js'
import type { RoomColor, RoomStatusReason } from '../rooms/types.js'
import { createOnlineRefereeState, onlinePublicState, readOnlineRefereeState } from './state.js'
import type {
  OnlineChatMessage,
  OnlineHistoryPage,
  OnlineLobbyMatch,
  OnlineMatchRecord,
  OnlineMatchSummary,
  OnlineParticipant,
  OnlineProposal,
  OnlineRating,
  OnlineRefereeState,
} from './types.js'
import { authoritativeClockNow, createOnlineClock, stopOnlineClock } from './clock.js'
import {
  calculateRating,
  isRatedMatchEligible,
  ratingPolicy,
  ratingPool,
  type RatingPool,
} from './rating.js'

type MatchRow = {
  id: string
  variant: MatchEntity['variant']
  gomoku_rule: MatchEntity['gomokuRule']
  matchmaking: number | boolean
  competition_mode: MatchEntity['competitionMode']
  clock_preset: MatchEntity['clockPreset']
  visibility: MatchEntity['visibility']
  phase: MatchEntity['phase']
  status: MatchEntity['status']
  status_reason: string | null
  revision: string
  previous_match_id: string | null
  created_by_user_id: string | null
  created_at: Date
  updated_at: Date
  started_at: Date | null
  finished_at: Date | null
  expires_at: Date
}

type ParticipantRow = {
  id: string
  user_id: string | null
  side: RoomColor | null
  is_owner: number | boolean
  display_name_snapshot: string
  ready: number | boolean
  hints_used: number
  joined_at: Date
  disconnected_at: Date | null
  disconnect_deadline: Date | null
}

type StateRow = { referee_state: unknown; revision: string }
type ProposalRow = {
  id: string
  kind: OnlineProposal['kind']
  proposed_by_user_id: string
  deadline: Date
}

const MATCH_COLUMNS = `
  id, variant, gomoku_rule, matchmaking, competition_mode, clock_preset, visibility, phase,
  status, status_reason, revision, previous_match_id, created_by_user_id, created_at, updated_at,
  started_at, finished_at, expires_at
`

function matchEntity(row: MatchRow): MatchEntity {
  return {
    id: row.id,
    variant: row.variant,
    gomokuRule: row.gomoku_rule,
    matchmaking: Boolean(row.matchmaking),
    competitionMode: row.competition_mode,
    clockPreset: row.clock_preset,
    visibility: row.visibility,
    phase: row.phase,
    status: row.status,
    statusReason: row.status_reason,
    revision: Number(row.revision),
    previousMatchId: row.previous_match_id,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    expiresAt: row.expires_at,
  }
}

function participant(row: ParticipantRow): OnlineParticipant {
  return {
    id: row.id,
    userId: row.user_id,
    side: row.side,
    isOwner: Boolean(row.is_owner),
    displayNameSnapshot: row.display_name_snapshot,
    ready: Boolean(row.ready),
    hintsUsed: Number(row.hints_used),
    joinedAt: row.joined_at,
    disconnectedAt: row.disconnected_at,
    disconnectDeadline: row.disconnect_deadline,
  }
}

function proposal(row: ProposalRow | undefined): OnlineProposal | null {
  return row
    ? {
        id: row.id,
        kind: row.kind,
        proposedByUserId: row.proposed_by_user_id,
        deadline: row.deadline,
      }
    : null
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value
  return JSON.parse(value)
}

function tokenHash(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

function matchName(variant: MatchVariant, rule?: 'freestyle' | 'renju'): string {
  if (variant === 'jieqi') return '快速匹配 · 揭棋'
  if (variant === 'gomoku') return `快速匹配 · ${rule === 'renju' ? '黑方禁手' : '标准五子棋'}`
  return '快速匹配 · 普通象棋'
}

function summary(record: OnlineMatchRecord): OnlineMatchSummary {
  const bySide = (side: RoomColor) =>
    record.participants.find((item) => item.side === side)?.displayNameSnapshot ?? null
  return {
    id: record.match.id,
    name: record.state.name,
    variant: record.match.variant,
    ...(record.match.gomokuRule ? { gomokuRule: record.match.gomokuRule } : {}),
    matchmaking: record.match.matchmaking,
    competitionMode: record.match.competitionMode,
    clockPreset: record.match.clockPreset,
    visibility: record.match.visibility,
    phase: record.match.phase,
    red: bySide('red'),
    black: bySide('black'),
    moveCount: record.state.moves.length,
    status: record.match.status,
    ...(record.match.statusReason
      ? { statusReason: record.match.statusReason as RoomStatusReason }
      : {}),
    ...(record.match.previousMatchId ? { previousMatchId: record.match.previousMatchId } : {}),
    createdAt: record.match.createdAt.toISOString(),
    updatedAt: record.match.updatedAt.toISOString(),
  }
}

function lobbySummary(record: OnlineMatchRecord): OnlineLobbyMatch {
  const full = summary(record)
  return {
    id: full.id,
    name: full.name,
    variant: full.variant,
    ...(full.gomokuRule ? { gomokuRule: full.gomokuRule } : {}),
    clockPreset: full.clockPreset,
    red: full.red,
    black: full.black,
    openSeats: (['red', 'black'] as const).filter((side) =>
      record.participants.every((item) => item.side !== side),
    ),
    createdAt: full.createdAt,
  }
}

export type OnlineCommandCommit = {
  state: OnlineRefereeState
  phase: MatchEntity['phase']
  status: MatchEntity['status']
  statusReason?: RoomStatusReason
  startedAt?: Date
  finishedAt?: Date
  participantReady?: boolean
  swapSides?: boolean
  proposal?:
    | { action: 'create'; kind: OnlineProposal['kind']; deadline: Date }
    | { action: 'resolve'; id: string; status: 'accepted' | 'rejected' | 'withdrawn' }
}

export class ActiveMatchQuotaError extends Error {
  constructor() {
    super('active_match_quota_exceeded')
    this.name = 'ActiveMatchQuotaError'
  }
}

export class MatchmakingQueueFullError extends Error {
  constructor() {
    super('matchmaking_queue_full')
    this.name = 'MatchmakingQueueFullError'
  }
}

export class MySqlOnlineMatchRepository {
  constructor(private readonly database: Database) {}

  async create(input: {
    userId: string
    name: string
    variant: MatchVariant
    gomokuRule?: 'freestyle' | 'renju'
    visibility: MatchEntity['visibility']
    side: RoomColor
    previousMatchId?: string
    competitionMode?: MatchEntity['competitionMode']
    clockPreset?: MatchEntity['clockPreset']
    maxActiveMatches?: number
  }): Promise<OnlineMatchRecord> {
    const state = createOnlineRefereeState(input.variant, input.name)
    return this.database.transaction(async (client) => {
      const profile = await this.requireActiveProfile(client, input.userId, true)
      if (input.maxActiveMatches !== undefined) {
        await this.assertActiveMatchCapacity(client, input.userId, input.maxActiveMatches)
      }
      if (input.previousMatchId) {
        const previous = await this.requireAccessibleMatch(
          client,
          input.previousMatchId,
          input.userId,
        )
        if (previous.phase !== 'finished') throw new Error('只能从已结束对局发起再来一局')
      }
      const id = randomUUID()
      const expiresAt = new Date(Date.now() + 365 * 86_400_000)
      await client.query(
        `INSERT INTO matches
          (id, variant, gomoku_rule, matchmaking, competition_mode, clock_preset, visibility,
           phase, status, previous_match_id, created_by_user_id, expires_at)
         VALUES (?, ?, ?, false, ?, ?, ?, 'waiting', 'playing', ?, ?, ?)`,
        [
          id,
          input.variant,
          input.variant === 'gomoku' ? (input.gomokuRule ?? 'freestyle') : null,
          input.competitionMode ?? 'casual',
          input.clockPreset ?? 'none',
          input.visibility,
          input.previousMatchId ?? null,
          input.userId,
          expiresAt,
        ],
      )
      await this.insertParticipant(client, id, input.userId, input.side, true, profile)
      await this.insertState(client, id, state)
      return this.requireRecord(client, id)
    })
  }

  async quickMatch(input: {
    userId: string
    variant: MatchVariant
    gomokuRule?: 'freestyle' | 'renju'
    competitionMode: MatchEntity['competitionMode']
    clockPreset: MatchEntity['clockPreset']
    requestKey: string
    maxActiveMatches?: number
    maxQueueEntries?: number
  }): Promise<{ record: OnlineMatchRecord; created: boolean }> {
    return this.database.transaction(async (client) => {
      const profile = await this.requireActiveProfile(client, input.userId, true)
      const previousRequest = await client.query<{ match_id: string }>(
        `SELECT match_id FROM matchmaking_requests
         WHERE user_id = ? AND request_key = ?`,
        [input.userId, input.requestKey],
      )
      if (previousRequest.rows[0]) {
        return {
          record: await this.requireRecord(client, previousRequest.rows[0].match_id),
          created: false,
        }
      }
      const partitionKey = `${input.variant}:${input.variant === 'gomoku' ? (input.gomokuRule ?? 'freestyle') : '-'}:${input.competitionMode}:${input.clockPreset}`
      await client.query(
        `INSERT INTO matchmaking_partitions (partition_key) VALUES ('__capacity__')
         ON DUPLICATE KEY UPDATE updated_at = updated_at`,
      )
      await client.query(
        "SELECT partition_key FROM matchmaking_partitions WHERE partition_key = '__capacity__' FOR UPDATE",
      )
      await client.query(
        `INSERT INTO matchmaking_partitions (partition_key) VALUES (?)
         ON DUPLICATE KEY UPDATE updated_at = updated_at`,
        [partitionKey],
      )
      await client.query(
        'SELECT partition_key FROM matchmaking_partitions WHERE partition_key = ? FOR UPDATE',
        [partitionKey],
      )
      await client.query(
        `DELETE m FROM matches m
         JOIN matchmaking_entries q ON q.match_id = m.id
         WHERE q.expires_at <= CURRENT_TIMESTAMP(6) AND m.phase = 'waiting'`,
      )
      const existing = await client.query<{ match_id: string }>(
        'SELECT match_id FROM matchmaking_entries WHERE user_id = ? FOR UPDATE',
        [input.userId],
      )
      if (existing.rows[0]) {
        await client.query(
          `INSERT INTO matchmaking_requests (user_id, request_key, match_id)
           VALUES (?, ?, ?)`,
          [input.userId, input.requestKey, existing.rows[0].match_id],
        )
        return {
          record: await this.requireRecord(client, existing.rows[0].match_id),
          created: true,
        }
      }
      if (input.maxActiveMatches !== undefined) {
        await this.assertActiveMatchCapacity(client, input.userId, input.maxActiveMatches)
      }
      const candidate = await client.query<{ user_id: string; match_id: string }>(
        `SELECT user_id, match_id FROM matchmaking_entries
         WHERE user_id <> ? AND variant = ? AND gomoku_rule <=> ?
           AND competition_mode = ? AND clock_preset = ? AND expires_at > CURRENT_TIMESTAMP(6)
         ORDER BY created_at, match_id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [
          input.userId,
          input.variant,
          input.variant === 'gomoku' ? (input.gomokuRule ?? 'freestyle') : null,
          input.competitionMode,
          input.clockPreset,
        ],
      )
      if (candidate.rows[0]) {
        const waiting = await this.requireMatch(client, candidate.rows[0].match_id, true)
        if (waiting.phase !== 'waiting') throw new Error('匹配候选已失效')
        const occupied = await client.query<{ side: RoomColor }>(
          `SELECT side FROM match_participants
           WHERE match_id = ? AND left_at IS NULL AND side IS NOT NULL FOR UPDATE`,
          [waiting.id],
        )
        const open: RoomColor = occupied.rows[0]?.side === 'red' ? 'black' : 'red'
        await this.insertParticipant(client, waiting.id, input.userId, open, false, profile, true)
        await client.query(
          `UPDATE match_participants SET ready = true
           WHERE match_id = ? AND left_at IS NULL AND side IS NOT NULL`,
          [waiting.id],
        )
        const now = authoritativeClockNow()
        const waitingState = await this.state(client, waiting, true)
        const clock = createOnlineClock(input.clockPreset, now)
        const startedState = clock ? { ...waitingState, clock } : waitingState
        await client.query(
          `UPDATE matches SET phase = 'playing', revision = revision + 1,
             started_at = ?, updated_at = ? WHERE id = ? AND phase = 'waiting'`,
          [now, now, waiting.id],
        )
        await client.query(
          `UPDATE match_states SET revision = revision + 1, public_state = ?, referee_state = ?,
             updated_at = ? WHERE match_id = ?`,
          [
            JSON.stringify(onlinePublicState(startedState)),
            JSON.stringify(startedState),
            now,
            waiting.id,
          ],
        )
        await client.query('DELETE FROM matchmaking_entries WHERE match_id = ?', [waiting.id])
        await client.query(
          `INSERT INTO matchmaking_requests (user_id, request_key, match_id)
           VALUES (?, ?, ?)`,
          [input.userId, input.requestKey, waiting.id],
        )
        return { record: await this.requireRecord(client, waiting.id), created: false }
      }
      if (input.maxQueueEntries !== undefined) {
        const queued = await client.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM matchmaking_entries
           WHERE expires_at > CURRENT_TIMESTAMP(6)`,
        )
        if (Number(queued.rows[0]?.count || 0) >= input.maxQueueEntries) {
          throw new MatchmakingQueueFullError()
        }
      }
      const id = randomUUID()
      const side: RoomColor = randomInt(2) ? 'red' : 'black'
      const state = createOnlineRefereeState(
        input.variant,
        matchName(input.variant, input.gomokuRule),
      )
      await client.query(
        `INSERT INTO matches
          (id, variant, gomoku_rule, matchmaking, competition_mode, clock_preset, visibility,
           phase, status, created_by_user_id, expires_at)
         VALUES (?, ?, ?, true, ?, ?, 'public', 'waiting', 'playing', ?, ?)`,
        [
          id,
          input.variant,
          input.variant === 'gomoku' ? (input.gomokuRule ?? 'freestyle') : null,
          input.competitionMode,
          input.clockPreset,
          input.userId,
          new Date(Date.now() + 365 * 86_400_000),
        ],
      )
      await this.insertParticipant(client, id, input.userId, side, true, profile, true)
      await this.insertState(client, id, state)
      await client.query(
        `INSERT INTO matchmaking_entries
          (user_id, match_id, variant, gomoku_rule, competition_mode, clock_preset,
           request_key, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.userId,
          id,
          input.variant,
          input.variant === 'gomoku' ? (input.gomokuRule ?? 'freestyle') : null,
          input.competitionMode,
          input.clockPreset,
          input.requestKey,
          new Date(Date.now() + 5 * 60_000),
        ],
      )
      await client.query(
        `INSERT INTO matchmaking_requests (user_id, request_key, match_id)
         VALUES (?, ?, ?)`,
        [input.userId, input.requestKey, id],
      )
      return { record: await this.requireRecord(client, id), created: true }
    })
  }

  async cancelMatchmaking(userId: string): Promise<{ cancelled: boolean; matchId?: string }> {
    return this.database.transaction(async (client) => {
      await this.requireActiveProfile(client, userId, true)
      const entry = await client.query<{ match_id: string }>(
        'SELECT match_id FROM matchmaking_entries WHERE user_id = ? FOR UPDATE',
        [userId],
      )
      if (!entry.rows[0]) return { cancelled: false }
      const match = await this.requireMatch(client, entry.rows[0].match_id, true)
      if (match.phase === 'waiting') {
        await client.query("DELETE FROM matches WHERE id = ? AND phase = 'waiting'", [match.id])
        return { cancelled: true, matchId: match.id }
      }
      await client.query('DELETE FROM matchmaking_entries WHERE user_id = ?', [userId])
      return { cancelled: false, matchId: match.id }
    })
  }

  async createInvite(
    userId: string,
    matchId: string,
    allowedSide?: RoomColor,
  ): Promise<{ token: string; expiresAt: Date }> {
    return this.database.transaction(async (client) => {
      const match = await this.requireMatch(client, matchId, true)
      const viewer = await this.requireParticipant(client, matchId, userId)
      if (!viewer.isOwner || match.phase !== 'waiting' || match.matchmaking) {
        throw new Error('当前不能创建邀请')
      }
      const occupied = await this.participants(client, matchId)
      if (allowedSide && occupied.some((item) => item.side === allowedSide)) {
        throw new Error('目标席位已被占用')
      }
      const token = randomUUID()
      const expiresAt = new Date(Date.now() + 24 * 60 * 60_000)
      await client.query(
        `INSERT INTO match_invites
          (id, match_id, created_by_user_id, token_hash, allowed_side, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [randomUUID(), matchId, userId, tokenHash(token), allowedSide ?? null, expiresAt],
      )
      return { token, expiresAt }
    })
  }

  async previewInvite(
    token: string,
  ): Promise<{ record: OnlineMatchRecord; allowedSide: RoomColor | null }> {
    return this.database.connection(async (client) => {
      const invite = await client.query<{ match_id: string; allowed_side: RoomColor | null }>(
        `SELECT match_id, allowed_side FROM match_invites
         WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL
           AND expires_at > CURRENT_TIMESTAMP(6)`,
        [tokenHash(token)],
      )
      if (!invite.rows[0]) throw new RepositoryNotFoundError()
      return {
        record: await this.requireRecord(client, invite.rows[0].match_id),
        allowedSide: invite.rows[0].allowed_side,
      }
    })
  }

  async joinInvite(
    userId: string,
    token: string,
    requestedSide?: RoomColor,
    maxActiveMatches?: number,
  ): Promise<OnlineMatchRecord> {
    return this.database.transaction(async (client) => {
      const profile = await this.requireActiveProfile(client, userId, true)
      const invite = await client.query<{
        id: string
        match_id: string
        allowed_side: RoomColor | null
      }>(
        `SELECT id, match_id, allowed_side FROM match_invites
         WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL
           AND expires_at > CURRENT_TIMESTAMP(6) FOR UPDATE`,
        [tokenHash(token)],
      )
      if (!invite.rows[0]) throw new RepositoryNotFoundError()
      const match = await this.requireMatch(client, invite.rows[0].match_id, true)
      if (match.phase !== 'waiting') throw new Error('邀请对应的对局已开始或结束')
      const current = await this.participants(client, match.id, true)
      const existing = current.find((item) => item.userId === userId)
      if (existing) {
        await client.query(
          `UPDATE match_invites SET used_by_user_id = ?, used_at = CURRENT_TIMESTAMP(6)
           WHERE id = ? AND used_at IS NULL`,
          [userId, invite.rows[0].id],
        )
        return this.requireRecord(client, match.id)
      }
      if (maxActiveMatches !== undefined) {
        await this.assertActiveMatchCapacity(client, userId, maxActiveMatches)
      }
      const allowed = invite.rows[0].allowed_side
      const side =
        allowed ?? requestedSide ?? (current.some((item) => item.side === 'red') ? 'black' : 'red')
      if (allowed && requestedSide && requestedSide !== allowed)
        throw new Error('邀请仅允许加入指定席位')
      if (current.some((item) => item.side === side)) throw new Error('目标席位已被占用')
      await this.insertParticipant(client, match.id, userId, side, false, profile)
      const used = await client.query(
        `UPDATE match_invites SET used_by_user_id = ?, used_at = CURRENT_TIMESTAMP(6)
         WHERE id = ? AND used_at IS NULL`,
        [userId, invite.rows[0].id],
      )
      if (used.rowCount !== 1) throw new RepositoryUniqueConflictError()
      return this.requireRecord(client, match.id)
    })
  }

  async joinPublic(
    userId: string,
    matchId: string,
    requestedSide?: RoomColor,
    maxActiveMatches?: number,
  ): Promise<OnlineMatchRecord> {
    return this.database.transaction(async (client) => {
      const profile = await this.requireActiveProfile(client, userId, true)
      const match = await this.requireMatch(client, matchId, true)
      if (match.visibility !== 'public' || match.matchmaking || match.phase !== 'waiting') {
        throw new RepositoryNotFoundError()
      }
      const current = await this.participants(client, match.id, true)
      const existing = current.find((item) => item.userId === userId)
      if (existing) return this.requireRecord(client, match.id)
      if (maxActiveMatches !== undefined) {
        await this.assertActiveMatchCapacity(client, userId, maxActiveMatches)
      }
      const side = requestedSide ?? (current.some((item) => item.side === 'red') ? 'black' : 'red')
      if (current.some((item) => item.side === side)) throw new Error('目标席位已被占用')
      await this.insertParticipant(client, match.id, userId, side, false, profile)
      return this.requireRecord(client, match.id)
    })
  }

  async findAccessible(matchId: string, userId: string): Promise<OnlineMatchRecord | null> {
    return this.database.connection(async (client) => {
      const match = await this.findMatch(client, matchId)
      if (!match) return null
      const participant = await this.findParticipant(client, matchId, userId)
      if (!participant && match.visibility !== 'public') return null
      return this.requireRecord(client, matchId)
    })
  }

  async findParticipating(matchId: string, userId: string): Promise<OnlineMatchRecord | null> {
    return this.database.connection(async (client) => {
      const match = await this.findMatch(client, matchId)
      if (!match || !(await this.findParticipant(client, matchId, userId))) return null
      return this.requireRecord(client, matchId)
    })
  }

  async findPublicReplay(matchId: string): Promise<OnlineMatchRecord | null> {
    return this.database.connection(async (client) => {
      const match = await this.findMatch(client, matchId)
      if (!match || match.visibility !== 'public' || match.phase !== 'finished') return null
      return this.requireRecord(client, matchId)
    })
  }

  async listLobby(
    input: {
      variant?: MatchVariant
      limit?: number
    } = {},
  ): Promise<OnlineLobbyMatch[]> {
    const limit = Math.min(50, Math.max(1, input.limit ?? 20))
    return this.database.connection(async (client) => {
      const result = await client.query<{ id: string }>(
        `SELECT id FROM matches
         WHERE visibility = 'public' AND phase = 'waiting' AND matchmaking = false
           AND (? IS NULL OR variant = ?)
         ORDER BY created_at DESC, id DESC LIMIT ?`,
        [input.variant ?? null, input.variant ?? null, limit],
      )
      return Promise.all(
        result.rows.map(async (row) => lobbySummary(await this.requireRecord(client, row.id))),
      )
    })
  }

  async listHistory(input: {
    userId: string
    variant?: MatchVariant
    status?: MatchEntity['status']
    from?: Date
    to?: Date
    before?: Date
    limit?: number
  }): Promise<OnlineHistoryPage> {
    const limit = Math.min(50, Math.max(1, input.limit ?? 20))
    return this.database.connection(async (client) => {
      const result = await client.query<{ id: string; updated_at: Date }>(
        `SELECT m.id, m.updated_at FROM matches m
         JOIN match_participants p ON p.match_id = m.id
         WHERE p.user_id = ? AND p.left_at IS NULL
           AND (? IS NULL OR m.variant = ?) AND (? IS NULL OR m.status = ?)
           AND (? IS NULL OR m.updated_at >= ?) AND (? IS NULL OR m.updated_at <= ?)
           AND (? IS NULL OR m.updated_at < ?)
         ORDER BY m.updated_at DESC, m.id DESC LIMIT ?`,
        [
          input.userId,
          input.variant ?? null,
          input.variant ?? null,
          input.status ?? null,
          input.status ?? null,
          input.from ?? null,
          input.from ?? null,
          input.to ?? null,
          input.to ?? null,
          input.before ?? null,
          input.before ?? null,
          limit + 1,
        ],
      )
      const page = result.rows.slice(0, limit)
      return {
        matches: await Promise.all(
          page.map(async (row) => summary(await this.requireRecord(client, row.id))),
        ),
        ...(result.rows.length > limit && page.at(-1)
          ? { nextCursor: page.at(-1)!.updated_at.toISOString() }
          : {}),
      }
    })
  }

  async commitCommand(input: {
    userId: string
    matchId: string
    commandId: string
    commandType: string
    expectedRevision: number
    expectedSide?: RoomColor | null
    requireOwner?: boolean
    commit: OnlineCommandCommit
  }): Promise<{ record: OnlineMatchRecord; duplicate: boolean }> {
    return this.database.transaction(async (client) => {
      const match = await this.requireMatch(client, input.matchId, true)
      const previous = await client.query<{ result_revision: string }>(
        `SELECT result_revision FROM match_commands
         WHERE match_id = ? AND user_id = ? AND command_id = ?`,
        [input.matchId, input.userId, input.commandId],
      )
      if (previous.rows[0]) {
        return { record: await this.requireRecord(client, input.matchId), duplicate: true }
      }
      if (match.revision !== input.expectedRevision) {
        throw new RepositoryRevisionConflictError(match.revision)
      }
      const actor = await this.requireParticipant(client, input.matchId, input.userId, true)
      if (input.expectedSide !== undefined && actor.side !== input.expectedSide) {
        throw new Error('当前账号不再占据原席位')
      }
      if (input.requireOwner && !actor.isOwner) throw new Error('只有房主可以执行此操作')
      const currentState = await this.state(client, match, true)
      if (
        JSON.stringify(currentState) !== JSON.stringify(input.commit.state) &&
        match.phase === 'finished'
      ) {
        throw new Error('已结束对局只读')
      }
      if (input.commit.participantReady !== undefined) {
        await client.query(
          `UPDATE match_participants SET ready = ?
           WHERE match_id = ? AND user_id = ? AND left_at IS NULL`,
          [input.commit.participantReady, input.matchId, input.userId],
        )
      }
      if (input.commit.swapSides) {
        const players = await this.participants(client, input.matchId, true)
        const red = players.find((item) => item.side === 'red')
        const black = players.find((item) => item.side === 'black')
        if (!red || !black) throw new Error('双方席位不完整')
        await client.query(
          'UPDATE match_participants SET side = NULL, ready = false WHERE id IN (?, ?)',
          [red.id, black.id],
        )
        await client.query("UPDATE match_participants SET side = 'black' WHERE id = ?", [red.id])
        await client.query("UPDATE match_participants SET side = 'red' WHERE id = ?", [black.id])
      }
      if (input.commit.proposal?.action === 'create') {
        await client.query(
          `UPDATE match_proposals SET status = 'expired', resolved_at = CURRENT_TIMESTAMP(6)
           WHERE match_id = ? AND status = 'pending' AND deadline <= CURRENT_TIMESTAMP(6)`,
          [input.matchId],
        )
        await client.query(
          `INSERT INTO match_proposals
            (id, match_id, kind, proposed_by_user_id, deadline)
           VALUES (?, ?, ?, ?, ?)`,
          [
            randomUUID(),
            input.matchId,
            input.commit.proposal.kind,
            input.userId,
            input.commit.proposal.deadline,
          ],
        )
      } else if (input.commit.proposal?.action === 'resolve') {
        const resolved = await client.query(
          `UPDATE match_proposals SET status = ?, resolved_by_user_id = ?,
             resolved_at = CURRENT_TIMESTAMP(6)
           WHERE id = ? AND match_id = ? AND status = 'pending'
             AND deadline > CURRENT_TIMESTAMP(6)`,
          [input.commit.proposal.status, input.userId, input.commit.proposal.id, input.matchId],
        )
        if (resolved.rowCount !== 1) throw new Error('申请已过期或被处理')
      }
      const nextRevision = match.revision + 1
      const result = await client.query(
        `UPDATE matches SET revision = ?, phase = ?, status = ?, status_reason = ?,
           started_at = COALESCE(started_at, ?), finished_at = ?, updated_at = CURRENT_TIMESTAMP(6)
         WHERE id = ? AND revision = ?`,
        [
          nextRevision,
          input.commit.phase,
          input.commit.status,
          input.commit.statusReason ?? null,
          input.commit.startedAt ?? null,
          input.commit.phase === 'finished' ? (input.commit.finishedAt ?? new Date()) : null,
          input.matchId,
          match.revision,
        ],
      )
      if (result.rowCount !== 1) throw new RepositoryRevisionConflictError(match.revision)
      await client.query(
        `UPDATE match_states SET revision = ?, public_state = ?, referee_state = ?,
           updated_at = CURRENT_TIMESTAMP(6)
         WHERE match_id = ? AND revision = ?`,
        [
          nextRevision,
          JSON.stringify(onlinePublicState(input.commit.state)),
          JSON.stringify(input.commit.state),
          input.matchId,
          match.revision,
        ],
      )
      await client.query(
        `INSERT INTO match_commands
          (match_id, user_id, command_id, command_type, result_revision)
         VALUES (?, ?, ?, ?, ?)`,
        [input.matchId, input.userId, input.commandId, input.commandType, nextRevision],
      )
      await this.settleRatedMatch(client, input.matchId)
      return { record: await this.requireRecord(client, input.matchId), duplicate: false }
    })
  }

  async findCommand(
    matchId: string,
    userId: string,
    commandId: string,
  ): Promise<OnlineMatchRecord | null> {
    return this.database.connection(async (client) => {
      const result = await client.query<{ present: number }>(
        `SELECT EXISTS(
           SELECT 1 FROM match_commands WHERE match_id = ? AND user_id = ? AND command_id = ?
         ) AS present`,
        [matchId, userId, commandId],
      )
      return Number(result.rows[0]?.present) === 1 ? this.requireRecord(client, matchId) : null
    })
  }

  async listChat(matchId: string, userId: string, limit = 100): Promise<OnlineChatMessage[]> {
    return this.database.connection(async (client) => {
      await this.requireReadable(client, matchId, userId)
      const result = await client.query<{
        id: string
        sequence: string
        author_user_id: string | null
        display_name_snapshot: string
        role_snapshot: OnlineChatMessage['role']
        content: string
        created_at: Date
      }>(
        `SELECT id, sequence, author_user_id, display_name_snapshot, role_snapshot, content, created_at
         FROM match_chat_messages
         WHERE match_id = ? AND moderation_state <> 'deleted' AND content IS NOT NULL
         ORDER BY sequence DESC LIMIT ?`,
        [matchId, Math.min(100, Math.max(1, limit))],
      )
      return result.rows.reverse().map((row) => ({
        id: row.id,
        sequence: Number(row.sequence),
        authorUserId: row.author_user_id,
        nickname: row.display_name_snapshot,
        role: row.role_snapshot,
        content: row.content,
        createdAt: row.created_at.toISOString(),
      }))
    })
  }

  async appendChat(input: {
    matchId: string
    userId: string
    commandId: string
    content: string
  }): Promise<OnlineChatMessage> {
    return this.database.transaction(async (client) => {
      const match = await this.requireReadable(client, input.matchId, input.userId, true)
      const previous = await client.query<{ result_id: string | null }>(
        `SELECT result_id FROM match_commands
         WHERE match_id = ? AND user_id = ? AND command_id = ?`,
        [input.matchId, input.userId, input.commandId],
      )
      if (previous.rows[0]?.result_id) {
        const existing = await client.query<{
          id: string
          sequence: string
          author_user_id: string | null
          display_name_snapshot: string
          role_snapshot: OnlineChatMessage['role']
          content: string
          created_at: Date
        }>(
          `SELECT id, sequence, author_user_id, display_name_snapshot, role_snapshot, content, created_at
           FROM match_chat_messages WHERE id = ? AND moderation_state <> 'deleted'`,
          [previous.rows[0].result_id],
        )
        const row = existing.rows[0]
        if (row) {
          return {
            id: row.id,
            sequence: Number(row.sequence),
            authorUserId: row.author_user_id,
            nickname: row.display_name_snapshot,
            role: row.role_snapshot,
            content: row.content,
            createdAt: row.created_at.toISOString(),
          }
        }
      }
      if (match.phase === 'finished') throw new Error('已结束对局的聊天只读')
      const profile = await this.requireActiveProfile(client, input.userId)
      const actor = await this.findParticipant(client, input.matchId, input.userId, true)
      const settings = await client.query<{
        everyone_muted: number | boolean
        next_sequence: string
      }>(
        `SELECT everyone_muted, next_sequence FROM match_chat_settings
         WHERE match_id = ? FOR UPDATE`,
        [input.matchId],
      )
      if (Boolean(settings.rows[0]?.everyone_muted) && !actor?.isOwner)
        throw new Error('当前对局已全员禁言')
      const muted = await client.query<{ present: number }>(
        `SELECT EXISTS(SELECT 1 FROM match_chat_mutes WHERE match_id = ? AND user_id = ?) AS present`,
        [input.matchId, input.userId],
      )
      if (Number(muted.rows[0]?.present) === 1 && !actor?.isOwner) throw new Error('你已被本局禁言')
      const sequence = Number(settings.rows[0]?.next_sequence ?? 1)
      const id = randomUUID()
      const role = actor?.side ?? (actor?.isOwner ? 'owner' : 'spectator')
      await client.query(
        `INSERT INTO match_chat_messages
          (id, match_id, sequence, author_user_id, display_name_snapshot, role_snapshot, content)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, input.matchId, sequence, input.userId, profile, role, input.content],
      )
      await client.query(
        `UPDATE match_chat_settings SET next_sequence = next_sequence + 1,
           updated_at = CURRENT_TIMESTAMP(6) WHERE match_id = ?`,
        [input.matchId],
      )
      await client.query(
        `INSERT INTO match_commands
          (match_id, user_id, command_id, command_type, result_revision, result_id)
         VALUES (?, ?, ?, 'chat', ?, ?)`,
        [input.matchId, input.userId, input.commandId, match.revision, id],
      )
      return {
        id,
        sequence,
        authorUserId: input.userId,
        nickname: profile,
        role,
        content: input.content,
        createdAt: new Date().toISOString(),
      }
    })
  }

  async deleteChat(matchId: string, userId: string, messageId: string): Promise<void> {
    await this.database.transaction(async (client) => {
      const actor = await this.findParticipant(client, matchId, userId, true)
      const message = await client.query<{ author_user_id: string | null }>(
        `SELECT author_user_id FROM match_chat_messages
         WHERE id = ? AND match_id = ? AND moderation_state <> 'deleted' FOR UPDATE`,
        [messageId, matchId],
      )
      if (!message.rows[0]) throw new RepositoryNotFoundError()
      if (!actor?.isOwner && message.rows[0].author_user_id !== userId)
        throw new RepositoryNotFoundError()
      await client.query(
        `UPDATE match_chat_messages SET content = NULL, moderation_state = 'deleted',
           deleted_at = CURRENT_TIMESTAMP(6), deletion_reason = ? WHERE id = ?`,
        [actor?.isOwner ? 'owner_moderation' : 'author_deleted', messageId],
      )
    })
  }

  async setMute(
    matchId: string,
    ownerUserId: string,
    targetUserId: string,
    muted: boolean,
  ): Promise<void> {
    await this.database.transaction(async (client) => {
      const owner = await this.requireParticipant(client, matchId, ownerUserId)
      if (!owner.isOwner) throw new Error('只有房主可以管理禁言')
      if (muted) {
        await client.query(
          `INSERT INTO match_chat_mutes (match_id, user_id, muted_by_user_id)
           VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE muted_by_user_id = VALUES(muted_by_user_id),
             created_at = CURRENT_TIMESTAMP(6)`,
          [matchId, targetUserId, ownerUserId],
        )
      } else {
        await client.query('DELETE FROM match_chat_mutes WHERE match_id = ? AND user_id = ?', [
          matchId,
          targetUserId,
        ])
      }
    })
  }

  async cleanupUserActivityForDeletion(userId: string): Promise<OnlineMatchRecord[]> {
    return this.database.transaction(async (client) => {
      const now = authoritativeClockNow()
      await client.query('DELETE FROM matchmaking_entries WHERE user_id = ?', [userId])
      await client.query('DELETE FROM matchmaking_requests WHERE user_id = ?', [userId])
      const active = await client.query<{ match_id: string }>(
        `SELECT p.match_id FROM match_participants p
         JOIN matches m ON m.id = p.match_id
         WHERE p.user_id = ? AND p.left_at IS NULL AND m.phase IN ('waiting', 'playing')
         ORDER BY p.match_id FOR UPDATE`,
        [userId],
      )
      const changed: OnlineMatchRecord[] = []
      for (const row of active.rows) {
        const match = await this.requireMatch(client, row.match_id, true)
        const actor = await this.findParticipant(client, row.match_id, userId, true)
        if (!actor) continue
        if (match.phase === 'waiting') {
          if (actor.isOwner || match.matchmaking) {
            await client.query("DELETE FROM matches WHERE id = ? AND phase = 'waiting'", [match.id])
            continue
          }
          await client.query(
            `UPDATE match_participants
             SET side = NULL, is_owner = false, ready = false, left_at = ?,
                 disconnected_at = NULL, disconnect_deadline = NULL
             WHERE id = ? AND left_at IS NULL`,
            [now, actor.id],
          )
          changed.push(await this.requireRecord(client, match.id))
          continue
        }
        if (!actor.side) {
          await client.query(
            `UPDATE match_participants SET left_at = ?, is_owner = false, ready = false,
               disconnected_at = NULL, disconnect_deadline = NULL
             WHERE id = ? AND left_at IS NULL`,
            [now, actor.id],
          )
          changed.push(await this.requireRecord(client, match.id))
          continue
        }
        const state = await this.state(client, match, true)
        const finishedState = state.clock
          ? { ...state, clock: stopOnlineClock(state.clock, now) }
          : state
        const next = match.revision + 1
        const status: MatchEntity['status'] = actor.side === 'red' ? 'black-wins' : 'red-wins'
        const updated = await client.query(
          `UPDATE matches SET revision = ?, phase = 'finished', status = ?,
             status_reason = 'disconnect', finished_at = ?, updated_at = ?
           WHERE id = ? AND revision = ? AND phase = 'playing'`,
          [next, status, now, now, match.id, match.revision],
        )
        if (updated.rowCount !== 1) throw new RepositoryRevisionConflictError()
        const stateUpdated = await client.query(
          `UPDATE match_states SET revision = ?, public_state = ?, referee_state = ?, updated_at = ?
           WHERE match_id = ? AND revision = ?`,
          [
            next,
            JSON.stringify(onlinePublicState(finishedState)),
            JSON.stringify(finishedState),
            now,
            match.id,
            match.revision,
          ],
        )
        if (stateUpdated.rowCount !== 1) throw new RepositoryRevisionConflictError()
        await client.query(
          `UPDATE match_participants SET disconnected_at = ?, disconnect_deadline = ?
           WHERE id = ? AND left_at IS NULL`,
          [now, now, actor.id],
        )
        changed.push(await this.requireRecord(client, match.id))
      }
      return changed
    })
  }

  async setPresence(
    matchId: string,
    userId: string,
    connected: boolean,
    deadline?: Date,
  ): Promise<boolean> {
    return this.database.transaction(async (client) => {
      const result = await client.query(
        `UPDATE match_participants SET disconnected_at = ?, disconnect_deadline = ?
         WHERE match_id = ? AND user_id = ? AND left_at IS NULL AND side IS NOT NULL`,
        [connected ? null : new Date(), connected ? null : (deadline ?? null), matchId, userId],
      )
      return result.rowCount === 1
    })
  }

  async adjudicateDisconnect(
    matchId: string,
    userId: string,
    deadline: Date,
  ): Promise<OnlineMatchRecord | null> {
    return this.database.transaction(async (client) => {
      const match = await this.requireMatch(client, matchId, true)
      if (match.phase !== 'playing') return null
      const players = await this.participants(client, matchId, true)
      const disconnected = players.find(
        (item) =>
          item.userId === userId && item.disconnectDeadline?.getTime() === deadline.getTime(),
      )
      if (!disconnected?.side || deadline.getTime() > Date.now()) return null
      const bothOffline = players
        .filter((item) => item.side)
        .every((item) => item.disconnectDeadline && item.disconnectDeadline.getTime() <= Date.now())
      const status: MatchEntity['status'] = bothOffline
        ? 'draw'
        : disconnected.side === 'red'
          ? 'black-wins'
          : 'red-wins'
      const reason: RoomStatusReason = bothOffline ? 'abandoned' : 'disconnect'
      const next = match.revision + 1
      const state = await this.state(client, match, true)
      const finishedState = state.clock
        ? { ...state, clock: stopOnlineClock(state.clock, authoritativeClockNow()) }
        : state
      await client.query(
        `UPDATE matches SET revision = ?, phase = 'finished', status = ?, status_reason = ?,
           finished_at = CURRENT_TIMESTAMP(6), updated_at = CURRENT_TIMESTAMP(6)
         WHERE id = ? AND revision = ? AND phase = 'playing'`,
        [next, status, reason, matchId, match.revision],
      )
      await client.query(
        `UPDATE match_states SET revision = ?, public_state = ?, referee_state = ?,
           updated_at = CURRENT_TIMESTAMP(6)
         WHERE match_id = ? AND revision = ?`,
        [
          next,
          JSON.stringify(onlinePublicState(finishedState)),
          JSON.stringify(finishedState),
          matchId,
          match.revision,
        ],
      )
      return this.requireRecord(client, matchId)
    })
  }

  async adjudicateClock(matchId: string, deadlineAt: string): Promise<OnlineMatchRecord | null> {
    return this.database.transaction(async (client) => {
      const match = await this.requireMatch(client, matchId, true)
      if (match.phase !== 'playing') return null
      const state = await this.state(client, match, true)
      const clock = state.clock
      if (
        !clock?.activeSide ||
        clock.deadlineAt !== deadlineAt ||
        new Date(deadlineAt).getTime() > authoritativeClockNow().getTime()
      ) {
        return null
      }
      const loser = clock.activeSide
      const finishedState = {
        ...state,
        clock: {
          ...stopOnlineClock(clock, new Date(deadlineAt)),
          ...(loser === 'red' ? { redRemainingMs: 0 } : { blackRemainingMs: 0 }),
        },
      }
      const next = match.revision + 1
      const updated = await client.query(
        `UPDATE matches SET revision = ?, phase = 'finished', status = ?,
           status_reason = 'timeout', finished_at = CURRENT_TIMESTAMP(6),
           updated_at = CURRENT_TIMESTAMP(6)
         WHERE id = ? AND revision = ? AND phase = 'playing'`,
        [next, loser === 'red' ? 'black-wins' : 'red-wins', matchId, match.revision],
      )
      if (updated.rowCount !== 1) return null
      await client.query(
        `UPDATE match_states SET revision = ?, public_state = ?, referee_state = ?,
           updated_at = CURRENT_TIMESTAMP(6)
         WHERE match_id = ? AND revision = ?`,
        [
          next,
          JSON.stringify(onlinePublicState(finishedState)),
          JSON.stringify(finishedState),
          matchId,
          match.revision,
        ],
      )
      await this.settleRatedMatch(client, matchId)
      return this.requireRecord(client, matchId)
    })
  }

  async listRatings(userId: string): Promise<OnlineRating[]> {
    return this.database.connection(async (client) => {
      const result = await client.query<{
        pool_key: RatingPool
        rating: number
        games_played: number
        wins: number
        draws: number
        losses: number
        updated_at: Date
      }>(
        `SELECT pool_key, rating, games_played, wins, draws, losses, updated_at
         FROM user_ratings WHERE user_id = ? ORDER BY pool_key`,
        [userId],
      )
      return result.rows.map((row) => ({
        pool: row.pool_key,
        rating: Number(row.rating),
        gamesPlayed: Number(row.games_played),
        wins: Number(row.wins),
        draws: Number(row.draws),
        losses: Number(row.losses),
        provisional: Number(row.games_played) < ratingPolicy.provisionalGames,
        updatedAt: row.updated_at.toISOString(),
      }))
    })
  }

  async voidRatingSettlement(matchId: string, reason: string): Promise<boolean> {
    const normalizedReason = reason.trim()
    if (!normalizedReason || Array.from(normalizedReason).length > 200) {
      throw new Error('作废原因必须为 1 至 200 字')
    }
    return this.database.transaction(async (client) => {
      const result = await client.query<{
        pool_key: RatingPool
        red_user_id: string | null
        black_user_id: string | null
        red_rating_before: number
        red_rating_after: number
        black_rating_before: number
        black_rating_after: number
        result: MatchEntity['status']
        voided_at: Date | null
      }>(
        `SELECT pool_key, red_user_id, black_user_id, red_rating_before, red_rating_after,
                black_rating_before, black_rating_after, result, voided_at
         FROM match_rating_settlements WHERE match_id = ? FOR UPDATE`,
        [matchId],
      )
      const settlement = result.rows[0]
      if (!settlement) return false
      if (settlement.voided_at) return false
      if (!settlement.red_user_id || !settlement.black_user_id) {
        throw new Error('账号已删除，不能自动补偿等级分')
      }
      const ratings = await client.query<{
        user_id: string
        rating: number
        games_played: number
      }>(
        `SELECT user_id, rating, games_played FROM user_ratings
         WHERE pool_key = ? AND user_id IN (?, ?) ORDER BY user_id FOR UPDATE`,
        [settlement.pool_key, settlement.red_user_id, settlement.black_user_id],
      )
      const byUser = new Map(ratings.rows.map((row) => [row.user_id, row]))
      const red = byUser.get(settlement.red_user_id)
      const black = byUser.get(settlement.black_user_id)
      if (!red || !black || Number(red.games_played) < 1 || Number(black.games_played) < 1) {
        throw new Error('等级分状态无法补偿')
      }
      const redDelta = Number(settlement.red_rating_before) - Number(settlement.red_rating_after)
      const blackDelta =
        Number(settlement.black_rating_before) - Number(settlement.black_rating_after)
      const redAfter = Number(red.rating) + redDelta
      const blackAfter = Number(black.rating) + blackDelta
      if (redAfter < 100 || blackAfter < 100) throw new Error('补偿后等级分低于下限')
      const counters = (side: 'red' | 'black') => {
        const won = settlement.result === `${side}-wins`
        const draw = settlement.result === 'draw'
        return [won ? 1 : 0, draw ? 1 : 0, !won && !draw ? 1 : 0]
      }
      const redCounters = counters('red')
      const blackCounters = counters('black')
      await client.query(
        `UPDATE user_ratings SET rating = ?, games_played = games_played - 1,
           wins = wins - ?, draws = draws - ?, losses = losses - ?,
           updated_at = CURRENT_TIMESTAMP(6) WHERE user_id = ? AND pool_key = ?`,
        [redAfter, ...redCounters, settlement.red_user_id, settlement.pool_key],
      )
      await client.query(
        `UPDATE user_ratings SET rating = ?, games_played = games_played - 1,
           wins = wins - ?, draws = draws - ?, losses = losses - ?,
           updated_at = CURRENT_TIMESTAMP(6) WHERE user_id = ? AND pool_key = ?`,
        [blackAfter, ...blackCounters, settlement.black_user_id, settlement.pool_key],
      )
      await client.query(
        `UPDATE match_rating_settlements SET voided_at = CURRENT_TIMESTAMP(6), void_reason = ?
         WHERE match_id = ? AND voided_at IS NULL`,
        [normalizedReason, matchId],
      )
      await this.insertRatingLedger(client, {
        matchId,
        userId: settlement.red_user_id,
        pool: settlement.pool_key,
        entryType: 'void',
        before: Number(red.rating),
        after: redAfter,
        reason: normalizedReason,
      })
      await this.insertRatingLedger(client, {
        matchId,
        userId: settlement.black_user_id,
        pool: settlement.pool_key,
        entryType: 'void',
        before: Number(black.rating),
        after: blackAfter,
        reason: normalizedReason,
      })
      return true
    })
  }

  async recoverActiveMatches(): Promise<OnlineMatchRecord[]> {
    return this.database.connection(async (client) => {
      const matches = await client.query<{ id: string }>(
        `SELECT id FROM matches WHERE phase IN ('waiting', 'playing') ORDER BY created_at`,
      )
      return Promise.all(matches.rows.map((row) => this.requireRecord(client, row.id)))
    })
  }

  private async settleRatedMatch(client: Queryable, matchId: string): Promise<void> {
    const match = await this.requireMatch(client, matchId, true)
    if (!isRatedMatchEligible(match)) return
    const settled = await client.query<{ present: number }>(
      `SELECT EXISTS(
         SELECT 1 FROM match_rating_settlements WHERE match_id = ?
       ) AS present`,
      [matchId],
    )
    if (Number(settled.rows[0]?.present) === 1) return
    const participants = await this.participants(client, matchId, true)
    const redUserId = participants.find((item) => item.side === 'red')?.userId
    const blackUserId = participants.find((item) => item.side === 'black')?.userId
    if (!redUserId || !blackUserId || redUserId === blackUserId) {
      throw new Error('排位对局缺少有效双方账号')
    }
    const pool = ratingPool(match.variant, match.gomokuRule)
    const orderedUsers = [redUserId, blackUserId].sort()
    await client.query(
      `INSERT INTO user_ratings (user_id, pool_key) VALUES (?, ?), (?, ?)
       ON DUPLICATE KEY UPDATE updated_at = updated_at`,
      [orderedUsers[0], pool, orderedUsers[1], pool],
    )
    const ratings = await client.query<{
      user_id: string
      rating: number
      games_played: number
    }>(
      `SELECT user_id, rating, games_played FROM user_ratings
       WHERE pool_key = ? AND user_id IN (?, ?) ORDER BY user_id FOR UPDATE`,
      [pool, redUserId, blackUserId],
    )
    const byUser = new Map(ratings.rows.map((row) => [row.user_id, row]))
    const red = byUser.get(redUserId)
    const black = byUser.get(blackUserId)
    if (!red || !black) throw new Error('等级分初始化失败')
    const calculation = calculateRating({
      redRating: Number(red.rating),
      blackRating: Number(black.rating),
      redGames: Number(red.games_played),
      blackGames: Number(black.games_played),
      status: match.status,
    })
    const counters = (side: 'red' | 'black') => {
      const won = match.status === `${side}-wins`
      const draw = match.status === 'draw'
      return [won ? 1 : 0, draw ? 1 : 0, !won && !draw ? 1 : 0]
    }
    const redCounters = counters('red')
    const blackCounters = counters('black')
    await client.query(
      `INSERT INTO match_rating_settlements
        (match_id, pool_key, model, red_user_id, black_user_id, result, k_factor,
         red_rating_before, red_rating_after, black_rating_before, black_rating_after)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        matchId,
        pool,
        ratingPolicy.model,
        redUserId,
        blackUserId,
        match.status,
        calculation.kFactor,
        Number(red.rating),
        calculation.redAfter,
        Number(black.rating),
        calculation.blackAfter,
      ],
    )
    await client.query(
      `UPDATE user_ratings SET rating = ?, games_played = games_played + 1,
         wins = wins + ?, draws = draws + ?, losses = losses + ?,
         updated_at = CURRENT_TIMESTAMP(6) WHERE user_id = ? AND pool_key = ?`,
      [calculation.redAfter, ...redCounters, redUserId, pool],
    )
    await client.query(
      `UPDATE user_ratings SET rating = ?, games_played = games_played + 1,
         wins = wins + ?, draws = draws + ?, losses = losses + ?,
         updated_at = CURRENT_TIMESTAMP(6) WHERE user_id = ? AND pool_key = ?`,
      [calculation.blackAfter, ...blackCounters, blackUserId, pool],
    )
    await this.insertRatingLedger(client, {
      matchId,
      userId: redUserId,
      pool,
      entryType: 'settlement',
      before: Number(red.rating),
      after: calculation.redAfter,
      reason: match.statusReason!,
    })
    await this.insertRatingLedger(client, {
      matchId,
      userId: blackUserId,
      pool,
      entryType: 'settlement',
      before: Number(black.rating),
      after: calculation.blackAfter,
      reason: match.statusReason!,
    })
  }

  private async insertRatingLedger(
    client: Queryable,
    input: {
      matchId: string
      userId: string
      pool: RatingPool
      entryType: 'settlement' | 'void'
      before: number
      after: number
      reason: string
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO rating_ledger
        (id, match_id, user_id, pool_key, entry_type, rating_before, rating_after, delta, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        input.matchId,
        input.userId,
        input.pool,
        input.entryType,
        input.before,
        input.after,
        input.after - input.before,
        input.reason,
      ],
    )
  }

  private async insertState(client: Queryable, matchId: string, state: OnlineRefereeState) {
    await client.query(
      `INSERT INTO match_states (match_id, schema_version, revision, public_state, referee_state)
       VALUES (?, 1, 0, ?, ?)`,
      [matchId, JSON.stringify(onlinePublicState(state)), JSON.stringify(state)],
    )
    await client.query('INSERT INTO match_chat_settings (match_id) VALUES (?)', [matchId])
  }

  private async insertParticipant(
    client: Queryable,
    matchId: string,
    userId: string,
    side: RoomColor,
    isOwner: boolean,
    displayName: string,
    ready = false,
  ) {
    await client.query(
      `INSERT INTO match_participants
        (id, match_id, user_id, side, is_owner, display_name_snapshot, ready)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), matchId, userId, side, isOwner, displayName, ready],
    )
  }

  private async requireActiveProfile(
    client: Queryable,
    userId: string,
    lock = false,
  ): Promise<string> {
    const result = await client.query<{ display_name: string }>(
      `SELECT p.display_name FROM users u JOIN user_profiles p ON p.user_id = u.id
       WHERE u.id = ? AND u.status = 'active'${lock ? ' FOR UPDATE' : ''}`,
      [userId],
    )
    if (!result.rows[0]) throw new Error('账号未验证或当前不可参与公网对局')
    return result.rows[0].display_name
  }

  private async assertActiveMatchCapacity(client: Queryable, userId: string, maximum: number) {
    const result = await client.query<{ active_count: string | number }>(
      `SELECT COUNT(*) AS active_count
       FROM match_participants p
       JOIN matches m ON m.id = p.match_id
       WHERE p.user_id = ? AND p.left_at IS NULL AND p.side IS NOT NULL
         AND m.phase IN ('waiting', 'playing')`,
      [userId],
    )
    if (Number(result.rows[0]?.active_count) >= maximum) {
      throw new ActiveMatchQuotaError()
    }
  }

  private async findMatch(client: Queryable, id: string): Promise<MatchEntity | null> {
    const result = await client.query<MatchRow>(
      `SELECT ${MATCH_COLUMNS} FROM matches WHERE id = ?`,
      [id],
    )
    return result.rows[0] ? matchEntity(result.rows[0]) : null
  }

  private async requireMatch(client: Queryable, id: string, lock = false): Promise<MatchEntity> {
    const result = await client.query<MatchRow>(
      `SELECT ${MATCH_COLUMNS} FROM matches WHERE id = ?${lock ? ' FOR UPDATE' : ''}`,
      [id],
    )
    if (!result.rows[0]) throw new RepositoryNotFoundError()
    return matchEntity(result.rows[0])
  }

  private async participants(
    client: Queryable,
    id: string,
    lock = false,
  ): Promise<OnlineParticipant[]> {
    const result = await client.query<ParticipantRow>(
      `SELECT id, user_id, side, is_owner, display_name_snapshot, ready, hints_used, joined_at,
              disconnected_at, disconnect_deadline
       FROM match_participants WHERE match_id = ? AND left_at IS NULL
       ORDER BY joined_at, id${lock ? ' FOR UPDATE' : ''}`,
      [id],
    )
    return result.rows.map(participant)
  }

  private async findParticipant(
    client: Queryable,
    matchId: string,
    userId: string,
    lock = false,
  ): Promise<OnlineParticipant | null> {
    const result = await client.query<ParticipantRow>(
      `SELECT id, user_id, side, is_owner, display_name_snapshot, ready, hints_used, joined_at,
              disconnected_at, disconnect_deadline
       FROM match_participants WHERE match_id = ? AND user_id = ? AND left_at IS NULL${
         lock ? ' FOR UPDATE' : ''
       }`,
      [matchId, userId],
    )
    return result.rows[0] ? participant(result.rows[0]) : null
  }

  private async requireParticipant(
    client: Queryable,
    matchId: string,
    userId: string,
    lock = false,
  ): Promise<OnlineParticipant> {
    const result = await this.findParticipant(client, matchId, userId, lock)
    if (!result) throw new RepositoryNotFoundError()
    return result
  }

  private async state(
    client: Queryable,
    match: MatchEntity,
    lock = false,
  ): Promise<OnlineRefereeState> {
    const result = await client.query<StateRow>(
      `SELECT referee_state, revision FROM match_states WHERE match_id = ?${lock ? ' FOR UPDATE' : ''}`,
      [match.id],
    )
    if (!result.rows[0] || Number(result.rows[0].revision) !== match.revision) {
      throw new Error('公网对局状态 revision 不一致')
    }
    const state = readOnlineRefereeState(
      json(result.rows[0].referee_state),
      match.variant,
      match.gomokuRule,
    )
    if (state.clock && state.clock.preset !== match.clockPreset) {
      throw new Error('公网棋钟档位与对局不一致')
    }
    return state
  }

  private async pendingProposal(client: Queryable, id: string): Promise<OnlineProposal | null> {
    const result = await client.query<ProposalRow>(
      `SELECT id, kind, proposed_by_user_id, deadline FROM match_proposals
       WHERE match_id = ? AND status = 'pending' AND deadline > CURRENT_TIMESTAMP(6)
       ORDER BY created_at DESC LIMIT 1`,
      [id],
    )
    return proposal(result.rows[0])
  }

  private async requireRecord(client: Queryable, id: string): Promise<OnlineMatchRecord> {
    const match = await this.requireMatch(client, id)
    return {
      match,
      participants: await this.participants(client, id),
      state: await this.state(client, match),
      proposal: await this.pendingProposal(client, id),
    }
  }

  private async requireAccessibleMatch(
    client: Queryable,
    matchId: string,
    userId: string,
  ): Promise<MatchEntity> {
    const match = await this.requireMatch(client, matchId)
    if (match.visibility !== 'public' && !(await this.findParticipant(client, matchId, userId))) {
      throw new RepositoryNotFoundError()
    }
    return match
  }

  private async requireReadable(
    client: Queryable,
    matchId: string,
    userId: string,
    lock = false,
  ): Promise<MatchEntity> {
    const match = await this.requireMatch(client, matchId, lock)
    if (match.visibility !== 'public' && !(await this.findParticipant(client, matchId, userId))) {
      throw new RepositoryNotFoundError()
    }
    return match
  }
}

export { summary as onlineMatchSummary }
