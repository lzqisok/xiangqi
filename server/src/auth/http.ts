import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import {
  Router,
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express'
import type { WebSocket } from 'ws'
import { MySqlAccountRepository } from '../repositories/mysql.js'
import type { Database } from '../db/database.js'
import { DatabaseUnavailableError, RepositoryError } from '../db/errors.js'
import { MySqlAuthRepository } from './repository.js'
import { AuthError, AuthService } from './service.js'
import { createOpaqueToken, parseCookies, serializeCookie } from './security.js'
import type { AuthSession, AuthTokenDelivery, PublicActor, UserActor } from './types.js'

export const SESSION_COOKIE = '__Host-xiangqi_session'
export const DEVELOPMENT_SESSION_COOKIE = 'xiangqi_session'
export const CSRF_COOKIE = 'xiangqi_csrf'
export const DEVICE_COOKIE = 'xiangqi_device'

type RequestAuth = { actor: PublicActor; session?: AuthSession }

export type AuthRuntimeOptions = {
  production: boolean
  exposeDevelopmentTokens: boolean
  allowedOrigins?: readonly string[]
}

function asyncRoute(
  route: (request: Request, response: Response, next: NextFunction) => Promise<void>,
) {
  return (request: Request, response: Response, next: NextFunction) => {
    void route(request, response, next).catch(next)
  }
}

function requestIp(request: Request | IncomingMessage): string {
  return request.socket.remoteAddress || 'unknown'
}

function cookieName(production: boolean): string {
  return production ? SESSION_COOKIE : DEVELOPMENT_SESSION_COOKIE
}

export function originAllowed(
  request: Request | IncomingMessage,
  options: AuthRuntimeOptions,
): boolean {
  const origin = request.headers.origin
  if (!origin) return !options.production
  try {
    const parsed = new URL(origin)
    if (options.allowedOrigins?.includes(parsed.origin)) return true
    return (
      parsed.host === request.headers.host && (!options.production || parsed.protocol === 'https:')
    )
  } catch {
    return false
  }
}

function publicAccount(account: Awaited<ReturnType<AuthService['profile']>>) {
  return {
    id: account.id,
    status: account.status,
    authEpoch: account.authEpoch,
    displayName: account.displayName,
    locale: account.locale,
    email: account.emailDisplay,
    emailVerified: Boolean(account.verifiedAt),
    createdAt: account.createdAt,
  }
}

function authLocals(response: Response): RequestAuth {
  return response.locals.auth as RequestAuth
}

function requireUser(response: Response): UserActor {
  const actor = authLocals(response).actor
  if (actor.kind !== 'user') throw new AuthError('authentication_required', 401)
  return actor
}

export type AuthRuntime = {
  service: AuthService
  router: Router
  accountRouter: Router
  meRouter: Router
  actorMiddleware: RequestHandler
  errorMiddleware: ErrorRequestHandler
  authenticateUpgrade(request: IncomingMessage): Promise<UserActor | null>
  bindSocket(actor: UserActor, socket: WebSocket): void
}

export function createAuthRuntime(
  database: Database,
  delivery: AuthTokenDelivery,
  options: AuthRuntimeOptions,
): AuthRuntime {
  const service = new AuthService(
    new MySqlAccountRepository(database),
    new MySqlAuthRepository(database),
    delivery,
  )
  const router = Router()
  const accountRouter = Router()

  const authenticateRequest = async (request: Request | IncomingMessage): Promise<RequestAuth> => {
    const cookies = parseCookies(request.headers.cookie)
    return service.authenticate(
      cookies.get(cookieName(options.production)),
      randomUUID(),
      requestIp(request),
    )
  }

  const actorMiddleware = asyncRoute(async (request, response, next) => {
    response.locals.auth = await authenticateRequest(request)
    response.setHeader('X-Request-Id', authLocals(response).actor.requestId)
    next()
  })

  const requireOrigin = (request: Request) => {
    if (!originAllowed(request, options)) throw new AuthError('origin_not_allowed', 403)
  }

  const requireCsrf = (request: Request, response: Response): UserActor => {
    requireOrigin(request)
    const actor = requireUser(response)
    const session = authLocals(response).session
    const cookies = parseCookies(request.headers.cookie)
    const header = request.header('x-csrf-token')
    const cookie = cookies.get(CSRF_COOKIE)
    if (!session || !header || header !== cookie || !service.csrfValid(session, header)) {
      throw new AuthError('csrf_rejected', 403)
    }
    return actor
  }

  const appendSessionCookies = (response: Response, sessionToken: string, csrfToken: string) => {
    response.append(
      'Set-Cookie',
      serializeCookie(cookieName(options.production), sessionToken, {
        httpOnly: true,
        secure: options.production,
        maxAgeSeconds: 30 * 86_400,
      }),
    )
    response.append(
      'Set-Cookie',
      serializeCookie(CSRF_COOKIE, csrfToken, {
        secure: options.production,
        maxAgeSeconds: 30 * 86_400,
      }),
    )
  }

  const clearSessionCookies = (response: Response) => {
    response.append(
      'Set-Cookie',
      serializeCookie(cookieName(options.production), '', {
        httpOnly: true,
        secure: options.production,
        maxAgeSeconds: 0,
      }),
    )
    response.append(
      'Set-Cookie',
      serializeCookie(CSRF_COOKIE, '', { secure: options.production, maxAgeSeconds: 0 }),
    )
  }

  router.post(
    '/register',
    asyncRoute(async (request, response) => {
      requireOrigin(request)
      const result = await service.register({
        email: request.body?.email,
        password: request.body?.password,
        displayName: request.body?.displayName,
        ipKey: requestIp(request),
        userAgent: request.header('user-agent'),
      })
      response.status(202).json({
        accepted: true,
        ...(options.exposeDevelopmentTokens && result.developmentToken
          ? { developmentToken: result.developmentToken }
          : {}),
      })
    }),
  )

  router.post(
    '/login',
    asyncRoute(async (request, response) => {
      requireOrigin(request)
      const cookies = parseCookies(request.headers.cookie)
      let deviceKey = cookies.get(DEVICE_COOKIE)
      if (!deviceKey) {
        deviceKey = createOpaqueToken(16)
        response.append(
          'Set-Cookie',
          serializeCookie(DEVICE_COOKIE, deviceKey, {
            httpOnly: true,
            secure: options.production,
            maxAgeSeconds: 365 * 86_400,
          }),
        )
      }
      const credentials = await service.login({
        email: request.body?.email,
        password: request.body?.password,
        ipKey: requestIp(request),
        deviceKey,
        deviceLabel: request.body?.deviceLabel,
        userAgent: request.header('user-agent'),
      })
      appendSessionCookies(response, credentials.sessionToken, credentials.csrfToken)
      const account = await service.profile({
        kind: 'user',
        requestId: authLocals(response).actor.requestId,
        ipKey: requestIp(request),
        userId: credentials.session.userId,
        sessionId: credentials.session.id,
        authEpoch: credentials.session.authEpoch,
        expiresAt: new Date(
          Math.min(
            credentials.session.idleExpiresAt.getTime(),
            credentials.session.absoluteExpiresAt.getTime(),
          ),
        ),
        status: credentials.session.accountStatus as UserActor['status'],
        capabilities: [],
      })
      response.json({ user: publicAccount(account), csrfToken: credentials.csrfToken })
    }),
  )

  router.post(
    '/logout',
    asyncRoute(async (request, response) => {
      const actor = requireCsrf(request, response)
      await service.logout(actor)
      clearSessionCookies(response)
      response.status(204).end()
    }),
  )

  router.get(
    '/session',
    asyncRoute(async (_request, response) => {
      const actor = authLocals(response).actor
      if (actor.kind === 'anonymous') {
        response.json({ authenticated: false })
        return
      }
      response.json({ authenticated: true, user: publicAccount(await service.profile(actor)) })
    }),
  )

  router.get(
    '/csrf',
    asyncRoute(async (_request, response) => {
      const actor = requireUser(response)
      const token = await service.rotateCsrf(actor)
      response.append(
        'Set-Cookie',
        serializeCookie(CSRF_COOKIE, token, {
          secure: options.production,
          maxAgeSeconds: 30 * 86_400,
        }),
      )
      response.json({ csrfToken: token })
    }),
  )

  router.post(
    '/verify-email',
    asyncRoute(async (request, response) => {
      requireOrigin(request)
      if (!(await service.verifyEmail(request.body?.token)))
        throw new AuthError('invalid_token', 400)
      response.json({ verified: true })
    }),
  )

  router.post(
    '/verification/resend',
    asyncRoute(async (request, response) => {
      const actor = requireCsrf(request, response)
      const token = await service.resendVerification(actor)
      response.status(202).json({
        accepted: true,
        ...(options.exposeDevelopmentTokens ? { developmentToken: token } : {}),
      })
    }),
  )

  router.post(
    '/password/reset-request',
    asyncRoute(async (request, response) => {
      requireOrigin(request)
      const token = await service.requestPasswordReset(request.body?.email)
      response.status(202).json({
        accepted: true,
        ...(options.exposeDevelopmentTokens && token ? { developmentToken: token } : {}),
      })
    }),
  )

  router.post(
    '/password/reset',
    asyncRoute(async (request, response) => {
      requireOrigin(request)
      if (!(await service.resetPassword(request.body?.token, request.body?.password))) {
        throw new AuthError('invalid_token', 400)
      }
      response.json({ reset: true })
    }),
  )

  accountRouter.post(
    '/recover',
    asyncRoute(async (request, response) => {
      requireOrigin(request)
      if (!(await service.recoverDeletion(request.body?.token))) {
        throw new AuthError('invalid_token', 400)
      }
      response.json({ recovered: true })
    }),
  )

  const meRouter = Router()
  meRouter.get(
    '/',
    asyncRoute(async (_request, response) => {
      response.json({ user: publicAccount(await service.profile(requireUser(response))) })
    }),
  )
  meRouter.patch(
    '/profile',
    asyncRoute(async (request, response) => {
      const actor = requireCsrf(request, response)
      response.json({
        user: publicAccount(await service.updateProfile(actor, request.body?.displayName)),
      })
    }),
  )
  meRouter.get(
    '/sessions',
    asyncRoute(async (_request, response) => {
      response.json({ sessions: await service.listSessions(requireUser(response)) })
    }),
  )
  meRouter.delete(
    '/sessions/:id',
    asyncRoute(async (request, response) => {
      const actor = requireCsrf(request, response)
      const sessionId = String(request.params.id)
      if (!(await service.revokeSession(actor, sessionId))) throw new AuthError('not_found', 404)
      if (sessionId === actor.sessionId) clearSessionCookies(response)
      response.status(204).end()
    }),
  )
  meRouter.post(
    '/password',
    asyncRoute(async (request, response) => {
      const actor = requireCsrf(request, response)
      await service.changePassword(actor, request.body?.currentPassword, request.body?.newPassword)
      response.status(204).end()
    }),
  )
  meRouter.post(
    '/deletion',
    asyncRoute(async (request, response) => {
      const actor = requireCsrf(request, response)
      const token = await service.beginDeletion(actor, request.body?.currentPassword)
      clearSessionCookies(response)
      response.status(202).json({
        accepted: true,
        ...(options.exposeDevelopmentTokens ? { developmentToken: token } : {}),
      })
    }),
  )

  const errorMiddleware = (
    error: unknown,
    _request: Request,
    response: Response,
    next: NextFunction,
  ) => {
    if (response.headersSent) return next(error)
    if (error instanceof AuthError) {
      const [code, retryAfter] = error.code.split(':')
      if (retryAfter) response.setHeader('Retry-After', retryAfter)
      response.status(error.status).json({ error: code })
      return
    }
    const validationCode = error instanceof Error && error.message.startsWith('invalid_')
    if (validationCode) {
      response.status(400).json({ error: error.message })
      return
    }
    if (error instanceof DatabaseUnavailableError) {
      response.status(503).json({ error: error.code })
      return
    }
    if (error instanceof RepositoryError) {
      const status = error.code === 'not_found' ? 404 : error.code.endsWith('_conflict') ? 409 : 500
      response.status(status).json({ error: status === 500 ? 'internal_error' : error.code })
      return
    }
    next(error)
  }

  return {
    service,
    router,
    accountRouter,
    meRouter,
    actorMiddleware,
    errorMiddleware,
    async authenticateUpgrade(request: IncomingMessage): Promise<UserActor | null> {
      if (!originAllowed(request, options)) return null
      const auth = await authenticateRequest(request)
      return auth.actor.kind === 'user' ? auth.actor : null
    },
    bindSocket(actor: UserActor, socket: WebSocket): void {
      service.connections.bind(actor.sessionId, socket)
      const remaining = Math.max(0, actor.expiresAt.getTime() - Date.now())
      const timeout = setTimeout(() => socket.close(1008, 'Session expired'), remaining)
      timeout.unref()
      socket.once('close', () => clearTimeout(timeout))
    },
  }
}
