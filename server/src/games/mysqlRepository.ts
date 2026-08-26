import type { Database } from '../db/database.js'
import { RepositoryNotFoundError, RepositoryRevisionConflictError } from '../db/errors.js'
import type { UserDocumentEntity } from '../repositories/contracts.js'
import {
  MySqlUserDocumentRepository,
  UserDocumentInputError,
  UserDocumentLimitError,
  UserDocumentMutationReuseError,
} from '../repositories/userDocuments.js'
import {
  GameNotFoundError,
  GameRevisionConflictError,
  InvalidGameDataError,
  type CreateGameInput,
} from './repository.js'
import type {
  GameConfig,
  GameDocument,
  GameExportFile,
  GameSummary,
  LiveGameMode,
  StoredGameState,
} from './types.js'
import {
  getCompactLineMoveCount,
  isGameConfig,
  isGameDocument,
  isLiveGameMode,
  isStoredGameState,
  MAX_STORED_GAMES,
} from './validation.js'

type GamePayload = {
  name: string
  mode: LiveGameMode
  config: GameConfig
  state: StoredGameState
}

function isGamePayload(value: unknown): value is GamePayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Record<string, unknown>
  return (
    typeof payload.name === 'string' &&
    Boolean(payload.name.trim()) &&
    payload.name.length <= 100 &&
    isLiveGameMode(payload.mode) &&
    isGameConfig(payload.config) &&
    isStoredGameState(payload.state, payload.mode as LiveGameMode)
  )
}

function defaultName(mode: LiveGameMode, now: number): string {
  const names: Record<LiveGameMode, string> = {
    'human-vs-ai': '人机对弈',
    'human-vs-human': '双人对弈',
    'ai-vs-ai': 'AI 对战',
    jieqi: '揭棋对弈',
  }
  return `${names[mode]} ${new Date(now).toLocaleString('zh-CN', { hour12: false })}`
}

export class MySqlGameRepository {
  private readonly documents: MySqlUserDocumentRepository<GamePayload>

  constructor(database: Database) {
    this.documents = new MySqlUserDocumentRepository(
      database,
      'games',
      2,
      isGamePayload,
      MAX_STORED_GAMES,
    )
  }

  async list(ownerUserId: string): Promise<GameSummary[]> {
    return (await this.documents.list(ownerUserId)).map((entity) => this.summary(this.game(entity)))
  }

  async get(ownerUserId: string, id: string): Promise<GameDocument> {
    const entity = await this.documents.find(ownerUserId, id)
    if (!entity) throw new GameNotFoundError('Game not found')
    return this.game(entity)
  }

  async create(ownerUserId: string, input: CreateGameInput): Promise<GameDocument> {
    try {
      if (!input.clientMutationId) throw new InvalidGameDataError('clientMutationId 必填')
      this.assertCloudMode(input.mode)
      const now = Date.now()
      return this.game(
        await this.documents.create(
          ownerUserId,
          {
            name: input.name?.trim().slice(0, 100) || defaultName(input.mode, now),
            mode: input.mode,
            config: structuredClone(input.config),
            state: structuredClone(input.state),
          },
          input.clientMutationId,
        ),
      )
    } catch (error) {
      throw this.translate(error)
    }
  }

  async updateState(
    ownerUserId: string,
    id: string,
    expectedRevision: number,
    state: StoredGameState,
    clientMutationId: string,
  ): Promise<GameDocument> {
    try {
      const current = await this.get(ownerUserId, id)
      return this.game(
        await this.documents.update(
          ownerUserId,
          id,
          expectedRevision,
          {
            name: current.name,
            mode: current.mode,
            config: current.config,
            state,
          },
          clientMutationId,
        ),
      )
    } catch (error) {
      throw this.translate(error)
    }
  }

