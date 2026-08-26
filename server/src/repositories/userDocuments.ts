import { randomUUID } from 'node:crypto'
import type { Database, Queryable } from '../db/database.js'
import {
  RepositoryError,
  RepositoryNotFoundError,
  RepositoryRevisionConflictError,
} from '../db/errors.js'
import type { JsonValidator, UserDocumentEntity, UserDocumentRepository } from './contracts.js'

type DocumentRow = {
  id: string
  owner_user_id: string
  schema_version: number | string
  revision: number | string
  payload: unknown
  client_mutation_id: string
  created_at: Date
  updated_at: Date
}

type MutationRow = {
  operation: 'create' | 'update' | 'delete'
  document_id: string
  result_revision: number | string | null
}

const RESOURCE_TYPE = /^[a-z][a-z0-9_-]{0,39}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MUTATION_ID = /^[A-Za-z0-9._:-]{1,128}$/

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    throw new RepositoryError('Invalid document payload returned by database', 'invalid_payload')
  }
}

export class UserDocumentInputError extends RepositoryError {
  constructor(message: string, code = 'invalid_document') {
    super(message, code)
  }
}

export class UserDocumentMutationReuseError extends RepositoryError {
  constructor() {
    super('clientMutationId was already used for another operation', 'mutation_reused')
  }
}

export class UserDocumentLimitError extends RepositoryError {
  constructor() {
    super('User document limit exceeded', 'document_limit')
  }
}

export class MySqlUserDocumentRepository<T extends object> implements UserDocumentRepository<T> {
  constructor(
    private readonly database: Database,
    private readonly resourceType: string,
    private readonly schemaVersion: number,
    private readonly validatePayload: JsonValidator<T>,
    private readonly maxDocuments = 500,
    private readonly logicalKey?: (payload: T) => string,
  ) {
    if (!RESOURCE_TYPE.test(resourceType)) throw new Error('Invalid user document resource type')
    if (!Number.isInteger(schemaVersion) || schemaVersion < 1)
      throw new Error('Invalid user document schema version')
  }

  async list(ownerUserId: string): Promise<readonly UserDocumentEntity<T>[]> {
    const result = await this.database.query<DocumentRow>(
      `${this.selectColumns()}
       WHERE owner_user_id = ? AND resource_type = ?
       ORDER BY updated_at DESC, id`,
      [ownerUserId, this.resourceType],
    )
    return result.rows.map((row) => this.entity(row))
  }

  async find(ownerUserId: string, id: string): Promise<UserDocumentEntity<T> | null> {
    const result = await this.database.query<DocumentRow>(
      `${this.selectColumns()} WHERE owner_user_id = ? AND resource_type = ? AND id = ?`,
      [ownerUserId, this.resourceType, id],
    )
    return result.rows[0] ? this.entity(result.rows[0]) : null
  }

