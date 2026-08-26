import {
  GameDocument,
  GameSummary,
  LiveGameMode,
  PersistedGameConfig,
  PersistedGameState,
  StoredGameDocument,
} from '../types'
import { decodeGameDocument, encodeGameState } from './codec'
import { accountCacheKey, AccountApiError, accountRequest } from '../auth/api'

export class GameApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly currentRevision?: number,
  ) {
    super(message)
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const generation = accountScopeGeneration
  const controller = new AbortController()
  accountScopeControllers.add(controller)
  try {
    const result = await accountRequest<T>(url, { ...init, signal: controller.signal })
    if (generation !== accountScopeGeneration) {
      throw new GameApiError('账号已切换，已丢弃旧请求结果', 409)
    }
    return result
  } catch (error) {
    if (error instanceof GameApiError) throw error
    if (error instanceof AccountApiError) {
      const details = error.details as { currentRevision?: number } | undefined
      throw new GameApiError(error.code, error.status, details?.currentRevision)
    }
    throw error
  } finally {
    accountScopeControllers.delete(controller)
  }
}

let accountScopeUserId: string | null = null
let accountScopeGeneration = 0
const accountScopeControllers = new Set<AbortController>()

export type GameStorageSource = 'cloud' | 'device' | 'cache'

export function configureGameAccountScope(userId: string | null): void {
  if (accountScopeUserId === userId) return
  accountScopeUserId = userId
  accountScopeGeneration += 1
  for (const controller of accountScopeControllers) controller.abort()
  accountScopeControllers.clear()
}

function mutationId(): string {
  return crypto.randomUUID()
}

function summaryCacheKey(userId: string): string {
  return accountCacheKey(userId, 'games:index')
}

function documentCacheKey(userId: string): string {
  return accountCacheKey(userId, 'games:documents')
}

function writeCache(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Cache pressure must not turn a successful cloud save into a failed save.
  }
}

function readSummaryCache(userId: string): GameSummary[] {
  try {
    const value = JSON.parse(localStorage.getItem(summaryCacheKey(userId)) || '[]') as unknown
    return Array.isArray(value) ? (value as GameSummary[]) : []
  } catch {
    return []
  }
}

function cacheDocument(game: GameDocument): void {
  if (!accountScopeUserId || game.ownerUserId !== accountScopeUserId) return
  try {
    const key = documentCacheKey(accountScopeUserId)
    const current = JSON.parse(localStorage.getItem(key) || '{}') as Record<string, GameDocument>
    const next = { ...current, [game.id]: game }
    const recent = Object.values(next)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 8)
    writeCache(key, Object.fromEntries(recent.map((item) => [item.id, item])))
  } catch {
    // Ignore malformed or unavailable cache storage.
  }
}

function cachedDocument(userId: string, id: string): GameDocument | null {
  try {
    const current = JSON.parse(localStorage.getItem(documentCacheKey(userId)) || '{}') as Record<
      string,
      GameDocument
    >
    return current[id] || null
  } catch {
    return null
  }
}

export async function listGamesWithSource(): Promise<{
  games: GameSummary[]
  source: GameStorageSource
}> {
  try {
    const result = await request<{ games: GameSummary[]; storage?: 'cloud' | 'device' }>(
      '/api/games',
    )
    if (accountScopeUserId && result.storage === 'cloud') {
      writeCache(summaryCacheKey(accountScopeUserId), result.games)
    }
    return {
      games: result.games,
      source: result.storage || (accountScopeUserId ? 'cloud' : 'device'),
    }
  } catch (error) {
    if (accountScopeUserId && error instanceof GameApiError && error.status === 0) {
      const cached = readSummaryCache(accountScopeUserId)
      if (cached.length) return { games: cached, source: 'cache' }
    }
    throw error
  }
}

export async function listGames(): Promise<GameSummary[]> {
  return (await listGamesWithSource()).games
}

export async function loadGame(id: string): Promise<GameDocument> {
  try {
    const game = decodeGameDocument(
      (await request<{ game: StoredGameDocument }>(`/api/games/${encodeURIComponent(id)}`)).game,
    )
    cacheDocument(game)
    return game
  } catch (error) {
    const cached = accountScopeUserId ? cachedDocument(accountScopeUserId, id) : null
    if (cached && error instanceof GameApiError && error.status === 0) return cached
    throw error
  }
}

export async function createGame(
  input: {
    name?: string
    mode: LiveGameMode
    config: PersistedGameConfig
    state: PersistedGameState
  },
  clientMutationId = mutationId(),
): Promise<GameDocument> {
  const response = await request<{ game: StoredGameDocument }>('/api/games', {
    method: 'POST',
    headers: { 'X-Client-Mutation-Id': clientMutationId },
    body: JSON.stringify({
      ...input,
      state: encodeGameState(input.state, input.mode),
    }),
  })
  const game = decodeGameDocument(response.game)
  cacheDocument(game)
  return game
}

export async function saveGameState(
  game: GameDocument,
  state: PersistedGameState,
  leaseToken: string,
  clientMutationId: string,
): Promise<GameDocument> {
  const response = await request<{ game: StoredGameDocument }>(
    `/api/games/${encodeURIComponent(game.id)}/state`,
    {
      method: 'PUT',
      headers: {
        'X-Game-Lease': leaseToken,
        'X-Client-Mutation-Id': clientMutationId,
      },
      body: JSON.stringify({
        expectedRevision: game.revision,
        state: encodeGameState(state, game.mode),
      }),
    },
  )
  const saved = decodeGameDocument(response.game)
  cacheDocument(saved)
  return saved
}

export async function renameGame(
  game: GameSummary,
  name: string,
  leaseToken?: string,
  clientMutationId = mutationId(),
): Promise<GameDocument> {
  const response = await request<{ game: StoredGameDocument }>(
    `/api/games/${encodeURIComponent(game.id)}`,
    {
      method: 'PATCH',
      headers: {
        ...(leaseToken ? { 'X-Game-Lease': leaseToken } : {}),
        'X-Client-Mutation-Id': clientMutationId,
      },
      body: JSON.stringify({ expectedRevision: game.revision, name }),
    },
  )
  const renamed = decodeGameDocument(response.game)
  cacheDocument(renamed)
  return renamed
}

export async function deleteGame(
  game: GameSummary,
  leaseToken?: string,
  clientMutationId = mutationId(),
): Promise<void> {
  await request<void>(`/api/games/${encodeURIComponent(game.id)}?revision=${game.revision}`, {
    method: 'DELETE',
    headers: {
      ...(leaseToken ? { 'X-Game-Lease': leaseToken } : {}),
      'X-Client-Mutation-Id': clientMutationId,
    },
  })
}

export async function importGames(
  payload: unknown,
  importId = mutationId(),
): Promise<{ imported: GameDocument[]; idMap: Record<string, string> }> {
  const response = await request<{
    imported: StoredGameDocument[]
    idMap: Record<string, string>
  }>('/api/games/import', {
    method: 'POST',
    headers: { 'X-Client-Mutation-Id': importId },
    body: JSON.stringify(payload),
  })
  const imported = response.imported.map(decodeGameDocument)
  imported.forEach(cacheDocument)
  return { ...response, imported }
}

export function gameExportUrl(ids?: string[]): string {
  return `/api/games/export${ids?.length ? `?ids=${ids.map(encodeURIComponent).join(',')}` : ''}`
}
