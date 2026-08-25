import { randomUUID } from 'node:crypto'
import type { Database, Queryable } from '../db/database.js'
import { RepositoryNotFoundError, RepositoryRevisionConflictError } from '../db/errors.js'
import type {
  AccountEntity,
  AccountRepository,
  AccountStatus,
  CreateAccountInput,
  CreateMatchInput,
  CreateSessionInput,
  JsonValidator,
  MatchEntity,
  MatchRepository,
  MatchStateEntity,
  SessionEntity,
  SessionRepository,
} from './contracts.js'

type AccountRow = {
  id: string
  status: AccountStatus
  auth_epoch: string
  display_name: string
  locale: string
  created_at: Date
  updated_at: Date
}

type SessionRow = {
  id: string
  user_id: string
  token_hash: Buffer
  csrf_secret_hash: Buffer
  auth_epoch: string
  created_at: Date
  last_seen_at: Date
  idle_expires_at: Date
  absolute_expires_at: Date
  revoked_at: Date | null
  account_status: AccountStatus
}

type MatchRow = {
  id: string
  variant: MatchEntity['variant']
  gomoku_rule: MatchEntity['gomokuRule']
  matchmaking: number | boolean
  visibility: MatchEntity['visibility']
  phase: MatchEntity['phase']
  status: MatchEntity['status']
  status_reason: string | null
  revision: string
  created_by_user_id: string | null
  created_at: Date
  updated_at: Date
  started_at: Date | null
  finished_at: Date | null
  expires_at: Date
}

const ACCOUNT_SELECT = `
  SELECT u.id, u.status, u.auth_epoch, p.display_name, p.locale, u.created_at, u.updated_at
  FROM users u
  JOIN user_profiles p ON p.user_id = u.id
`

const MATCH_COLUMNS = `
  id, variant, gomoku_rule, matchmaking, visibility, phase, status, status_reason, revision,
  created_by_user_id, created_at, updated_at, started_at, finished_at, expires_at
`

function account(row: AccountRow): AccountEntity {
  return {
    id: row.id,
    status: row.status,
    authEpoch: Number(row.auth_epoch),
    displayName: row.display_name,
    locale: row.locale,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function session(row: SessionRow): SessionEntity {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    csrfSecretHash: row.csrf_secret_hash,
    authEpoch: Number(row.auth_epoch),
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    idleExpiresAt: row.idle_expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
    revokedAt: row.revoked_at,
    accountStatus: row.account_status,
  }
}

function match(row: MatchRow): MatchEntity {
  return {
    id: row.id,
    variant: row.variant,
    gomokuRule: row.gomoku_rule,
    matchmaking: Boolean(row.matchmaking),
    visibility: row.visibility,
    phase: row.phase,
    status: row.status,
    statusReason: row.status_reason,
    revision: Number(row.revision),
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    expiresAt: row.expires_at,
  }
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    throw new Error('Database returned invalid JSON')
  }
}

function assertMatchInput(input: CreateMatchInput): void {
  const sides = input.participants.flatMap((participant) =>
    participant.side ? [participant.side] : [],
  )
  if (
    new Set(input.participants.map((participant) => participant.userId)).size !==
    input.participants.length
  ) {
    throw new Error('A user may participate in a match only once')
  }
  if (new Set(sides).size !== sides.length) throw new Error('A side may be occupied only once')
  const owners = input.participants.filter((participant) => participant.isOwner)
  if (owners.length !== 1 || owners[0].userId !== input.createdByUserId) {
    throw new Error('A match must have exactly one owner matching its creator')
  }
  if (input.phase === 'playing' && (!sides.includes('red') || !sides.includes('black'))) {
    throw new Error('A playing match requires red and black participants')
  }
}

export class MySqlAccountRepository implements AccountRepository {
  constructor(private readonly database: Database) {}

  async create(input: CreateAccountInput): Promise<AccountEntity> {
    const userId = randomUUID()
    const identityId = randomUUID()
    const tokenId = randomUUID()
    return this.database.transaction(async (client) => {
      await client.query('INSERT INTO users (id, status) VALUES (?, ?)', [
        userId,
        'pending_verification',
      ])
      await client.query('INSERT INTO user_profiles (user_id, display_name) VALUES (?, ?)', [
        userId,
        input.displayName,
      ])
      await client.query(
        `INSERT INTO auth_identities
          (id, user_id, provider, identifier_normalized, identifier_display)
         VALUES (?, ?, 'email', ?, ?)`,
        [identityId, userId, input.emailNormalized, input.emailDisplay],
      )
      await client.query(
        `INSERT INTO password_credentials (user_id, password_hash, hash_version)
         VALUES (?, ?, ?)`,
        [userId, input.passwordHash, input.passwordHashVersion],
      )
      await client.query(
        `INSERT INTO account_tokens (id, user_id, purpose, token_hash, expires_at)
         VALUES (?, ?, 'verify_email', ?, ?)`,
        [tokenId, userId, input.verificationTokenHash, input.verificationExpiresAt],
      )
      const result = await client.query<AccountRow>(`${ACCOUNT_SELECT} WHERE u.id = ?`, [userId])
      return account(result.rows[0])
    })
  }

