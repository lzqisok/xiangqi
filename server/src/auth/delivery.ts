import type { AuthTokenDelivery, DeliveredAccountToken } from './types.js'
import { metrics } from '../platform/observability.js'

export class AuthDeliveryConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthDeliveryConfigError'
  }
}

export function createAuthTokenDelivery(
  env: NodeJS.ProcessEnv = process.env,
  production = env.NODE_ENV === 'production',
  send: typeof fetch = fetch,
): AuthTokenDelivery {
  const rawUrl = env.AUTH_DELIVERY_WEBHOOK_URL
  const token = env.AUTH_DELIVERY_WEBHOOK_TOKEN
  if (!rawUrl) {
    if (production)
      throw new AuthDeliveryConfigError('production requires AUTH_DELIVERY_WEBHOOK_URL')
    return { deliver: async () => undefined }
  }
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new AuthDeliveryConfigError('AUTH_DELIVERY_WEBHOOK_URL must be an absolute URL')
  }
  if (production && url.protocol !== 'https:') {
    throw new AuthDeliveryConfigError('production auth delivery webhook must use HTTPS')
  }
  if (production && !token) {
    throw new AuthDeliveryConfigError('production requires AUTH_DELIVERY_WEBHOOK_TOKEN')
  }

  return {
    async deliver(message: DeliveredAccountToken): Promise<void> {
      try {
        const response = await send(url, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(5_000),
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            purpose: message.purpose,
            email: message.email,
            token: message.token,
            expiresAt: message.expiresAt.toISOString(),
          }),
        })
        if (!response.ok) throw new Error('auth_delivery_failed')
        metrics.increment('xiangqi_auth_delivery', { purpose: message.purpose, result: 'success' })
      } catch (error) {
        metrics.increment('xiangqi_auth_delivery', { purpose: message.purpose, result: 'failure' })
        throw error
      }
    },
  }
}
