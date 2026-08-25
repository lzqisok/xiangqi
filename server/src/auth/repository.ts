import { randomUUID } from 'node:crypto'
import type { Database, Queryable } from '../db/database.js'
import { RepositoryNotFoundError, RepositoryRevisionConflictError } from '../db/errors.js'
import type { AccountStatus } from '../repositories/contracts.js'
import type { AuthAccount, AuthSession, AuthTokenPurpose, SessionSummary } from './types.js'

type AccountRow = {
  id: string
  status: AccountStatus
  auth_epoch: string
  display_name: string
  locale: string
  identifier_normalized: string
  identifier_display: string
  verified_at: Date | null
  password_hash: string
  hash_version: number
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
  status: AccountStatus
  display_name: string
  locale: string
  device_label: string | null
}

const ACCOUNT_SELECT = `
  SELECT u.id, u.status, u.auth_epoch, p.display_name, p.locale,
         i.identifier_normalized, i.identifier_display, i.verified_at,
         c.password_hash, c.hash_version, u.created_at, u.updated_at
  FROM users u
  JOIN user_profiles p ON p.user_id = u.id
  JOIN auth_identities i ON i.user_id = u.id AND i.provider = 'email'
  JOIN password_credentials c ON c.user_id = u.id
`

const SESSION_SELECT = `
  SELECT s.id, s.user_id, s.token_hash, s.csrf_secret_hash, s.auth_epoch,
         s.created_at, s.last_seen_at, s.idle_expires_at, s.absolute_expires_at,
         s.revoked_at, s.device_label, u.status, p.display_name, p.locale
  FROM sessions s
  JOIN users u ON u.id = s.user_id
  JOIN user_profiles p ON p.user_id = u.id
`

