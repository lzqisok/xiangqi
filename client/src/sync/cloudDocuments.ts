import { accountCacheKey, AccountApiError, accountRequest } from '../auth/api'

export type CloudDocumentResource =
  | 'studies'
  | 'training-tasks'
  | 'custom-endgames'
  | 'favorite-endgames'
  | 'jieqi-seat-records'
  | 'gomoku-history'
  | 'recent-fens'
  | 'account-settings'

type CloudDocument<T> = {
  id: string
  ownerUserId: string
  schemaVersion: number
  revision: number
  clientMutationId: string
  createdAt: number
  updatedAt: number
  payload: T
}

type CloudMetadata = { documentId: string; revision: number }
type PendingMutation = {
  operation: 'create' | 'update' | 'delete'
  logicalId: string
  payload?: object
  clientMutationId: string
}

let activeUserId: string | null = null
let scopeGeneration = 0
const queues = new Map<string, Promise<void>>()
const ALL_RESOURCES: CloudDocumentResource[] = [
  'studies',
  'training-tasks',
  'custom-endgames',
  'favorite-endgames',
  'jieqi-seat-records',
  'gomoku-history',
  'recent-fens',
  'account-settings',
]

export function configureCloudDocumentScope(userId: string | null): void {
  if (activeUserId === userId) return
  activeUserId = userId
  scopeGeneration += 1
  queues.clear()
  if (userId) setTimeout(() => retryPending(userId, scopeGeneration), 0)
}

if (typeof window !== 'undefined') {
  window.addEventListener('xiangqi-auth-changed', (event) => {
    const detail = (event as CustomEvent<{ userId?: string | null }>).detail
    configureCloudDocumentScope(detail?.userId || null)
  })
  window.addEventListener('online', () => {
    if (activeUserId) retryPending(activeUserId, scopeGeneration)
  })
}

export function scopedStorageKey(baseKey: string): string {
  return activeUserId ? accountCacheKey(activeUserId, `local-cache:${baseKey}`) : baseKey
}

export function cloudSyncEnabled(): boolean {
  return Boolean(activeUserId)
}

export function resolveCloudConflict(
  resource: CloudDocumentResource,
  logicalId: string,
  resolution: 'keep-local' | 'use-cloud',
): void {
  const userId = activeUserId
  if (!userId) return
  const pending = readJson<Record<string, PendingMutation>>(pendingKey(userId, resource), {})[
    logicalId
  ]
  if (!pending) return
  if (resolution === 'use-cloud') {
    clearPending(userId, resource, logicalId)
    return
  }
  const current = metadata(userId, resource)[logicalId]
  const retry: PendingMutation = {
    ...pending,
    operation: pending.operation === 'delete' ? 'delete' : current ? 'update' : 'create',
    clientMutationId: crypto.randomUUID(),
  }
  retainPending(userId, resource, retry)
  scheduleMutation(userId, scopeGeneration, resource, retry)
}

function metadataKey(userId: string, resource: CloudDocumentResource): string {
  return accountCacheKey(userId, `sync-meta:${resource}`)
}

function pendingKey(userId: string, resource: CloudDocumentResource): string {
  return accountCacheKey(userId, `sync-pending:${resource}`)
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Local cache pressure must not break the active editor.
  }
}

function metadata(userId: string, resource: CloudDocumentResource): Record<string, CloudMetadata> {
  return readJson(metadataKey(userId, resource), {})
}

function updateMetadata(
  userId: string,
  resource: CloudDocumentResource,
  logicalId: string,
  document: CloudDocument<unknown> | null,
): void {
  const current = metadata(userId, resource)
  if (document) {
    current[logicalId] = { documentId: document.id, revision: document.revision }
  } else {
    delete current[logicalId]
  }
  writeJson(metadataKey(userId, resource), current)
}

function updateMetadataRevision(
  userId: string,
  resource: CloudDocumentResource,
  logicalId: string,
  revision: number,
): void {
  const current = metadata(userId, resource)
  if (!current[logicalId]) return
  current[logicalId] = { ...current[logicalId], revision }
  writeJson(metadataKey(userId, resource), current)
}

