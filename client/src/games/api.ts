import {
  GameDocument,
  GameSummary,
  LiveGameMode,
  PersistedGameConfig,
  PersistedGameState,
  StoredGameDocument,
} from '../types'
import { decodeGameDocument, encodeGameState } from './codec'

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
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string
      currentRevision?: number
    }
    throw new GameApiError(
      body.error || `HTTP ${response.status}`,
      response.status,
      body.currentRevision,
    )
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>)
}

export async function listGames(): Promise<GameSummary[]> {
  return (await request<{ games: GameSummary[] }>('/api/games')).games
}

export async function loadGame(id: string): Promise<GameDocument> {
  return decodeGameDocument(
    (await request<{ game: StoredGameDocument }>(`/api/games/${encodeURIComponent(id)}`)).game,
  )
}

export async function createGame(input: {
  name?: string
  mode: LiveGameMode
  config: PersistedGameConfig
  state: PersistedGameState
}): Promise<GameDocument> {
  const response = await request<{ game: StoredGameDocument }>('/api/games', {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      state: encodeGameState(input.state, input.mode),
    }),
  })
  return decodeGameDocument(response.game)
}

export async function saveGameState(
  game: GameDocument,
  state: PersistedGameState,
  leaseToken: string,
): Promise<GameDocument> {
  const response = await request<{ game: StoredGameDocument }>(
    `/api/games/${encodeURIComponent(game.id)}/state`,
    {
      method: 'PUT',
      headers: { 'X-Game-Lease': leaseToken },
      body: JSON.stringify({
        expectedRevision: game.revision,
        state: encodeGameState(state, game.mode),
      }),
    },
  )
  return decodeGameDocument(response.game)
}

export async function renameGame(
  game: GameSummary,
  name: string,
  leaseToken?: string,
): Promise<GameDocument> {
  const response = await request<{ game: StoredGameDocument }>(
    `/api/games/${encodeURIComponent(game.id)}`,
    {
      method: 'PATCH',
      headers: leaseToken ? { 'X-Game-Lease': leaseToken } : undefined,
      body: JSON.stringify({ expectedRevision: game.revision, name }),
    },
  )
  return decodeGameDocument(response.game)
}

export async function deleteGame(game: GameSummary, leaseToken?: string): Promise<void> {
  await request<void>(`/api/games/${encodeURIComponent(game.id)}?revision=${game.revision}`, {
    method: 'DELETE',
    headers: leaseToken ? { 'X-Game-Lease': leaseToken } : undefined,
  })
}

export async function importGames(
  payload: unknown,
): Promise<{ imported: GameDocument[]; idMap: Record<string, string> }> {
  const response = await request<{
    imported: StoredGameDocument[]
    idMap: Record<string, string>
  }>('/api/games/import', { method: 'POST', body: JSON.stringify(payload) })
  return { ...response, imported: response.imported.map(decodeGameDocument) }
}

export function gameExportUrl(ids?: string[]): string {
  return `/api/games/export${ids?.length ? `?ids=${ids.map(encodeURIComponent).join(',')}` : ''}`
}