  async rename(
    ownerUserId: string,
    id: string,
    expectedRevision: number,
    name: string,
    clientMutationId: string,
  ): Promise<GameDocument> {
    try {
      const trimmed = name.trim()
      if (!trimmed || trimmed.length > 100) throw new InvalidGameDataError('Invalid game name')
      const current = await this.get(ownerUserId, id)
      return this.game(
        await this.documents.update(
          ownerUserId,
          id,
          expectedRevision,
          {
            name: trimmed,
            mode: current.mode,
            config: current.config,
            state: current.state,
          },
          clientMutationId,
        ),
      )
    } catch (error) {
      throw this.translate(error)
    }
  }

  async delete(
    ownerUserId: string,
    id: string,
    expectedRevision: number,
    clientMutationId: string,
  ): Promise<void> {
    try {
      await this.documents.delete(ownerUserId, id, expectedRevision, clientMutationId)
    } catch (error) {
      throw this.translate(error)
    }
  }

  async export(ownerUserId: string, ids?: string[]): Promise<GameExportFile> {
    const selected = ids
      ? await Promise.all(ids.map((id) => this.get(ownerUserId, id)))
      : (await this.documents.list(ownerUserId)).map((entity) => this.game(entity))
    if (selected.some((game) => game.mode === 'jieqi')) {
      throw new InvalidGameDataError('普通对局导出不支持揭棋裁判数据')
    }
    return { exportVersion: 2, exportedAt: Date.now(), games: selected }
  }

  async import(
    ownerUserId: string,
    value: unknown,
    importId: string,
  ): Promise<{ imported: GameDocument[]; idMap: Record<string, string> }> {
    const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : null
    if (
      !raw ||
      raw.exportVersion !== 2 ||
      !Array.isArray(raw.games) ||
      raw.games.length > MAX_STORED_GAMES ||
      !raw.games.every(isGameDocument)
    ) {
      throw new InvalidGameDataError('Invalid game export')
    }
    const sources = raw.games as GameDocument[]
    if (sources.some((game) => game.mode === 'jieqi')) {
      throw new InvalidGameDataError('普通对局导入不支持揭棋裁判数据')
    }
    if (new Set(sources.map((game) => game.id)).size !== sources.length) {
      throw new InvalidGameDataError('Duplicate game ids in export')
    }
    const imported: GameDocument[] = []
    const idMap: Record<string, string> = {}
    for (const source of sources) {
      const game = await this.create(ownerUserId, {
        name: source.name,
        mode: source.mode,
        config: source.config,
        state: source.state,
        clientMutationId: `${importId}:${source.id}`,
      })
      imported.push(game)
      idMap[source.id] = game.id
    }
    return { imported, idMap }
  }

  private game(entity: UserDocumentEntity<GamePayload>): GameDocument {
    return {
      id: entity.id,
      ownerUserId: entity.ownerUserId,
      schemaVersion: 2,
      revision: entity.revision,
      clientMutationId: entity.clientMutationId,
      name: entity.payload.name,
      mode: entity.payload.mode,
      config: structuredClone(entity.payload.config),
      state: structuredClone(entity.payload.state),
      createdAt: entity.createdAt.getTime(),
      updatedAt: entity.updatedAt.getTime(),
    }
  }

  private summary(game: GameDocument): GameSummary {
    return {
      id: game.id,
      ownerUserId: game.ownerUserId,
      revision: game.revision,
      name: game.name,
      mode: game.mode,
      config: structuredClone(game.config),
      status: game.state.s,
      moveCount: getCompactLineMoveCount(game.state),
      createdAt: game.createdAt,
      updatedAt: game.updatedAt,
    }
  }

  private assertCloudMode(mode: LiveGameMode): void {
    if (mode === 'jieqi') {
      throw new InvalidGameDataError('揭棋裁判状态不能保存到普通云端对局库')
    }
  }

  private translate(error: unknown): unknown {
    if (error instanceof RepositoryNotFoundError) return new GameNotFoundError('Game not found')
    if (error instanceof RepositoryRevisionConflictError) {
      return new GameRevisionConflictError(error.currentRevision ?? 0)
    }
    if (
      error instanceof UserDocumentInputError ||
      error instanceof UserDocumentMutationReuseError ||
      error instanceof UserDocumentLimitError
    ) {
      return new InvalidGameDataError(error.message)
    }
    return error
  }
}