function retainPending(
  userId: string,
  resource: CloudDocumentResource,
  mutation: PendingMutation,
): void {
  const current = readJson<Record<string, PendingMutation>>(pendingKey(userId, resource), {})
  current[mutation.logicalId] = mutation
  writeJson(pendingKey(userId, resource), current)
}

function clearPending(userId: string, resource: CloudDocumentResource, logicalId: string): void {
  const current = readJson<Record<string, PendingMutation>>(pendingKey(userId, resource), {})
  delete current[logicalId]
  writeJson(pendingKey(userId, resource), current)
}

function emitFailure(
  resource: CloudDocumentResource,
  logicalId: string,
  kind: 'offline' | 'conflict' | 'error',
): void {
  window.dispatchEvent(
    new CustomEvent('xiangqi-cloud-sync-status', { detail: { resource, logicalId, kind } }),
  )
}

function emitSyncState(
  resource: CloudDocumentResource,
  logicalId: string,
  kind: 'pending' | 'saving' | 'synced',
): void {
  window.dispatchEvent(
    new CustomEvent('xiangqi-cloud-sync-status', { detail: { resource, logicalId, kind } }),
  )
}

function enqueue(resource: CloudDocumentResource, logicalId: string, action: () => Promise<void>) {
  const key = `${resource}:${logicalId}`
  const previous = queues.get(key) || Promise.resolve()
  const next = previous.then(action, action)
  const tracked = next.finally(() => {
    if (queues.get(key) === tracked) queues.delete(key)
  })
  queues.set(key, tracked)
}

export async function pullCloudDocuments<T extends object>(
  resource: CloudDocumentResource,
  logicalId: (payload: T) => string,
): Promise<T[] | null> {
  const userId = activeUserId
  if (!userId) return null
  const generation = scopeGeneration
  const result = await accountRequest<{ documents: CloudDocument<T>[] }>(
    `/api/me/documents/${resource}`,
  )
  if (generation !== scopeGeneration || userId !== activeUserId) return null
  const nextMetadata: Record<string, CloudMetadata> = {}
  const payloads: T[] = []
  for (const document of result.documents) {
    if (document.ownerUserId !== userId) continue
    const id = logicalId(document.payload)
    if (!id) continue
    nextMetadata[id] = { documentId: document.id, revision: document.revision }
    payloads.push(document.payload)
  }
  writeJson(metadataKey(userId, resource), nextMetadata)
  return payloads
}

export function queueCloudUpsert(
  resource: CloudDocumentResource,
  logicalId: string,
  payload: object,
): void {
  const userId = activeUserId
  if (!userId) return
  const current = metadata(userId, resource)[logicalId]
  const pending: PendingMutation = {
    operation: current ? 'update' : 'create',
    logicalId,
    payload: structuredClone(payload),
    clientMutationId: crypto.randomUUID(),
  }
  retainPending(userId, resource, pending)
  emitSyncState(resource, logicalId, 'pending')
  scheduleMutation(userId, scopeGeneration, resource, pending)
}

export function queueCloudDelete(resource: CloudDocumentResource, logicalId: string): void {
  const userId = activeUserId
  if (!userId) return
  const current = metadata(userId, resource)[logicalId]
  if (!current) return
  const pending: PendingMutation = {
    operation: 'delete',
    logicalId,
    clientMutationId: crypto.randomUUID(),
  }
  retainPending(userId, resource, pending)
  emitSyncState(resource, logicalId, 'pending')
  scheduleMutation(userId, scopeGeneration, resource, pending)
}

export async function importCloudDocumentBatch(
  resource: CloudDocumentResource,
  documents: object[],
  importId: string,
): Promise<number> {
  const userId = activeUserId
  const generation = scopeGeneration
  if (!userId) throw new AccountApiError(401, 'authentication_required')
  const result = await accountRequest<{ documents: CloudDocument<object>[] }>(
    `/api/me/documents/${resource}/import`,
    {
      method: 'POST',
      headers: { 'X-Client-Mutation-Id': importId },
      body: JSON.stringify({ documents }),
    },
  )
  if (generation !== scopeGeneration || userId !== activeUserId) {
    throw new AccountApiError(409, 'account_scope_changed')
  }
  return result.documents.length
}

