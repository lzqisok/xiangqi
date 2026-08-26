import { randomUUID } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import type { UserActor } from './types.js'
import type { Database, Queryable } from '../db/database.js'
import { structuredLog } from '../platform/observability.js'

type Options = {
  requireUser(response: Response): UserActor
}

type CountRow = { resource_type: string; count: number | string }
type SharedMatchRow = {
  match_id: string
  variant: string
  visibility: string
  phase: string
  status: string
  status_reason: string | null
  revision: number | string
  side: string | null
  display_name_snapshot: string
  joined_at: Date
  left_at: Date | null
  created_at: Date
  updated_at: Date
  finished_at: Date | null
  schema_version: number | string
  public_state: unknown
}

export type AccountDeletionImpact = {
  privateDocuments: Record<string, number>
  privateDocumentTotal: number
  sharedMatchesToAnonymize: number
  activeSessionsToRevoke: number
  recoveryDays: number
}

export class MySqlAccountDataService {
  constructor(private readonly database: Database) {}

  async deletionImpact(userId: string): Promise<AccountDeletionImpact> {
    const [documents, matches, sessions] = await Promise.all([
      this.database.query<CountRow>(
        `SELECT resource_type, COUNT(*) AS count FROM user_documents
         WHERE owner_user_id = ? GROUP BY resource_type ORDER BY resource_type`,
        [userId],
      ),
      this.database.query<{ count: number | string }>(
        'SELECT COUNT(*) AS count FROM match_participants WHERE user_id = ?',
        [userId],
      ),
      this.database.query<{ count: number | string }>(
        `SELECT COUNT(*) AS count FROM sessions
         WHERE user_id = ? AND revoked_at IS NULL AND absolute_expires_at > CURRENT_TIMESTAMP(6)`,
        [userId],
      ),
    ])
    const privateDocuments = Object.fromEntries(
      documents.rows.map((row) => [row.resource_type, Number(row.count)]),
    )
    return {
      privateDocuments,
      privateDocumentTotal: Object.values(privateDocuments).reduce((sum, count) => sum + count, 0),
      sharedMatchesToAnonymize: Number(matches.rows[0]?.count || 0),
      activeSessionsToRevoke: Number(sessions.rows[0]?.count || 0),
      recoveryDays: 30,
    }
  }