  async create(
    ownerUserId: string,
    payload: T,
    clientMutationId: string,
    requestedId?: string,
  ): Promise<UserDocumentEntity<T>> {
    const documentId = requestedId || randomUUID()
    this.assertInput(payload, clientMutationId, documentId)
    const logicalKey = this.getLogicalKey(payload)
    return this.database.transaction(async (client) => {
      await this.lockOwner(client, ownerUserId)
      const replay = await this.replayed(client, ownerUserId, clientMutationId)
      if (replay) {
        this.assertReplay(replay, 'create', requestedId)
        return this.requiredDocument(client, ownerUserId, replay.document_id)
      }
      if (logicalKey) {
        const existing = await client.query<{ id: string; revision: number | string }>(
          `SELECT id, revision FROM user_documents
           WHERE owner_user_id = ? AND resource_type = ? AND logical_key = ? FOR UPDATE`,
          [ownerUserId, this.resourceType, logicalKey],
        )
        if (existing.rows[0]) {
          await this.recordMutation(
            client,
            ownerUserId,
            clientMutationId,
            'create',
            existing.rows[0].id,
            Number(existing.rows[0].revision),
          )
          return this.requiredDocument(client, ownerUserId, existing.rows[0].id)
        }
      }
      const count = await client.query<{ count: number | string }>(
        'SELECT COUNT(*) AS count FROM user_documents WHERE owner_user_id = ? AND resource_type = ?',
        [ownerUserId, this.resourceType],
      )
      if (Number(count.rows[0]?.count) >= this.maxDocuments) throw new UserDocumentLimitError()
      await client.query(
        `INSERT INTO user_documents
          (id, owner_user_id, resource_type, schema_version, revision, payload,
           client_mutation_id, logical_key)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
        [
          documentId,
          ownerUserId,
          this.resourceType,
          this.schemaVersion,
          JSON.stringify(payload),
          clientMutationId,
          logicalKey,
        ],
      )
      await this.recordMutation(client, ownerUserId, clientMutationId, 'create', documentId, 0)
      return this.requiredDocument(client, ownerUserId, documentId)
    })
  }

  async update(
    ownerUserId: string,
    id: string,
    expectedRevision: number,
    payload: T,
    clientMutationId: string,
  ): Promise<UserDocumentEntity<T>> {
    this.assertInput(payload, clientMutationId, id)
    this.assertRevision(expectedRevision)
    const logicalKey = this.getLogicalKey(payload)
    return this.database.transaction(async (client) => {
      await this.lockOwner(client, ownerUserId)
      const replay = await this.replayed(client, ownerUserId, clientMutationId)
      if (replay) {
        this.assertReplay(replay, 'update', id)
        return this.requiredDocument(client, ownerUserId, id)
      }
      const current = await this.requiredDocument(client, ownerUserId, id, true)
      if (current.revision !== expectedRevision)
        throw new RepositoryRevisionConflictError(current.revision)
      const revision = current.revision + 1
      await client.query(
        `UPDATE user_documents
         SET schema_version = ?, revision = ?, payload = ?, client_mutation_id = ?, logical_key = ?,
             updated_at = CURRENT_TIMESTAMP(6)
         WHERE owner_user_id = ? AND resource_type = ? AND id = ?`,
        [
          this.schemaVersion,
          revision,
          JSON.stringify(payload),
          clientMutationId,
          logicalKey,
          ownerUserId,
          this.resourceType,
          id,
        ],
      )
      await this.recordMutation(client, ownerUserId, clientMutationId, 'update', id, revision)
      return this.requiredDocument(client, ownerUserId, id)
    })
  }

  async delete(
    ownerUserId: string,
    id: string,
    expectedRevision: number,
    clientMutationId: string,
  ): Promise<void> {
    this.assertMutationId(clientMutationId)
    this.assertId(id)
    this.assertRevision(expectedRevision)
    await this.database.transaction(async (client) => {
      await this.lockOwner(client, ownerUserId)
      const replay = await this.replayed(client, ownerUserId, clientMutationId)
      if (replay) {
        this.assertReplay(replay, 'delete', id)
        return
      }
      const current = await this.requiredDocument(client, ownerUserId, id, true)
      if (current.revision !== expectedRevision)
        throw new RepositoryRevisionConflictError(current.revision)
      await this.recordMutation(
        client,
        ownerUserId,
        clientMutationId,
        'delete',
        id,
        current.revision,
      )
      await client.query(
        'DELETE FROM user_documents WHERE owner_user_id = ? AND resource_type = ? AND id = ?',
        [ownerUserId, this.resourceType, id],
      )
    })
  }

  private selectColumns(lock = false): string {
    return `SELECT id, owner_user_id, schema_version, revision, payload, client_mutation_id,
                   created_at, updated_at
            FROM user_documents${lock ? '' : ''}`
  }

  private async requiredDocument(
    client: Queryable,
    ownerUserId: string,
    id: string,
    lock = false,
  ): Promise<UserDocumentEntity<T>> {
    const result = await client.query<DocumentRow>(
      `${this.selectColumns()} WHERE owner_user_id = ? AND resource_type = ? AND id = ?${
        lock ? ' FOR UPDATE' : ''
      }`,
      [ownerUserId, this.resourceType, id],
    )
    if (!result.rows[0]) throw new RepositoryNotFoundError()
    return this.entity(result.rows[0])
  }

  private async lockOwner(client: Queryable, ownerUserId: string): Promise<void> {
    const result = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE id = ? AND status <> 'deleted' FOR UPDATE",
      [ownerUserId],
    )
    if (!result.rows[0]) throw new RepositoryNotFoundError()
  }

  private async replayed(
    client: Queryable,
    ownerUserId: string,
    clientMutationId: string,
  ): Promise<MutationRow | null> {
    const result = await client.query<MutationRow>(
      `SELECT operation, document_id, result_revision
       FROM user_document_mutations
       WHERE owner_user_id = ? AND resource_type = ? AND client_mutation_id = ?`,
      [ownerUserId, this.resourceType, clientMutationId],
    )
    return result.rows[0] || null
  }

  private assertReplay(
    replay: MutationRow,
    operation: MutationRow['operation'],
    documentId?: string,
  ): void {
    if (replay.operation !== operation || (documentId && replay.document_id !== documentId)) {
      throw new UserDocumentMutationReuseError()
    }
  }

  private recordMutation(
    client: Queryable,
    ownerUserId: string,
    clientMutationId: string,
    operation: MutationRow['operation'],
    documentId: string,
    resultRevision: number,
  ): Promise<unknown> {
    return client.query(
      `INSERT INTO user_document_mutations
        (owner_user_id, resource_type, client_mutation_id, operation, document_id, result_revision)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ownerUserId, this.resourceType, clientMutationId, operation, documentId, resultRevision],
    )
  }

  private entity(row: DocumentRow): UserDocumentEntity<T> {
    const payload = json(row.payload)
    if (!this.validatePayload(payload)) {
      throw new RepositoryError('Stored user document failed validation', 'invalid_payload')
    }
    return {
      id: row.id,
      ownerUserId: row.owner_user_id,
      schemaVersion: Number(row.schema_version),
      revision: Number(row.revision),
      payload,
      clientMutationId: row.client_mutation_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private assertInput(payload: T, clientMutationId: string, id: string): void {
    if (!this.validatePayload(payload)) throw new UserDocumentInputError('Invalid document payload')
    this.assertMutationId(clientMutationId)
    this.assertId(id)
  }

  private assertId(id: string): void {
    if (!UUID.test(id)) throw new UserDocumentInputError('Invalid document id')
  }

  private assertMutationId(clientMutationId: string): void {
    if (!MUTATION_ID.test(clientMutationId)) {
      throw new UserDocumentInputError('Invalid clientMutationId')
    }
  }

  private assertRevision(revision: number): void {
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new UserDocumentInputError('Invalid expectedRevision')
    }
  }

  private getLogicalKey(payload: T): string | null {
    if (!this.logicalKey) return null
    const value = this.logicalKey(payload).trim()
    if (!value || value.length > 512) {
      throw new UserDocumentInputError('Invalid document logical key')
    }
    return value
  }
}
