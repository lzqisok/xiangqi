import { Router, type Request, type Response } from 'express'
import type { Database } from '../db/database.js'
import { RepositoryNotFoundError, RepositoryRevisionConflictError } from '../db/errors.js'
import { MySqlUserDocumentRepository } from '../repositories/userDocuments.js'
import { structuredLog } from '../platform/observability.js'
import { userDocumentDefinition, userDocumentSummary } from './registry.js'
import type { UserActor } from '../auth/types.js'

type Options = {
  requireUser(response: Response): UserActor
  requireCsrf(request: Request, response: Response): UserActor
}

function mutationId(request: Request): string {
  const value = request.header('x-client-mutation-id')?.trim()
  if (!value) throw Object.assign(new Error('clientMutationId 必填'), { status: 400 })
  return value
}

export function createUserDocumentRouter(database: Database, options: Options): Router {
  const router = Router()
  const repositories = new Map<string, MySqlUserDocumentRepository<Record<string, unknown>>>()
  const repository = (resource: string) => {
    const definition = userDocumentDefinition(resource)
    if (!definition) throw Object.assign(new Error('resource_not_found'), { status: 404 })
    let current = repositories.get(resource)
    if (!current) {
      current = new MySqlUserDocumentRepository(
        database,
        definition.resource,
        definition.schemaVersion,
        definition.validate,
        definition.maxDocuments,
        definition.logicalKey,
      )
      repositories.set(resource, current)
    }
    return current
  }
  const dto = (
    resource: string,
    document: Awaited<ReturnType<ReturnType<typeof repository>['create']>>,
  ) => ({
    id: document.id,
    ownerUserId: document.ownerUserId,
    schemaVersion: document.schemaVersion,
    revision: document.revision,
    clientMutationId: document.clientMutationId,
    createdAt: document.createdAt.getTime(),
    updatedAt: document.updatedAt.getTime(),
    summary: userDocumentSummary(resource, document.payload),
    payload: document.payload,
  })
  const assertOwnedReferences = async (resource: string, ownerUserId: string, payload: unknown) => {
    if (resource !== 'training-tasks') return
    if (!(await userDocumentSourceAccessible(database, ownerUserId, payload))) {
      throw Object.assign(new Error('source_not_accessible'), { status: 403 })
    }
  }

  router.get('/:resource', async (request, response, next) => {
    try {
      const actor = options.requireUser(response)
      const resource = request.params.resource
      let documents = [...(await repository(resource).list(actor.userId))]
      const query = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 100) : ''
      if (resource === 'studies' && query) {
        const normalized = query.toLocaleLowerCase('zh-CN')
        documents = documents.filter((document) => {
          const summary = userDocumentSummary(resource, document.payload)
          return `${summary?.name || ''} ${summary?.description || ''}`
            .toLocaleLowerCase('zh-CN')
            .includes(normalized)
        })
      }
      response.json({
        documents:
          resource === 'training-tasks'
            ? await Promise.all(
                documents.map(async (document) => {
                  const result = dto(resource, document)
                  const payload = structuredClone(result.payload)
                  const source = payload.source
                  if (source && typeof source === 'object') {
                    ;(source as Record<string, unknown>).available =
                      await userDocumentSourceAccessible(database, actor.userId, payload)
                  }
                  return { ...result, payload }
                }),
              )
            : documents.map((document) => dto(resource, document)),
      })
    } catch (error) {
      next(error)
    }
  })

  router.post('/:resource/import', async (request, response, next) => {
    try {
      if (userDocumentDefinition(request.params.resource)?.serverManaged) {
        response.status(403).json({ error: 'server_managed_resource' })
        return
      }
      const actor = options.requireCsrf(request, response)
      const values = request.body?.documents
      if (!Array.isArray(values) || values.length > 1000) {
        response.status(400).json({ error: 'invalid_import' })
        return
      }
      const importId = mutationId(request)
      const target = repository(request.params.resource)
      const documents = []
      for (const [index, payload] of values.entries()) {
        await assertOwnedReferences(request.params.resource, actor.userId, payload)
        documents.push(await target.create(actor.userId, payload, `${importId}:${index}`))
      }
      response
        .status(201)
        .json({ documents: documents.map((document) => dto(request.params.resource, document)) })
    } catch (error) {
      next(error)
    }
  })

  router.post('/:resource', async (request, response, next) => {
    try {
      if (userDocumentDefinition(request.params.resource)?.serverManaged) {
        response.status(403).json({ error: 'server_managed_resource' })
        return
      }
      const actor = options.requireCsrf(request, response)
      await assertOwnedReferences(request.params.resource, actor.userId, request.body?.payload)
      const document = await repository(request.params.resource).create(
        actor.userId,
        request.body?.payload,
        mutationId(request),
      )
      response.status(201).json({ document: dto(request.params.resource, document) })
    } catch (error) {
      next(error)
    }
  })

  router.get('/:resource/:id', async (request, response, next) => {
    try {
      const actor = options.requireUser(response)
      const document = await repository(request.params.resource).find(
        actor.userId,
        request.params.id,
      )
      if (!document) throw new RepositoryNotFoundError()
      response.json({ document: dto(request.params.resource, document) })
    } catch (error) {
      next(error)
    }
  })

  router.put('/:resource/:id', async (request, response, next) => {
    try {
      if (userDocumentDefinition(request.params.resource)?.serverManaged) {
        response.status(403).json({ error: 'server_managed_resource' })
        return
      }
      const actor = options.requireCsrf(request, response)
      await assertOwnedReferences(request.params.resource, actor.userId, request.body?.payload)
      const document = await repository(request.params.resource).update(
        actor.userId,
        request.params.id,
        request.body?.expectedRevision,
        request.body?.payload,
        mutationId(request),
      )
      response.json({ document: dto(request.params.resource, document) })
    } catch (error) {
      next(error)
    }
  })

  router.delete('/:resource/:id', async (request, response, next) => {
    try {
      const actor = options.requireCsrf(request, response)
      await repository(request.params.resource).delete(
        actor.userId,
        request.params.id,
        Number(request.query.revision),
        mutationId(request),
      )
      response.status(204).end()
    } catch (error) {
      next(error)
    }
  })

  router.use((error: unknown, _request: Request, response: Response, _next: unknown) => {
    const status = Number((error as { status?: number }).status)
    if (error instanceof RepositoryNotFoundError || status === 404) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    if (error instanceof RepositoryRevisionConflictError) {
      response
        .status(409)
        .json({ error: 'revision_conflict', currentRevision: error.currentRevision })
      return
    }
    if (Number.isInteger(status) && status >= 400 && status < 500) {
      response
        .status(status)
        .json({ error: error instanceof Error ? error.message : 'invalid_request' })
      return
    }
    if (
      error instanceof Error &&
      ['invalid_document', 'mutation_reused', 'document_limit'].includes(
        (error as { code?: string }).code || '',
      )
    ) {
      response.status(400).json({ error: (error as { code?: string }).code })
      return
    }
    structuredLog('error', 'user_document_api_failed', {
      requestId: response.locals.requestId,
      errorCode: error instanceof Error ? error.name : 'unknown',
    })
    response
      .status(500)
      .json({ error: 'document_operation_failed', requestId: response.locals.requestId })
  })

  return router
}

export async function userDocumentSourceAccessible(
  database: Database,
  ownerUserId: string,
  payload: unknown,
): Promise<boolean> {
  if (!payload || typeof payload !== 'object') return false
  const source = (payload as { source?: unknown }).source
  if (!source || typeof source !== 'object') return false
  const type = (source as { type?: unknown }).type
  const id = (source as { id?: unknown }).id
  if (type === 'snapshot' || id === undefined) return true
  if (typeof id !== 'string') return false
  const result =
    type === 'game'
      ? await database.query<{ present: number }>(
          `SELECT EXISTS(
             SELECT 1 FROM user_documents
             WHERE owner_user_id = ? AND resource_type = 'games' AND id = ?
           ) AS present`,
          [ownerUserId, id],
        )
      : type === 'study'
        ? await database.query<{ present: number }>(
            `SELECT EXISTS(
               SELECT 1 FROM user_documents
               WHERE owner_user_id = ? AND resource_type = 'studies'
                 AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.id')) = ?
             ) AS present`,
            [ownerUserId, id],
          )
        : null
  return Boolean(result && Number(result.rows[0]?.present) === 1)
}
