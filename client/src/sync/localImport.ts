import { accountCacheKey, accountRequest } from '../auth/api'
import { type CloudDocumentResource, importCloudDocumentBatch } from './cloudDocuments'

export type ImportableResource = Exclude<CloudDocumentResource, 'jieqi-seat-records'>

export type LegacyDataCategory = {
  resource: CloudDocumentResource
  label: string
  key: string
  count: number
  bytes: number
  selectable: boolean
  reason?: 'damaged' | 'sensitive'
}

export type LegacyImportScan = {
  categories: LegacyDataCategory[]
  excludedCapabilityCount: number
}

export type LegacyImportJob = {
  importId: string
  selected: ImportableResource[]
  status: 'pending' | 'partial' | 'complete'
  resources: Partial<Record<ImportableResource, 'pending' | 'complete' | 'failed'>>
  errors: Partial<Record<ImportableResource, string>>
}

export type LegacyConflictPreview = Record<
  ImportableResource,
  { newItems: number; sameContent: number; differentContent: number }
>

type Definition = {
  resource: CloudDocumentResource
  label: string
  key: string
  parse(value: unknown): object[]
  sensitive?: boolean
}

const array = (value: unknown): object[] =>
  Array.isArray(value)
    ? value.filter((item): item is object => Boolean(item) && typeof item === 'object')
    : []

const definitions: Definition[] = [
  { resource: 'studies', label: '研究与变招树', key: 'xiangqi.study-positions.v1', parse: array },
  { resource: 'training-tasks', label: '训练题', key: 'xiangqi.training-tasks.v1', parse: array },
  {
    resource: 'custom-endgames',
    label: '自定义残局',
    key: 'xiangqi.custom-endgames.v1',
    parse: array,
  },
  {
    resource: 'favorite-endgames',
    label: '残局收藏',
    key: 'xiangqi.favorite-endgames.v1',
    parse: (value) =>
      Array.isArray(value)
        ? value
            .filter((id): id is string => typeof id === 'string')
            .map((endgameId) => ({ endgameId }))
        : [],
  },
  {
    resource: 'jieqi-seat-records',
    label: '揭棋席位私有备份',
    key: 'xiangqi.jieqi-seat-records.v1',
    parse: array,
    sensitive: true,
  },
  { resource: 'gomoku-history', label: '五子棋历史', key: 'gomoku-game-history-v1', parse: array },
  { resource: 'recent-fens', label: '最近局面', key: 'xiangqi_recent_fens', parse: array },
  {
    resource: 'account-settings',
    label: '账号偏好',
    key: 'xiangqi_engine_settings',
    parse: (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return []
      const source = value as Record<string, unknown>
      const allowed = [
        'candidateCount',
        'candidateAutoRefreshDelay',
        'hintDifficulty',
        'searchMode',
        'searchDepth',
        'searchTimeMs',
      ]
      const account = Object.fromEntries(
        allowed.flatMap((key) => (key in source ? [[key, source[key]]] : [])),
      )
      return Object.keys(account).length ? [account] : []
    },
  },
]

const CAPABILITY_KEYS = [
  /^xiangqi-lan-token:/,
  /^xiangqi-lan-invite:/,
  /^xiangqi-lan-client-id:/,
  /^gomoku-lan-token:/,
  /^gomoku-lan-invite:/,
]

function decode(definition: Definition, storage: Storage): object[] {
  const raw = storage.getItem(definition.key)
  if (!raw) return []
  return definition.parse(JSON.parse(raw) as unknown)
}

