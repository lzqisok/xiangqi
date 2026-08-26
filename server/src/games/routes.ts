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
import { structuredLog } from '../platform/observability.js'
import { MySqlGameRepository } from './mysqlRepository.js'

function leaseToken(req: Request): string | undefined {
  const value = req.header('x-game-lease')
  return value?.trim() || undefined
}

function clientMutationId(req: Request): string | undefined {
  const value = req.header('x-client-mutation-id')
  return value?.trim() || undefined
}

export type GameRouterOptions = {
  cloudRepository?: MySqlGameRepository
  currentUserId?: (response: Response) => string | null
  requireCsrf?: (request: Request, response: Response) => void
}

function handleError(error: unknown, res: Response): void {
  if ((error as { status?: number }).status === 403) {
    res.status(403).json({ error: error instanceof Error ? error.message : 'account_read_only' })
  } else if (error instanceof GameNotFoundError) {
    res.status(404).json({ error: '对局不存在' })
  } else if (error instanceof GameRevisionConflictError) {
    res.status(409).json({ error: '对局版本冲突', currentRevision: error.currentRevision })
  } else if (error instanceof InvalidGameDataError) {
    res.status(400).json({ error: error.message })
  } else if (error instanceof GameStoreUnavailableError) {
    res.status(503).json({ error: '本地对局存储不可用' })
  } else {
    structuredLog('error', 'game_api_failed', {
      requestId: res.locals.requestId,
      errorCode: error instanceof Error ? error.name : 'unknown',
    })
    res.status(500).json({ error: '对局存储操作失败', requestId: res.locals.requestId })
  }
}

export function createGameRouter(
  repository: JsonGameRepository,
  leases: GameLeaseManager,
  options: GameRouterOptions = {},
): Router {
  const router = Router()
  const userId = (response: Response) => options.currentUserId?.(response) || null
  const scope = (response: Response) => {
    const current = userId(response)
    return current ? `user:${current}` : 'local'
  }
  const requireMutation = (request: Request, response: Response): string | null => {
    const current = userId(response)
    if (!current) return null
    options.requireCsrf?.(request, response)
    if (!clientMutationId(request)) throw new InvalidGameDataError('clientMutationId 必填')
    return current
  }

  router.get('/', async (_req, res) => {
    try {
      const current = userId(res)
      res.json({
        games:
          current && options.cloudRepository
            ? await options.cloudRepository.list(current)
            : repository.list(),
        storage: current && options.cloudRepository ? 'cloud' : 'device',
      })
    } catch (error) {
      handleError(error, res)
    }
  })

  router.post('/', async (req, res) => {
    try {
      if (!isLiveGameMode(req.body?.mode)) throw new InvalidGameDataError('Invalid game mode')
      const current = requireMutation(req, res)
      const input = {
        name: typeof req.body.name === 'string' ? req.body.name : undefined,
        mode: req.body.mode,
        config: req.body.config,
        state: req.body.state,
        clientMutationId: clientMutationId(req),
      }
      const game =
        current && options.cloudRepository
          ? await options.cloudRepository.create(current, input)
          : await repository.create(input)
      res.status(201).json({ game })
    } catch (error) {
      handleError(error, res)
    }
  })

  router.get('/export', async (req, res) => {
    try {
      const ids =
        typeof req.query.ids === 'string' && req.query.ids.trim()
          ? req.query.ids.split(',')
          : undefined
      const current = userId(res)
      const payload =
        current && options.cloudRepository
          ? await options.cloudRepository.export(current, ids)
          : repository.export(ids)
      res.setHeader('Content-Disposition', 'attachment; filename="xiangqi-games.json"')
      res.json(payload)
    } catch (error) {
      handleError(error, res)
    }
  })

  router.post('/import', async (req, res) => {
    try {
      const current = requireMutation(req, res)
      const result =
        current && options.cloudRepository
          ? await options.cloudRepository.import(current, req.body, clientMutationId(req)!)
          : await repository.import(req.body)
      res.status(201).json(result)
    } catch (error) {
      handleError(error, res)
    }
  })

  router.get('/:id', async (req, res) => {
    try {
      const current = userId(res)
      res.json({
        game:
          current && options.cloudRepository
            ? await options.cloudRepository.get(current, req.params.id)
            : repository.get(req.params.id),
      })
    } catch (error) {
      handleError(error, res)
    }
  })

  router.put('/:id/state', async (req, res) => {
    try {
      const current = requireMutation(req, res)
      if (!leases.validates(req.params.id, leaseToken(req), scope(res))) {
        res.status(423).json({ error: '当前标签页没有对局编辑权' })
        return
      }
      if (!Number.isInteger(req.body?.expectedRevision))
        throw new InvalidGameDataError('Invalid expectedRevision')
      const game =
        current && options.cloudRepository
          ? await options.cloudRepository.updateState(
              current,
              req.params.id,
              req.body.expectedRevision,
              req.body.state,
              clientMutationId(req)!,
            )
          : await repository.updateState(req.params.id, req.body.expectedRevision, req.body.state)
      res.json({ game })
    } catch (error) {
      handleError(error, res)
    }
  })

  router.patch('/:id', async (req, res) => {
    try {
      const current = requireMutation(req, res)
      if (
        leases.hasLease(req.params.id, scope(res)) &&
        !leases.validates(req.params.id, leaseToken(req), scope(res))
      ) {
        res.status(423).json({ error: '对局正在其他标签页编辑' })
        return
      }
      if (!Number.isInteger(req.body?.expectedRevision) || typeof req.body?.name !== 'string')
        throw new InvalidGameDataError('Invalid metadata update')
      const game =
        current && options.cloudRepository
          ? await options.cloudRepository.rename(
              current,
              req.params.id,
              req.body.expectedRevision,
              req.body.name,
              clientMutationId(req)!,
            )
          : await repository.rename(req.params.id, req.body.expectedRevision, req.body.name)
      res.json({ game })
    } catch (error) {
      handleError(error, res)
    }
  })

  router.delete('/:id', async (req, res) => {
    try {
      const current = requireMutation(req, res)
      if (
        leases.hasLease(req.params.id, scope(res)) &&
        !leases.validates(req.params.id, leaseToken(req), scope(res))
      ) {
        res.status(423).json({ error: '对局正在其他标签页编辑' })
        return
      }
      const revision = Number(req.query.revision)
      if (!Number.isInteger(revision)) throw new InvalidGameDataError('Invalid revision')
      if (current && options.cloudRepository) {
        await options.cloudRepository.delete(
          current,
          req.params.id,
          revision,
          clientMutationId(req)!,
        )
      } else {
        await repository.delete(req.params.id, revision)
      }
      res.status(204).end()
    } catch (error) {
      handleError(error, res)
    }
  })

  return router
}