function mapAccount(row: AccountRow): AuthAccount {
  return {
    id: row.id,
    status: row.status,
    authEpoch: Number(row.auth_epoch),
    displayName: row.display_name,
    locale: row.locale,
    emailNormalized: row.identifier_normalized,
    emailDisplay: row.identifier_display,
    verifiedAt: row.verified_at,
    passwordHash: row.password_hash,
    passwordHashVersion: row.hash_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapSession(row: SessionRow): AuthSession {
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
    accountStatus: row.status,
    displayName: row.display_name,
    locale: row.locale,
    deviceLabel: row.device_label,
  }
}

export class MySqlAuthRepository {
  constructor(private readonly database: Database) {}

  async findAccountByEmail(emailNormalized: string): Promise<AuthAccount | null> {
    const result = await this.database.query<AccountRow>(
      `${ACCOUNT_SELECT} WHERE i.identifier_normalized = ?`,
      [emailNormalized],
    )
    return result.rows[0] ? mapAccount(result.rows[0]) : null
  }

  async findAccountById(userId: string): Promise<AuthAccount | null> {
    const result = await this.database.query<AccountRow>(`${ACCOUNT_SELECT} WHERE u.id = ?`, [
      userId,
    ])
    return result.rows[0] ? mapAccount(result.rows[0]) : null
  }

  async findValidSession(tokenHash: Buffer, now: Date): Promise<AuthSession | null> {
    const result = await this.database.query<SessionRow>(
      `${SESSION_SELECT}
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.idle_expires_at > ?
         AND s.absolute_expires_at > ? AND s.auth_epoch = u.auth_epoch
         AND u.status IN ('pending_verification', 'active', 'restricted')`,
      [tokenHash, now, now],
    )
    return result.rows[0] ? mapSession(result.rows[0]) : null
  }

  async createSession(input: {
    userId: string
    tokenHash: Buffer
    csrfSecretHash: Buffer
    authEpoch: number
    idleExpiresAt: Date
    absoluteExpiresAt: Date
    deviceLabel?: string
    ipPrefix?: string
  }): Promise<AuthSession> {
    const id = randomUUID()
    return this.database.transaction(async (client) => {
      await client.query(
        `INSERT INTO sessions
          (id, user_id, token_hash, csrf_secret_hash, auth_epoch, idle_expires_at,
           absolute_expires_at, device_label, last_ip_prefix)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.userId,
          input.tokenHash,
          input.csrfSecretHash,
          input.authEpoch,
          input.idleExpiresAt,
          input.absoluteExpiresAt,
          input.deviceLabel ?? null,
          input.ipPrefix ?? null,
        ],
      )
      return this.requireSession(client, id)
    })
  }

  async touchSession(sessionId: string, now: Date, idleExpiresAt: Date): Promise<void> {
    await this.database.query(
      `UPDATE sessions SET last_seen_at = ?, idle_expires_at = LEAST(?, absolute_expires_at)
       WHERE id = ? AND revoked_at IS NULL`,
      [now, idleExpiresAt, sessionId],
    )
  }

  async rotateCsrf(sessionId: string, userId: string, csrfHash: Buffer): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE sessions SET csrf_secret_hash = ?
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
      [csrfHash, sessionId, userId],
    )
    return result.rowCount === 1
  }

  async revokeSession(sessionId: string, userId: string, now: Date): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE sessions SET revoked_at = ?
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
      [now, sessionId, userId],
    )
    return result.rowCount === 1
  }

  async listSessions(userId: string): Promise<SessionSummary[]> {
    const result = await this.database.query<SessionRow>(
      `${SESSION_SELECT} WHERE s.user_id = ? ORDER BY s.last_seen_at DESC`,
      [userId],
    )
    return result.rows.map((row) => {
      const session = mapSession(row)
      return {
        id: session.id,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        idleExpiresAt: session.idleExpiresAt,
        absoluteExpiresAt: session.absoluteExpiresAt,
        revokedAt: session.revokedAt,
        deviceLabel: session.deviceLabel,
      }
    })
  }

  async updateProfile(userId: string, displayName: string): Promise<AuthAccount> {
    await this.database.query(
      'UPDATE user_profiles SET display_name = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE user_id = ?',
      [displayName, userId],
    )
    const account = await this.findAccountById(userId)
    if (!account) throw new RepositoryNotFoundError()
    return account
  }

  async upgradePasswordHash(
    userId: string,
    previousHash: string,
    passwordHash: string,
    hashVersion: number,
    now: Date,
  ): Promise<void> {
    await this.database.query(
      `UPDATE password_credentials
       SET password_hash = ?, hash_version = ?, changed_at = ?
       WHERE user_id = ? AND password_hash = ?`,
      [passwordHash, hashVersion, now, userId, previousHash],
    )
  }

  async replaceAccountToken(
    userId: string,
    purpose: AuthTokenPurpose,
    digest: Buffer,
    expiresAt: Date,
  ): Promise<void> {
    await this.database.transaction(async (client) => {
      await client.query(
        `UPDATE account_tokens SET revoked_at = CURRENT_TIMESTAMP(6)
         WHERE user_id = ? AND purpose = ? AND used_at IS NULL AND revoked_at IS NULL`,
        [userId, purpose],
      )
      await client.query(
        `INSERT INTO account_tokens (id, user_id, purpose, token_hash, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        [randomUUID(), userId, purpose, digest, expiresAt],
      )
    })
  }

  async verifyEmailToken(digest: Buffer, now: Date): Promise<string | null> {
    return this.database.transaction(async (client) => {
      const token = await this.lockToken(client, digest, 'verify_email', now)
      if (!token) return null
      await client.query('UPDATE account_tokens SET used_at = ? WHERE id = ?', [now, token.id])
      await client.query(
        `UPDATE auth_identities SET verified_at = COALESCE(verified_at, ?), updated_at = ?
         WHERE user_id = ? AND provider = 'email'`,
        [now, now, token.user_id],
      )
      await client.query(
        `UPDATE users SET status = IF(status = 'pending_verification', 'active', status), updated_at = ?
         WHERE id = ?`,
        [now, token.user_id],
      )
      return token.user_id
    })
  }

  async resetPasswordWithToken(
    digest: Buffer,
    passwordHash: string,
    hashVersion: number,
    now: Date,
  ): Promise<string | null> {
    return this.database.transaction(async (client) => {
      const token = await this.lockToken(client, digest, 'reset_password', now)
      if (!token) return null
      await client.query('UPDATE account_tokens SET used_at = ? WHERE id = ?', [now, token.id])
      await client.query(
        `UPDATE password_credentials SET password_hash = ?, hash_version = ?, changed_at = ?
         WHERE user_id = ?`,
        [passwordHash, hashVersion, now, token.user_id],
      )
      await client.query(
        'UPDATE users SET auth_epoch = auth_epoch + 1, updated_at = ? WHERE id = ?',
        [now, token.user_id],
      )
      await client.query(
        'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
        [now, token.user_id],
      )
      return token.user_id
    })
  }

  async changePassword(
    userId: string,
    currentSessionId: string,
    passwordHash: string,
    hashVersion: number,
    now: Date,
  ): Promise<number> {
    return this.database.transaction(async (client) => {
      await client.query(
        `UPDATE password_credentials SET password_hash = ?, hash_version = ?, changed_at = ?
         WHERE user_id = ?`,
        [passwordHash, hashVersion, now, userId],
      )
      await client.query(
        'UPDATE users SET auth_epoch = auth_epoch + 1, updated_at = ? WHERE id = ?',
        [now, userId],
      )
      const epoch = await client.query<{ auth_epoch: string }>(
        'SELECT auth_epoch FROM users WHERE id = ?',
        [userId],
      )
      if (!epoch.rows[0]) throw new RepositoryNotFoundError()
      const nextEpoch = Number(epoch.rows[0].auth_epoch)
      await client.query(
        `UPDATE sessions SET revoked_at = IF(id = ?, revoked_at, COALESCE(revoked_at, ?)),
                             auth_epoch = IF(id = ?, ?, auth_epoch)
         WHERE user_id = ?`,
        [currentSessionId, now, currentSessionId, nextEpoch, userId],
      )
      return nextEpoch
    })
  }

  async beginDeletion(userId: string, now: Date, dueAt: Date): Promise<void> {
    await this.database.transaction(async (client) => {
      const result = await client.query(
        `UPDATE users SET status = 'pending_deletion', deletion_requested_at = ?, deletion_due_at = ?,
                          auth_epoch = auth_epoch + 1, updated_at = ?
         WHERE id = ? AND status IN ('pending_verification', 'active', 'restricted')`,
        [now, dueAt, now, userId],
      )
      if (result.rowCount !== 1) throw new RepositoryRevisionConflictError()
      await client.query(
        'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
        [now, userId],
      )
    })
  }

  async recoverDeletion(digest: Buffer, now: Date): Promise<string | null> {
    return this.database.transaction(async (client) => {
      const token = await this.lockToken(client, digest, 'recover_deletion', now)
      if (!token) return null
      await client.query('UPDATE account_tokens SET used_at = ? WHERE id = ?', [now, token.id])
      const result = await client.query(
        `UPDATE users SET status = 'active', deletion_requested_at = NULL, deletion_due_at = NULL,
                          auth_epoch = auth_epoch + 1, updated_at = ?
         WHERE id = ? AND status = 'pending_deletion'`,
        [now, token.user_id],
      )
      return result.rowCount === 1 ? token.user_id : null
    })
  }

  async recordSecurityEvent(input: {
    userId?: string
    sessionId?: string
    type: string
    result: string
    ipPrefix?: string
    userAgent?: string
    metadata?: Record<string, unknown>
  }): Promise<void> {
    await this.database.query(
      `INSERT INTO security_events
        (id, user_id, session_id, type, result, ip_prefix, user_agent_summary, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        input.userId ?? null,
        input.sessionId ?? null,
        input.type,
        input.result,
        input.ipPrefix ?? null,
        input.userAgent?.slice(0, 200) ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    )
  }

  private async lockToken(
    client: Queryable,
    digest: Buffer,
    purpose: AuthTokenPurpose,
    now: Date,
  ): Promise<{ id: string; user_id: string } | null> {
    const result = await client.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM account_tokens
       WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND revoked_at IS NULL
         AND expires_at > ? FOR UPDATE`,
      [digest, purpose, now],
    )
    return result.rows[0] ?? null
  }

  private async requireSession(client: Queryable, sessionId: string): Promise<AuthSession> {
    const result = await client.query<SessionRow>(`${SESSION_SELECT} WHERE s.id = ?`, [sessionId])
    if (!result.rows[0]) throw new RepositoryNotFoundError()
    return mapSession(result.rows[0])
  }
}