  async findById(id: string): Promise<AccountEntity | null> {
    const result = await this.database.query<AccountRow>(`${ACCOUNT_SELECT} WHERE u.id = ?`, [id])
    return result.rows[0] ? account(result.rows[0]) : null
  }
}

export class MySqlSessionRepository implements SessionRepository {
  constructor(private readonly database: Database) {}

  async create(input: CreateSessionInput): Promise<SessionEntity> {
    const id = randomUUID()
    return this.database.transaction(async (client) => {
      await client.query(
        `INSERT INTO sessions
          (id, user_id, token_hash, auth_epoch, csrf_secret_hash, idle_expires_at,
           absolute_expires_at, device_label, last_ip_prefix)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.userId,
          input.tokenHash,
          input.authEpoch,
          input.csrfSecretHash,
          input.idleExpiresAt,
          input.absoluteExpiresAt,
          input.deviceLabel ?? null,
          input.lastIpPrefix ?? null,
        ],
      )
      const result = await this.sessionById(client, id)
      return session(result.rows[0])
    })
  }

  async findValidByTokenHash(tokenHash: Buffer, now = new Date()): Promise<SessionEntity | null> {
    const result = await this.database.query<SessionRow>(
      `SELECT s.id, s.user_id, s.token_hash, s.csrf_secret_hash, s.auth_epoch, s.created_at, s.last_seen_at,
              s.idle_expires_at, s.absolute_expires_at, s.revoked_at, u.status AS account_status
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.idle_expires_at > ?
         AND s.absolute_expires_at > ? AND s.auth_epoch = u.auth_epoch
         AND u.status IN ('pending_verification', 'active', 'restricted')`,
      [tokenHash, now, now],
    )
    return result.rows[0] ? session(result.rows[0]) : null
  }

  async revoke(sessionId: string, userId: string, now = new Date()): Promise<boolean> {
    return this.database.transaction(async (client) => {
      const result = await client.query(
        'UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
        [now, sessionId, userId],
      )
      return result.rowCount === 1
    })
  }

  async revokeAllForUser(
    userId: string,
    exceptSessionId?: string,
    now = new Date(),
  ): Promise<number> {
    return this.database.transaction(async (client) => {
      const result = await client.query(
        `UPDATE sessions SET revoked_at = ?
         WHERE user_id = ? AND revoked_at IS NULL AND (? IS NULL OR id <> ?)`,
        [now, userId, exceptSessionId ?? null, exceptSessionId ?? null],
      )
      return result.rowCount
    })
  }

  private sessionById(client: Queryable, id: string) {
    return client.query<SessionRow>(
      `SELECT s.id, s.user_id, s.token_hash, s.csrf_secret_hash, s.auth_epoch, s.created_at, s.last_seen_at,
              s.idle_expires_at, s.absolute_expires_at, s.revoked_at, u.status AS account_status
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
      [id],
    )
  }
}

export class MySqlMatchRepository implements MatchRepository {
  constructor(
    private readonly database: Database,
    private readonly validatePublicState: JsonValidator<unknown>,
    private readonly validateRefereeState: JsonValidator<unknown>,
  ) {}

  async create(input: CreateMatchInput): Promise<MatchEntity> {
    assertMatchInput(input)
    this.assertState(input.publicState, input.refereeState)
    const id = randomUUID()
    return this.database.transaction(async (client) => {
      await client.query(
        `INSERT INTO matches
          (id, variant, gomoku_rule, matchmaking, visibility, phase, status, status_reason,
           created_by_user_id, started_at, finished_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.variant,
          input.gomokuRule ?? null,
          input.matchmaking ?? false,
          input.visibility,
          input.phase,
          input.status,
          input.statusReason ?? null,
          input.createdByUserId,
          input.startedAt ?? null,
          input.finishedAt ?? null,
          input.expiresAt,
        ],
      )
      for (const participant of input.participants) {
        await client.query(
          `INSERT INTO match_participants
            (id, match_id, user_id, side, is_owner, display_name_snapshot, ready)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            randomUUID(),
            id,
            participant.userId,
            participant.side ?? null,
            participant.isOwner,
            participant.displayNameSnapshot,
            participant.ready ?? false,
          ],
        )
      }
      await client.query(
        `INSERT INTO match_states
          (match_id, schema_version, revision, public_state, referee_state)
         VALUES (?, ?, 0, ?, ?)`,
        [
          id,
          input.stateSchemaVersion,
          JSON.stringify(input.publicState),
          JSON.stringify(input.refereeState),
        ],
      )
      return this.requireMatch(client, id)
    })
  }

