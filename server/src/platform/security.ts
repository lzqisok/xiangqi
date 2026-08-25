import { randomUUID } from 'node:crypto'
import { BlockList, isIP } from 'node:net'
import type { IncomingMessage } from 'node:http'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { PlatformConfig } from './config.js'

function normalizeAddress(value: string | undefined): string {
  const address = value || 'unknown'
  return address.startsWith('::ffff:') ? address.slice(7) : address
}

export class TrustedProxyPolicy {
  private readonly blockList = new BlockList()

  constructor(readonly cidrs: readonly string[]) {
    for (const entry of cidrs) {
      const [address, rawPrefix] = entry.split('/')
      const type = isIP(address)
      if (!type) throw new Error(`Invalid trusted proxy address: ${entry}`)
      if (rawPrefix === undefined) {
        this.blockList.addAddress(address, type === 4 ? 'ipv4' : 'ipv6')
        continue
      }
      const prefix = Number(rawPrefix)
      const maximum = type === 4 ? 32 : 128
      if (!Number.isInteger(prefix) || prefix < 0 || prefix > maximum) {
        throw new Error(`Invalid trusted proxy prefix: ${entry}`)
      }
      this.blockList.addSubnet(address, prefix, type === 4 ? 'ipv4' : 'ipv6')
    }
  }

  isTrusted(address: string | undefined): boolean {
    const normalized = normalizeAddress(address)
    const type = isIP(normalized)
    return Boolean(type && this.blockList.check(normalized, type === 4 ? 'ipv4' : 'ipv6'))
  }

  clientAddress(request: Request | IncomingMessage): string {
    const remote = normalizeAddress(request.socket.remoteAddress)
    if (!this.isTrusted(remote)) return remote
    const forwarded = request.headers['x-forwarded-for']
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim()
    return first && isIP(normalizeAddress(first)) ? normalizeAddress(first) : remote
  }

  protocol(request: Request | IncomingMessage): 'http' | 'https' {
    const remote = normalizeAddress(request.socket.remoteAddress)
    if (this.isTrusted(remote)) {
      const forwarded = request.headers['x-forwarded-proto']
      const value = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim()
      if (value === 'https') return 'https'
    }
    return 'http'
  }
}

export function requestOriginAllowed(
  request: Request | IncomingMessage,
  config: Pick<PlatformConfig, 'production' | 'allowedOrigins'>,
): boolean {
  const origin = request.headers.origin
  if (!origin) return !config.production
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  if (origin !== parsed.origin) return false
  if (config.allowedOrigins.includes(parsed.origin)) return true
  return (
    parsed.host === request.headers.host && (!config.production || parsed.protocol === 'https:')
  )
}

export function createRequestContext(): RequestHandler {
  return (_request, response, next) => {
    const requestId = randomUUID()
    response.locals.requestId = requestId
    response.setHeader('X-Request-Id', requestId)
    next()
  }
}

export function createSecurityHeaders(config: PlatformConfig): RequestHandler {
  return (request, response, next) => {
    response.removeHeader('X-Powered-By')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('X-Frame-Options', 'DENY')
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
    response.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "object-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: blob:",
        "media-src 'self' data: blob:",
        "worker-src 'self' blob:",
        config.production ? "connect-src 'self' wss:" : "connect-src 'self' ws: wss:",
      ].join('; '),
    )
    if (config.production) {
      response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }
    if (request.path.startsWith('/api/') || request.path.startsWith('/health/')) {
      response.setHeader('Cache-Control', 'no-store')
    }
    next()
  }
}

export function createTransportSecurity(
  config: PlatformConfig,
  proxies: TrustedProxyPolicy,
): RequestHandler {
  return (request, response, next) => {
    if (!config.production || request.path.startsWith('/health/')) return next()
    if (!proxies.isTrusted(request.socket.remoteAddress)) {
      response
        .status(403)
        .json({ error: 'trusted_proxy_required', requestId: response.locals.requestId })
      return
    }
    if (proxies.protocol(request) === 'https') return next()
    const target = new URL(request.originalUrl, config.publicOrigin)
    response.redirect(308, target.toString())
  }
}

export function createCorsAndOriginGuard(config: PlatformConfig): RequestHandler {
  return (request, response, next) => {
    const origin = request.headers.origin
    if (origin && requestOriginAllowed(request, config)) {
      response.setHeader('Access-Control-Allow-Origin', origin)
      response.setHeader('Access-Control-Allow-Credentials', 'true')
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, X-Game-Lease')
      response.setHeader(
        'Access-Control-Allow-Methods',
        'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
      )
      response.appendHeader('Vary', 'Origin')
    }
    if (origin && !requestOriginAllowed(request, config)) {
      response
        .status(403)
        .json({ error: 'origin_not_allowed', requestId: response.locals.requestId })
      return
    }
    if (request.method === 'OPTIONS') {
      response.status(204).end()
      return
    }
    next()
  }
}

export function payloadWithinLimits(value: unknown, maxDepth: number, maxFields: number): boolean {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  const seen = new Set<object>()
  let fields = 0
  while (pending.length) {
    const current = pending.pop()!
    if (!current.value || typeof current.value !== 'object') continue
    if (current.depth > maxDepth) return false
    if (seen.has(current.value)) continue
    seen.add(current.value)
    const entries = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>)
    fields += Array.isArray(current.value)
      ? current.value.length
      : Object.keys(current.value as Record<string, unknown>).length
    if (fields > maxFields) return false
    for (const item of entries) pending.push({ value: item, depth: current.depth + 1 })
  }
  return true
}

export function createPayloadComplexityGuard(config: PlatformConfig): RequestHandler {
  return (request, response, next) => {
    if (request.body === undefined) return next()
    if (!payloadWithinLimits(request.body, config.payloadMaxDepth, config.payloadMaxFields)) {
      response.status(413).json({
        error: 'payload_too_complex',
        requestId: response.locals.requestId,
      })
      return
    }
    next()
  }
}

export function clientIp(request: Request | IncomingMessage, proxies: TrustedProxyPolicy): string {
  return proxies.clientAddress(request)
}

export function jsonErrorHandler(
  error: unknown,
  _request: Request,
  response: Response,
  next: NextFunction,
) {
  if (response.headersSent) return next(error)
  const bodyError = error as { type?: string; status?: number }
  if (bodyError?.type === 'entity.too.large') {
    response.status(413).json({ error: 'payload_too_large', requestId: response.locals.requestId })
    return
  }
  if (bodyError?.type === 'entity.parse.failed') {
    response.status(400).json({ error: 'invalid_json', requestId: response.locals.requestId })
    return
  }
  next(error)
}