function logicalId(resource: ImportableResource, value: object): string {
  const item = value as Record<string, unknown>
  if (resource === 'favorite-endgames') return String(item.endgameId || '')
  if (resource === 'recent-fens') return String(item.fen || '')
  if (resource === 'account-settings') return 'settings'
  return String(item.id || '')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function scanLegacyLocalData(storage: Storage = localStorage): LegacyImportScan {
  const categories: LegacyDataCategory[] = []
  for (const definition of definitions) {
    const raw = storage.getItem(definition.key)
    if (!raw) continue
    try {
      const values = decode(definition, storage)
      categories.push({
        resource: definition.resource,
        label: definition.label,
        key: definition.key,
        count: values.length,
        bytes: new Blob([raw]).size,
        selectable: !definition.sensitive && values.length > 0,
        ...(definition.sensitive ? { reason: 'sensitive' as const } : {}),
      })
    } catch {
      categories.push({
        resource: definition.resource,
        label: definition.label,
        key: definition.key,
        count: 0,
        bytes: new Blob([raw]).size,
        selectable: false,
        reason: 'damaged',
      })
    }
  }
  let excludedCapabilityCount = 0
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key && CAPABILITY_KEYS.some((pattern) => pattern.test(key))) excludedCapabilityCount += 1
  }
  return { categories, excludedCapabilityCount }
}

function jobKey(userId: string): string {
  return accountCacheKey(userId, 'legacy-import-job')
}

export function loadLegacyImportJob(
  userId: string,
  storage: Storage = localStorage,
): LegacyImportJob | null {
  try {
    const raw = storage.getItem(jobKey(userId))
    return raw ? (JSON.parse(raw) as LegacyImportJob) : null
  } catch {
    return null
  }
}

export async function runLegacyImport(
  userId: string,
  selected: ImportableResource[],
  storage: Storage = localStorage,
): Promise<LegacyImportJob> {
  const previous = loadLegacyImportJob(userId, storage)
  const sameSelection =
    previous && [...previous.selected].sort().join() === [...selected].sort().join()
  const job: LegacyImportJob = sameSelection
    ? previous
    : {
        importId: crypto.randomUUID(),
        selected: [...selected],
        status: 'pending',
        resources: Object.fromEntries(selected.map((resource) => [resource, 'pending'])),
        errors: {},
      }
  for (const resource of selected) {
    if (job.resources[resource] === 'complete') continue
    const definition = definitions.find((item) => item.resource === resource)!
    try {
      const documents = decode(definition, storage)
      await importCloudDocumentBatch(resource, documents, `${job.importId}:${resource}`)
      job.resources[resource] = 'complete'
      delete job.errors[resource]
    } catch (error) {
      job.resources[resource] = 'failed'
      job.errors[resource] = error instanceof Error ? error.message : 'import_failed'
    }
    storage.setItem(jobKey(userId), JSON.stringify(job))
  }
  job.status = selected.every((resource) => job.resources[resource] === 'complete')
    ? 'complete'
    : 'partial'
  storage.setItem(jobKey(userId), JSON.stringify(job))
  return job
}

export async function previewLegacyConflicts(
  selected: ImportableResource[],
  storage: Storage = localStorage,
): Promise<Partial<LegacyConflictPreview>> {
  const result: Partial<LegacyConflictPreview> = {}
  for (const resource of selected) {
    const definition = definitions.find((item) => item.resource === resource)!
    const local = decode(definition, storage)
    const cloud = await accountRequest<{ documents: Array<{ payload: object }> }>(
      `/api/me/documents/${resource}`,
    )
    const cloudById = new Map(
      cloud.documents.map((document) => [logicalId(resource, document.payload), document.payload]),
    )
    const summary = { newItems: 0, sameContent: 0, differentContent: 0 }
    for (const payload of local) {
      const existing = cloudById.get(logicalId(resource, payload))
      if (!existing) summary.newItems += 1
      else if (stableJson(existing) === stableJson(payload)) summary.sameContent += 1
      else summary.differentContent += 1
    }
    result[resource] = summary
  }
  return result
}

export function clearImportedLegacyData(
  resources: ImportableResource[],
  storage: Storage = localStorage,
): void {
  for (const resource of resources) {
    const definition = definitions.find((item) => item.resource === resource)
    if (definition) storage.removeItem(definition.key)
  }
}