  async export(userId: string): Promise<Record<string, unknown>> {
    const [account, documents, matches, chat] = await Promise.all([
      this.database.query<{
        id: string
        status: string
        created_at: Date
        display_name: string
        locale: string
        identifier_display: string
        verified_at: Date | null
      }>(
        `SELECT u.id, u.status, u.created_at, p.display_name, p.locale,
                i.identifier_display, i.verified_at
         FROM users u
         JOIN user_profiles p ON p.user_id = u.id
         JOIN auth_identities i ON i.user_id = u.id AND i.provider = 'email'
         WHERE u.id = ?`,
        [userId],
      ),
      this.database.query<{
        id: string
        resource_type: string
        schema_version: number | string
        revision: number | string
        payload: unknown
        created_at: Date
        updated_at: Date
      }>(
        `SELECT id, resource_type, schema_version, revision, payload, created_at, updated_at
         FROM user_documents WHERE owner_user_id = ? ORDER BY resource_type, created_at, id`,
        [userId],
      ),
      this.database.query<SharedMatchRow>(
        `SELECT m.id AS match_id, m.variant, m.visibility, m.phase, m.status, m.status_reason,
                m.revision, p.side, p.display_name_snapshot, p.joined_at, p.left_at,
                m.created_at, m.updated_at, m.finished_at,
                s.schema_version, s.public_state
         FROM match_participants p
         JOIN matches m ON m.id = p.match_id
         JOIN match_states s ON s.match_id = m.id
         WHERE p.user_id = ? ORDER BY m.created_at, m.id`,
        [userId],
      ),
      this.database.query<{
        id: string
        match_id: string
        sequence: number | string
        display_name_snapshot: string
        role_snapshot: string
        content: string | null
        moderation_state: string
        created_at: Date
        deleted_at: Date | null
      }>(
        `SELECT id, match_id, sequence, display_name_snapshot, role_snapshot, content,
                moderation_state, created_at, deleted_at
         FROM match_chat_messages WHERE author_user_id = ? ORDER BY match_id, sequence`,
        [userId],
      ),
    ])
    const profile = account.rows[0]
    if (!profile) throw Object.assign(new Error('not_found'), { status: 404 })
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      account: {
        id: profile.id,
        status: profile.status,
        email: profile.identifier_display,
        emailVerifiedAt: profile.verified_at?.toISOString() ?? null,
        displayName: profile.display_name,
        locale: profile.locale,
        createdAt: profile.created_at.toISOString(),
      },
      privateDocuments: documents.rows.map((row) => ({
        id: row.id,
        resourceType: row.resource_type,
        schemaVersion: Number(row.schema_version),
        revision: Number(row.revision),
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
      })),
      sharedMatchViews: matches.rows.map((row) => ({
        matchId: row.match_id,
        variant: row.variant,
        visibility: row.visibility,
        phase: row.phase,
        status: row.status,
        statusReason: row.status_reason,
        revision: Number(row.revision),
        side: row.side,
        displayNameSnapshot: row.display_name_snapshot,
        joinedAt: row.joined_at.toISOString(),
        leftAt: row.left_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        finishedAt: row.finished_at?.toISOString() ?? null,
        schemaVersion: Number(row.schema_version),
        publicState:
          typeof row.public_state === 'string' ? JSON.parse(row.public_state) : row.public_state,
      })),
      authoredChatMessages: chat.rows.map((row) => ({
        id: row.id,
        matchId: row.match_id,
        sequence: Number(row.sequence),
        displayNameSnapshot: row.display_name_snapshot,
        roleSnapshot: row.role_snapshot,
        content: row.content,
        moderationState: row.moderation_state,
        createdAt: row.created_at.toISOString(),
        deletedAt: row.deleted_at?.toISOString() ?? null,
      })),
    }
  }

  async cleanupDue(now = new Date(), limit = 100): Promise<number> {
    const due = await this.database.query<{ id: string }>(
      `SELECT id FROM users
       WHERE status = 'pending_deletion' AND deletion_due_at <= ?
       ORDER BY deletion_due_at, id LIMIT ?`,
      [now, Math.max(1, Math.min(1000, Math.floor(limit)))],
    )
    let cleaned = 0
    for (const row of due.rows) {
      cleaned += await this.database.transaction((client) => this.cleanupOne(client, row.id, now))
    }
    return cleaned
  }

  private async cleanupOne(client: Queryable, userId: string, now: Date): Promise<number> {
    const locked = await client.query<{ id: string }>(
      `SELECT id FROM users
       WHERE id = ? AND status = 'pending_deletion' AND deletion_due_at <= ? FOR UPDATE`,
      [userId, now],
    )
    if (!locked.rows[0]) return 0
    await client.query(
      `UPDATE match_participants
       SET user_id = NULL, display_name_snapshot = '已注销棋手', anonymized_at = ?,
           left_at = COALESCE(left_at, ?), is_owner = false, ready = false,
           disconnected_at = NULL, disconnect_deadline = NULL
       WHERE user_id = ?`,
      [now, now, userId],
    )
    await client.query(
      'UPDATE match_invites SET used_by_user_id = NULL WHERE used_by_user_id = ?',
      [userId],
    )
    await client.query(
      `INSERT INTO security_events (id, user_id, type, result, metadata)
       VALUES (?, ?, 'account_final_cleanup', 'success', JSON_OBJECT('anonymized', true))`,
      [randomUUID(), userId],
    )
    await client.query('DELETE FROM users WHERE id = ?', [userId])
    return 1
  }
}

export function createAccountDataRouter(
  service: MySqlAccountDataService,
  options: Options,
): Router {
  const router = Router()
  router.get('/deletion-impact', async (request, response, next) => {
    try {
      response.json({ impact: await service.deletionImpact(options.requireUser(response).userId) })
    } catch (error) {
      next(error)
    }
  })
  router.get('/data-export', async (request, response, next) => {
    try {
      const actor = options.requireUser(response)
      const payload = await service.export(actor.userId)
      structuredLog('info', 'account_data_exported', {
        requestId: response.locals.requestId,
        userId: actor.userId,
      })
      response.setHeader('Content-Disposition', 'attachment; filename="xiangqi-account-data.json"')
      response.json(payload)
    } catch (error) {
      next(error)
    }
  })
  return router
}
