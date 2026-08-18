import { Router, Request, Response } from 'express'
import { GameLeaseManager } from './leases.js'
import {
  GameNotFoundError,
  GameRevisionConflictError,
  GameStoreUnavailableError,
  InvalidGameDataError,
  JsonGameRepository,
} from './repository.js'
import { isLiveGameMode } from './validation.js'

function leaseToken(req: Request): string | undefined {
  const value = req.header('x-game-lease')
  return value?.trim() || undefined
}

function handleError(error: unknown, res: Response): void {
  if (error instanceof GameNotFoundError) {
    res.status(404).json({ error: '对局不存在' })
  } else if (error instanceof GameRevisionConflictError) {
    res.status(409).json({ error: '对局版本冲突', currentRevision: error.currentRevision })
  } else if (error instanceof InvalidGameDataError) {
    res.status(400).json({ error: error.message })
  } else if (error instanceof GameStoreUnavailableError) {
    res.status(503).json({ error: '本地对局存储不可用' })
  } else {
    console.error('Game API error:', error)
    res.status(500).json({ error: '对局存储操作失败' })
  }
}

export function createGameRouter(repository: JsonGameRepository, leases: GameLeaseManager): Router {
  const router = Router()

  router.get('/', (_req, res) => {
    try {
      res.json({ games: repository.list() })
    } catch (error) {
      handleError(error, res)
    }
  })

  router.post('/', async (req, res) => {
    try {
      if (!isLiveGameMode(req.body?.mode)) throw new InvalidGameDataError('Invalid game mode')
      const game = await repository.create({
        name: typeof req.body.name === 'string' ? req.body.name : undefined,
        mode: req.body.mode,
        config: req.body.config,
        state: req.body.state,
      })
      res.status(201).json({ game })
    } catch (error) {
      handleError(error, res)
    }
  })

  router.get('/export', (req, res) => {
    try {
      const ids =
        typeof req.query.ids === 'string' && req.query.ids.trim()
          ? req.query.ids.split(',')
          : undefined
      const payload = repository.export(ids)
      res.setHeader('Content-Disposition', 'attachment; filename="xiangqi-games.json"')
      res.json(payload)
    } catch (error) {
      handleError(error, res)
    }
  })

  router.post('/import', async (req, res) => {
    try {
      const result = await repository.import(req.body)
      res.status(201).json(result)
    } catch (error) {
      handleError(error, res)
    }
  })

  router.get('/:id', (req, res) => {
    try {
      res.json({ game: repository.get(req.params.id) })
    } catch (error) {
      handleError(error, res)
    }
  })

  router.put('/:id/state', async (req, res) => {
    try {
      if (!leases.validates(req.params.id, leaseToken(req))) {
        res.status(423).json({ error: '当前标签页没有对局编辑权' })
        return
      }
      if (!Number.isInteger(req.body?.expectedRevision))
        throw new InvalidGameDataError('Invalid expectedRevision')
      const game = await repository.updateState(
        req.params.id,
        req.body.expectedRevision,
        req.body.state,
      )
      res.json({ game })
    } catch (error) {
      handleError(error, res)
    }
  })

  router.patch('/:id', async (req, res) => {
    try {
      if (leases.hasLease(req.params.id) && !leases.validates(req.params.id, leaseToken(req))) {
        res.status(423).json({ error: '对局正在其他标签页编辑' })
        return
      }
      if (!Number.isInteger(req.body?.expectedRevision) || typeof req.body?.name !== 'string')
        throw new InvalidGameDataError('Invalid metadata update')
      const game = await repository.rename(req.params.id, req.body.expectedRevision, req.body.name)
      res.json({ game })
    } catch (error) {
      handleError(error, res)
    }
  })

  router.delete('/:id', async (req, res) => {
    try {
      if (leases.hasLease(req.params.id) && !leases.validates(req.params.id, leaseToken(req))) {
        res.status(423).json({ error: '对局正在其他标签页编辑' })
        return
      }
      const revision = Number(req.query.revision)
      if (!Number.isInteger(revision)) throw new InvalidGameDataError('Invalid revision')
      await repository.delete(req.params.id, revision)
      res.status(204).end()
    } catch (error) {
      handleError(error, res)
    }
  })

  return router
}
