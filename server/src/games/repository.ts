import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, open, readFile, readdir, rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import {
  GameConfig,
  GameDocument,
  GameExportFile,
  GameIndexFile,
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

export class GameStoreUnavailableError extends Error {}
export class GameNotFoundError extends Error {}
export class GameRevisionConflictError extends Error {
  constructor(public readonly currentRevision: number) {
    super('Game revision conflict')
  }
}
export class InvalidGameDataError extends Error {}

export interface CreateGameInput {
  name?: string
  mode: LiveGameMode
  config: GameConfig
  state: StoredGameState
}

export class JsonGameRepository {
  private games = new Map<string, GameDocument>()
  private mutationQueue: Promise<void> = Promise.resolve()
  private available = true
  private initialized = false

  constructor(private readonly directory: string) {}

  async init(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    try {
      await mkdir(this.directory, { recursive: true })
      const files = await readdir(this.directory)
      const ids = new Set(
        files.flatMap((file) => {
          const match = /^([0-9a-f-]{36})\.json(?:\.bak)?$/i.exec(file)
          return match ? [match[1]] : []
        }),
      )
      for (const id of ids) {
        const game = await this.readGameWithBackup(id)
        if (game) this.games.set(id, game)
      }
      await this.writeIndex().catch(() => undefined)
    } catch (error) {
      this.available = false
      throw new GameStoreUnavailableError(
        error instanceof Error ? error.message : 'Game store unavailable',
      )
    }
  }

  isAvailable(): boolean {
    return this.available
  }

  list(): GameSummary[] {
    this.assertAvailable()
    return [...this.games.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((game) => this.summary(game))
  }

  get(id: string): GameDocument {
    this.assertAvailable()
    const game = this.games.get(id)
    if (!game) throw new GameNotFoundError('Game not found')
    return structuredClone(game)
  }

  async create(input: CreateGameInput): Promise<GameDocument> {
    return this.runMutation(async () => {
      this.assertAvailable()
      if (this.games.size >= MAX_STORED_GAMES)
        throw new InvalidGameDataError('Game store limit exceeded')
      if (
        !isLiveGameMode(input.mode) ||
        !isGameConfig(input.config) ||
        !isStoredGameState(input.state, input.mode)
      )
        throw new InvalidGameDataError('Invalid game data')
      const now = Date.now()
      const game: GameDocument = {
        id: randomUUID(),
        schemaVersion: 2,
        revision: 0,
        name: input.name?.trim().slice(0, 100) || this.defaultName(input.mode, now),
        mode: input.mode,
        config: structuredClone(input.config),
        state: structuredClone(input.state),
        createdAt: now,
        updatedAt: now,
      }
      await this.writeGame(game)
      this.games.set(game.id, game)
      await this.writeIndex().catch(() => undefined)
      return structuredClone(game)
    })
  }

  async updateState(
    id: string,
    expectedRevision: number,
    state: StoredGameState,
  ): Promise<GameDocument> {
    return this.runMutation(async () => {
      const current = this.get(id)
      if (current.revision !== expectedRevision)
        throw new GameRevisionConflictError(current.revision)
      if (!isStoredGameState(state, current.mode))
        throw new InvalidGameDataError('Invalid game state')
      const next = {
        ...current,
        revision: current.revision + 1,
        state: structuredClone(state),
        updatedAt: Date.now(),
      }
      await this.writeGame(next)
      this.games.set(id, next)
      await this.writeIndex().catch(() => undefined)
      return structuredClone(next)
    })
  }

  async rename(id: string, expectedRevision: number, name: string): Promise<GameDocument> {
    return this.runMutation(async () => {
      const current = this.get(id)
      if (current.revision !== expectedRevision)
        throw new GameRevisionConflictError(current.revision)
      const trimmed = name.trim()
      if (!trimmed || trimmed.length > 100) throw new InvalidGameDataError('Invalid game name')
      const next = {
        ...current,
        revision: current.revision + 1,
        name: trimmed,
        updatedAt: Date.now(),
      }
      await this.writeGame(next)
      this.games.set(id, next)
      await this.writeIndex().catch(() => undefined)
      return structuredClone(next)
    })
  }

  async delete(id: string, expectedRevision: number): Promise<void> {
    await this.runMutation(async () => {
      const current = this.get(id)
      if (current.revision !== expectedRevision)
        throw new GameRevisionConflictError(current.revision)
      await Promise.all([
        unlink(this.gamePath(id)).catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }),
        unlink(this.backupPath(id)).catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }),
      ])
      this.games.delete(id)
      await this.writeIndex().catch(() => undefined)
    })
  }

  export(ids?: string[]): GameExportFile {
    this.assertAvailable()
    const selected = ids
      ? ids.map((id) => this.get(id))
      : [...this.games.values()].map((game) => structuredClone(game))
    return { exportVersion: 2, exportedAt: Date.now(), games: selected }
  }

  async import(
    value: unknown,
  ): Promise<{ imported: GameDocument[]; idMap: Record<string, string> }> {
    return this.runMutation(async () => {
      this.assertAvailable()
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
      if (this.games.size + raw.games.length > MAX_STORED_GAMES)
        throw new InvalidGameDataError('Game store limit exceeded')
      const sourceIds = (raw.games as GameDocument[]).map((game) => game.id)
      if (new Set(sourceIds).size !== sourceIds.length)
        throw new InvalidGameDataError('Duplicate game ids in export')
      const imported: GameDocument[] = []
      const idMap: Record<string, string> = {}
      const writtenIds: string[] = []
      try {
        for (const source of raw.games as GameDocument[]) {
          const id = this.games.has(source.id) ? randomUUID() : source.id
          idMap[source.id] = id
          const game = structuredClone({
            ...source,
            id,
            schemaVersion: 2 as const,
            revision: 0,
            updatedAt: Date.now(),
          })
          await this.writeGame(game)
          writtenIds.push(id)
          imported.push(game)
        }
      } catch (error) {
        await Promise.all(writtenIds.map((id) => unlink(this.gamePath(id)).catch(() => undefined)))
        throw error
      }
      for (const game of imported) this.games.set(game.id, game)
      await this.writeIndex().catch(() => undefined)
      return { imported: structuredClone(imported), idMap }
    })
  }

  async flush(): Promise<void> {
    await this.mutationQueue
  }

  private runMutation<T>(action: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(action, action)
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private summary(game: GameDocument): GameSummary {
    return {
      id: game.id,
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

  private async writeGame(game: GameDocument): Promise<void> {
    await this.atomicWrite(this.gamePath(game.id), game, true)
  }

  private async writeIndex(): Promise<void> {
    const index: GameIndexFile = {
      schemaVersion: 2,
      games: Object.fromEntries([...this.games].map(([id, game]) => [id, this.summary(game)])),
    }
    await this.atomicWrite(path.join(this.directory, 'index.json'), index, true)
  }

  private async atomicWrite(target: string, value: unknown, backup: boolean): Promise<void> {
    await mkdir(path.dirname(target), { recursive: true })
    if (backup && (await this.exists(target))) await copyFile(target, `${target}.bak`)
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      const handle = await open(temporary, 'w', 0o600)
      try {
        await handle.writeFile(JSON.stringify(value), 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temporary, target)
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
  }

  private async readGameWithBackup(id: string): Promise<GameDocument | null> {
    const main = await this.readGame(this.gamePath(id), id)
    if (main) return main
    const backup = await this.readGame(this.backupPath(id), id)
    if (!backup) return null
    await copyFile(this.backupPath(id), this.gamePath(id))
    return backup
  }

  private async readGame(file: string, id: string): Promise<GameDocument | null> {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as unknown
      return isGameDocument(parsed) && parsed.id === id ? parsed : null
    } catch {
      return null
    }
  }

  private gamePath(id: string): string {
    return path.join(this.directory, `${id}.json`)
  }
  private backupPath(id: string): string {
    return `${this.gamePath(id)}.bak`
  }

  private async exists(file: string): Promise<boolean> {
    try {
      await stat(file)
      return true
    } catch {
      return false
    }
  }

  private assertAvailable(): void {
    if (!this.available) throw new GameStoreUnavailableError('Game store unavailable')
  }

  private defaultName(mode: LiveGameMode, now: number): string {
    const names: Record<LiveGameMode, string> = {
      'human-vs-ai': '人机对弈',
      'human-vs-human': '双人对弈',
      'ai-vs-ai': 'AI 对战',
      jieqi: '揭棋对弈',
    }
    return `${names[mode]} ${new Date(now).toLocaleString('zh-CN', { hour12: false })}`
  }
}
