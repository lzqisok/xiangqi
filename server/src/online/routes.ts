import {
  Router,
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response,
} from 'express'
import type { UserActor } from '../auth/types.js'
import { RepositoryError } from '../db/errors.js'
import { onlineMatchSummary } from './repository.js'
import { OnlineMatchError, OnlineMatchService } from './service.js'

type Authorize = {
  requireUser(response: Response): UserActor
  requireCsrf(request: Request, response: Response): UserActor
}

export type OnlineRouters = {
  router: Router
  meMatchesRouter: Router
  errorMiddleware: ErrorRequestHandler
}

function asyncRoute(
  route: (request: Request, response: Response, next: NextFunction) => Promise<void>,
) {
  return (request: Request, response: Response, next: NextFunction) => {
    void route(request, response, next).catch(next)
  }
}

export function createOnlineRouters(
  service: OnlineMatchService,
  authorize: Authorize,
): OnlineRouters {
  const router = Router()
  const meMatchesRouter = Router()

  router.get(
    '/lobby',
    asyncRoute(async (request, response) => {
      const actor = authorize.requireUser(response)
      response.json({
        matches: await service.safe(() =>
          service.lobby(actor, { variant: request.query.variant, limit: request.query.limit }),
        ),
      })
    }),
  )

  router.post(
    '/matches',
    asyncRoute(async (request, response) => {
      const actor = authorize.requireCsrf(request, response)
      const record = await service.safe(() => service.create(actor, request.body || {}))
      response.status(201).json({
        match: service.snapshot(record, actor.userId, new Set()),
      })
    }),
  )

  router.post(
    '/quick-match',
    asyncRoute(async (request, response) => {
      const actor = authorize.requireCsrf(request, response)
      const result = await service.safe(() => service.quickMatch(actor, request.body || {}))
      response.status(result.created ? 201 : 200).json({
        created: result.created,
        match: service.snapshot(result.record, actor.userId, new Set()),
      })
    }),
  )

  router.delete(
    '/quick-match',
    asyncRoute(async (request, response) => {
      const actor = authorize.requireCsrf(request, response)
      response.json(await service.safe(() => service.cancelMatchmaking(actor)))
    }),
  )

  router.get(
    '/matches/:id',
    asyncRoute(async (request, response) => {
      const actor = authorize.requireUser(response)
      const record = await service.safe(() => service.get(actor, String(request.params.id)))
      response.json({ match: service.snapshot(record, actor.userId, new Set()) })
    }),
  )

  router.post(
    '/matches/:id/invites',
    asyncRoute(async (request, response) => {
      const actor = authorize.requireCsrf(request, response)
      const invite = await service.safe(() =>
        service.createInvite(actor, String(request.params.id), request.body?.side),
      )
      response.status(201).json({
        token: invite.token,
        expiresAt: invite.expiresAt.toISOString(),
      })
    }),
  )

  router.post(
    '/matches/:id/join',
    asyncRoute(async (request, response) => {
      const actor = authorize.requireCsrf(request, response)
      const record = await service.safe(() =>
        service.joinPublic(actor, String(request.params.id), request.body?.side),
      )
      response.json({ match: service.snapshot(record, actor.userId, new Set()) })
    }),
  )

  router.get(
    '/invites/:token',
    asyncRoute(async (request, response) => {
      authorize.requireUser(response)
      const preview = await service.safe(() => service.previewInvite(String(request.params.token)))
      response.json({
        match: onlineMatchSummary(preview.record),
        allowedSide: preview.allowedSide,
      })
    }),
  )

  router.post(
    '/invites/:token/join',
    asyncRoute(async (request, response) => {
      const actor = authorize.requireCsrf(request, response)
      const record = await service.safe(() =>
        service.joinInvite(actor, String(request.params.token), request.body?.side),
      )
      response.json({ match: service.snapshot(record, actor.userId, new Set()) })
    }),
  )

  router.post(
    '/matches/:id/rematch',
    asyncRoute(async (request, response) => {
      const actor = authorize.requireCsrf(request, response)
      const record = await service.safe(() => service.rematch(actor, String(request.params.id)))
      response.status(201).json({ match: service.snapshot(record, actor.userId, new Set()) })
    }),
  )

  meMatchesRouter.get(
    '/',
    asyncRoute(async (request, response) => {
      const actor = authorize.requireUser(response)
      response.json(
        await service.safe(() =>
          service.history(actor, {
            variant: request.query.variant,
            status: request.query.status,
            from: request.query.from,
            to: request.query.to,
            cursor: request.query.cursor,
            limit: request.query.limit,
          }),
        ),
      )
    }),
  )

  const errorMiddleware: ErrorRequestHandler = (error, _request, response, next) => {
    if (response.headersSent) return next(error)
    if (error instanceof OnlineMatchError) {
      response.status(error.status).json({
        error: error.code,
        ...(error.code === 'revision_conflict' && error.message
          ? { currentRevision: Number(error.message) }
          : {}),
      })
      return
    }
    if (error instanceof RepositoryError) {
      const status = error.code === 'not_found' ? 404 : error.code.endsWith('_conflict') ? 409 : 503
      response.status(status).json({ error: error.code })
      return
    }
    if (error instanceof Error) {
      response.status(400).json({ error: 'invalid_match_operation', message: error.message })
      return
    }
    next(error)
  }

  return { router, meMatchesRouter, errorMiddleware }
}