function retryPending(userId: string, generation: number): void {
  if (userId !== activeUserId || generation !== scopeGeneration) return
  for (const resource of ALL_RESOURCES) {
    const mutations = readJson<Record<string, PendingMutation>>(pendingKey(userId, resource), {})
    for (const mutation of Object.values(mutations)) {
      scheduleMutation(userId, generation, resource, mutation)
    }
  }
}

function scheduleMutation(
  userId: string,
  generation: number,
  resource: CloudDocumentResource,
  pending: PendingMutation,
): void {
  const logicalId = pending.logicalId
  enqueue(resource, logicalId, async () => {
    if (generation !== scopeGeneration || userId !== activeUserId) return
    const current = metadata(userId, resource)[logicalId]
    try {
      emitSyncState(resource, logicalId, 'saving')
      if (pending.operation === 'delete') {
        if (!current) {
          clearPending(userId, resource, logicalId)
          return
        }
        await accountRequest<void>(
          `/api/me/documents/${resource}/${encodeURIComponent(current.documentId)}?revision=${current.revision}`,
          { method: 'DELETE', headers: { 'X-Client-Mutation-Id': pending.clientMutationId } },
        )
        if (generation !== scopeGeneration || userId !== activeUserId) return
        updateMetadata(userId, resource, logicalId, null)
        clearPending(userId, resource, logicalId)
        emitSyncState(resource, logicalId, 'synced')
        return
      }
      const result =
        pending.operation === 'update' && current
          ? await accountRequest<{ document: CloudDocument<object> }>(
              `/api/me/documents/${resource}/${encodeURIComponent(current.documentId)}`,
              {
                method: 'PUT',
                headers: { 'X-Client-Mutation-Id': pending.clientMutationId },
                body: JSON.stringify({
                  expectedRevision: current.revision,
                  payload: pending.payload,
                }),
              },
            )
          : await accountRequest<{ document: CloudDocument<object> }>(
              `/api/me/documents/${resource}`,
              {
                method: 'POST',
                headers: { 'X-Client-Mutation-Id': pending.clientMutationId },
                body: JSON.stringify({ payload: pending.payload }),
              },
            )
      if (generation !== scopeGeneration || userId !== activeUserId) return
      updateMetadata(userId, resource, logicalId, result.document)
      clearPending(userId, resource, logicalId)
      emitSyncState(resource, logicalId, 'synced')
    } catch (error) {
      if (error instanceof AccountApiError && error.status === 409 && current) {
        const currentRevision = Number(
          (error.details as { currentRevision?: number } | undefined)?.currentRevision,
        )
        if (Number.isSafeInteger(currentRevision) && currentRevision >= 0) {
          updateMetadataRevision(userId, resource, logicalId, currentRevision)
        }
      }
      const kind =
        error instanceof AccountApiError && error.status === 409
          ? 'conflict'
          : error instanceof AccountApiError && error.status === 0
            ? 'offline'
            : 'error'
      emitFailure(resource, logicalId, kind)
    }
  })
}

export function pendingCloudMutationCount(): number {
  if (!activeUserId) return 0
  return ALL_RESOURCES.reduce(
    (count, resource) =>
      count +
      Object.keys(
        readJson<Record<string, PendingMutation>>(pendingKey(activeUserId!, resource), {}),
      ).length,
    0,
  )
}

export function retryPendingCloudMutations(): void {
  if (activeUserId) retryPending(activeUserId, scopeGeneration)
}

export function downloadPendingCloudMutations(): void {
  if (!activeUserId) return
  const resources = Object.fromEntries(
    ALL_RESOURCES.map((resource) => [
      resource,
      readJson<Record<string, PendingMutation>>(pendingKey(activeUserId!, resource), {}),
    ]),
  )
  const url = URL.createObjectURL(
    new Blob(
      [JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), resources }, null, 2)],
      {
        type: 'application/json',
      },
    ),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `xiangqi-pending-sync-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
