import { createHash } from 'node:crypto'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { Database, Queryable } from '../db/database.js'
import type { PublicActor } from '../auth/types.js'
import { metrics } from './observability.js'

export type RateLimitRule = {
  scope: string
  key: string
  limit: number
  windowMs: number
}

export class RateLimitExceededError extends Error {
  constructor(
    readonly scope: string,
    readonly retryAfterSeconds: number,
  ) {
    super('rate_limited')
    this.name = 'RateLimitExceededError'
  }
}

function bucketHash(scope: string, key: string, windowStartedAt: number): Buffer {
  return createHash('sha256').update(`${scope}\0${key}\0${windowStartedAt}`).digest()
}

export class MySqlRateLimitStore {
  private cleanupCounter = 0

  constructor(private readonly database: Database) {}

  async consume(rules: readonly RateLimitRule[], now = new Date()): Promise<void> {
    if (!rules.length) return
    await this.database.transaction(async (client) => {
      for (const rule of rules) await this.consumeRule(client, rule, now)
    })
    this.cleanupCounter += 1
    if (this.cleanupCounter >= 1_000) {
      this.cleanupCounter = 0
      void this.database
        .query('DELETE FROM rate_limit_buckets WHERE expires_at < CURRENT_TIMESTAMP(6) LIMIT 1000')
        .catch(() => undefined)
    }
  }

  private async consumeRule(client: Queryable, rule: RateLimitRule, now: Date) {
    const windowStartedAt = Math.floor(now.getTime() / rule.windowMs) * rule.windowMs
    const expiresAt = windowStartedAt + rule.windowMs
    const hash = bucketHash(rule.scope, rule.key, windowStartedAt)
    await client.query(
      `INSERT INTO rate_limit_buckets
        (bucket_hash, scope, window_started_at, expires_at, request_count)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE request_count = request_count + 1`,
      [hash, rule.scope, new Date(windowStartedAt), new Date(expiresAt)],
    )
    const result = await client.query<{ request_count: number | string }>(
      'SELECT request_count FROM rate_limit_buckets WHERE bucket_hash = ? FOR UPDATE',
      [hash],
    )
    if (Number(result.rows[0]?.request_count) > rule.limit) {
      metrics.increment('xiangqi_rate_limit_rejected', { scope: rule.scope })
      throw new RateLimitExceededError(
        rule.scope,
        Math.max(1, Math.ceil((expiresAt - now.getTime()) / 1_000)),
      )
    }
  }
}

type RateRequest = Request & { rateActor?: PublicActor }

function routeRules(
  request: RateRequest,
  response: Response,
  clientAddress: string,
): RateLimitRule[] {
  const actor = (response.locals.auth as { actor?: PublicActor } | undefined)?.actor
  const userId = actor?.kind === 'user' ? actor.userId : undefined
  const sessionId = actor?.kind === 'user' ? actor.sessionId : undefined
  const resource =
    /^\/api\/online\/matches\/([^/?]+)/.exec(request.originalUrl)?.[1] ||
    /^\/api\/online\/invites\/([^/?]+)/.exec(request.originalUrl)?.[1]
  const dimensions = (
    scope: string,
    limit: number,
    windowMs: number,
    includeResource = false,
  ): RateLimitRule[] => [
    { scope: `${scope}_ip`, key: clientAddress, limit, windowMs },
    ...(userId ? [{ scope: `${scope}_user`, key: userId, limit, windowMs }] : []),
    ...(sessionId ? [{ scope: `${scope}_session`, key: sessionId, limit, windowMs }] : []),
    ...(includeResource && resource
      ? [{ scope: `${scope}_resource`, key: resource, limit: limit * 3, windowMs }]
      : []),
  ]
  const path = new URL(request.originalUrl, 'http://localhost').pathname
  if (request.method === 'POST' && path === '/api/auth/register')
    return dimensions('register', 5, 60_000)
  if (request.method === 'POST' && path === '/api/auth/login')
    return dimensions('login', 10, 60_000)
  if (request.method === 'POST' && path.includes('/password/reset'))
    return dimensions('recovery', 5, 60 * 60_000)
  if (request.method === 'POST' && path === '/api/account/recover')
    return dimensions('account_recovery', 5, 60 * 60_000)
  if (request.method === 'POST' && path === '/api/online/matches')
    return dimensions('match_create', 10, 60_000)
  if (path === '/api/online/quick-match') return dimensions('quick_match', 30, 60_000)
  if (request.method === 'POST' && path.endsWith('/invites'))
    return dimensions('invite_create', 20, 60_000, true)
  if (request.method === 'POST' && path.endsWith('/join') && path.includes('/invites/'))
    return dimensions('invite_join', 20, 60_000, true)
  if (request.method === 'GET' && /^\/api\/online\/matches\/[^/]+$/.test(path))
    return dimensions('match_read', 60, 60_000, true)
  if (request.method === 'GET' && path === '/api/online/lobby')
    return dimensions('lobby_read', 60, 60_000)
  if (request.method === 'GET' && path === '/api/me/matches')
    return dimensions('history_read', 60, 60_000)
  return []
}

export function createPersistentRateLimitMiddleware(
  store: MySqlRateLimitStore,
  clientAddress: (request: Request) => string,
): RequestHandler {
  return async (request, response, next) => {
    try {
      await store.consume(routeRules(request, response, clientAddress(request)))
      next()
    } catch (error) {
      if (!(error instanceof RateLimitExceededError)) return next(error)
      response.setHeader('Retry-After', error.retryAfterSeconds)
      response.status(429).json({
        error: 'rate_limited',
        retryAfter: error.retryAfterSeconds,
        requestId: response.locals.requestId,
      })
    }
  }
}

export function chatRateRules(input: {
  ip: string
  userId: string
  matchId: string
}): RateLimitRule[] {
  return [
    { scope: 'chat_ip', key: input.ip, limit: 20, windowMs: 10_000 },
    { scope: 'chat_user', key: input.userId, limit: 8, windowMs: 10_000 },
    { scope: 'chat_match', key: input.matchId, limit: 30, windowMs: 10_000 },
  ]
}

export function rateLimitErrorMiddleware(
  error: unknown,
  _request: Request,
  response: Response,
  next: NextFunction,
) {
  if (!(error instanceof RateLimitExceededError)) return next(error)
  response.setHeader('Retry-After', error.retryAfterSeconds)
  response.status(429).json({
    error: 'rate_limited',
    retryAfter: error.retryAfterSeconds,
    requestId: response.locals.requestId,
  })
}