  async findById(id: string): Promise<MatchEntity | null> {
    const result = await this.database.query<MatchRow>(
      `SELECT ${MATCH_COLUMNS} FROM matches WHERE id = ?`,
      [id],
    )
    return result.rows[0] ? match(result.rows[0]) : null
  }

  async getStateForReferee(id: string): Promise<MatchStateEntity | null> {
    const result = await this.database.query<{
      match_id: string
      schema_version: number
      revision: string
      public_state: unknown
      referee_state: unknown
      updated_at: Date
    }>(
      `SELECT match_id, schema_version, revision, public_state, referee_state, updated_at
       FROM match_states WHERE match_id = ?`,
      [id],
    )
    const row = result.rows[0]
    return row
      ? {
          matchId: row.match_id,
          schemaVersion: row.schema_version,
          revision: Number(row.revision),
          publicState: json(row.public_state),
          refereeState: json(row.referee_state),
          updatedAt: row.updated_at,
        }
      : null
  }

  async updateState(
    id: string,
    expectedRevision: number,
    publicState: unknown,
    refereeState: unknown,
    outcome?: { status: MatchEntity['status']; statusReason?: string; finishedAt?: Date },
  ): Promise<MatchEntity> {
    this.assertState(publicState, refereeState)
    return this.database.transaction(async (client) => {
      const status = outcome?.status ?? 'playing'
      const updated = await client.query(
        `UPDATE matches SET
           revision = revision + 1,
           phase = IF(? = 'playing', phase, 'finished'),
           status = ?,
           status_reason = ?,
           finished_at = IF(? = 'playing', finished_at, COALESCE(?, CURRENT_TIMESTAMP(6))),
           updated_at = CURRENT_TIMESTAMP(6)
         WHERE id = ? AND revision = ? AND phase = 'playing'`,
        [
          status,
          status,
          outcome?.statusReason ?? null,
          status,
          outcome?.finishedAt ?? null,
          id,
          expectedRevision,
        ],
      )
      if (updated.rowCount !== 1) await this.throwRevisionOrNotFound(client, id)
      const state = await client.query(
        `UPDATE match_states SET revision = ?, public_state = ?, referee_state = ?,
           updated_at = CURRENT_TIMESTAMP(6)
         WHERE match_id = ? AND revision = ?`,
        [
          expectedRevision + 1,
          JSON.stringify(publicState),
          JSON.stringify(refereeState),
          id,
          expectedRevision,
        ],
      )
      if (state.rowCount !== 1) throw new RepositoryRevisionConflictError(expectedRevision)
      return this.requireMatch(client, id)
    })
  }

  async deleteWaiting(id: string, expectedRevision: number): Promise<void> {
    await this.database.transaction(async (client) => {
      const result = await client.query(
        `DELETE FROM matches WHERE id = ? AND revision = ? AND phase = 'waiting'`,
        [id, expectedRevision],
      )
      if (result.rowCount !== 1) await this.throwRevisionOrNotFound(client, id)
    })
  }

  private assertState(publicState: unknown, refereeState: unknown): void {
    if (!this.validatePublicState(publicState) || !this.validateRefereeState(refereeState)) {
      throw new Error('Match state does not satisfy its schema')
    }
  }

  private async requireMatch(client: Queryable, id: string): Promise<MatchEntity> {
    const result = await client.query<MatchRow>(
      `SELECT ${MATCH_COLUMNS} FROM matches WHERE id = ?`,
      [id],
    )
    if (!result.rows[0]) throw new RepositoryNotFoundError()
    return match(result.rows[0])
  }

  private async throwRevisionOrNotFound(client: Queryable, id: string): Promise<never> {
    const current = await client.query<{ revision: string }>(
      'SELECT revision FROM matches WHERE id = ?',
      [id],
    )
    if (!current.rows[0]) throw new RepositoryNotFoundError()
    throw new RepositoryRevisionConflictError(Number(current.rows[0].revision))
  }
}
