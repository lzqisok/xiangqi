export type PlatformEnvironment = 'development' | 'test' | 'production'
export type PublicOnlineMode = 'off' | 'controlled' | 'open' | 'drain'

export type PlatformConfig = {
  environment: PlatformEnvironment
  production: boolean
  publicOnlineEnabled: boolean
  publicOnlineMode: PublicOnlineMode
  publicOnlineAllowedUserIds: readonly string[]
  registrationEnabled: boolean
  publicOrigin?: string
  allowedOrigins: readonly string[]
  trustedProxyCidrs: readonly string[]
  apiJsonLimit: string
  importJsonLimit: string
  payloadMaxDepth: number
  payloadMaxFields: number
  wsMaxPayloadBytes: number
  gomokuWsMaxPayloadBytes: number
  maxWsPerIp: number
  maxWsPerUser: number
  maxPlayerConnectionsPerUser: number
  maxSpectatorsPerMatch: number
  maxActiveMatchesPerUser: number
  maxMatchmakingQueueEntries: number
  maxEngineProcesses: number
  maxEngineTasks: number
  shutdownGraceMs: number
  httpSuccessLogSampleRate: number
  metricsToken?: string
  versions: {
    deployment: string
    node: string
    pikafish: string
    jieqi: string
    rapfi: string
    weights: string
  }
}

export class PlatformConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlatformConfigError'
  }
}

function integer(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new PlatformConfigError(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

function list(value: string | undefined): string[] {
  return [
    ...new Set(
      (value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ]
}

function boolean(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined || value === '') return fallback
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  throw new PlatformConfigError(`${name} must be true, false, 1, or 0`)
}

function publicOnlineMode(env: NodeJS.ProcessEnv): PublicOnlineMode {
  const value = env.PUBLIC_ONLINE_MODE
  if (value === undefined || value === '') {
    return boolean(env.PUBLIC_ONLINE_ENABLED, false, 'PUBLIC_ONLINE_ENABLED') ? 'open' : 'off'
  }
  if (value === 'off' || value === 'controlled' || value === 'open' || value === 'drain') {
    return value
  }
  throw new PlatformConfigError('PUBLIC_ONLINE_MODE must be off, controlled, open, or drain')
}

function origin(value: string | undefined, name: string): string | undefined {
  if (!value) return undefined
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new PlatformConfigError(`${name} must be an absolute HTTP(S) origin`)
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new PlatformConfigError(`${name} must be an origin without a path, query, or fragment`)
  }
  return parsed.origin
}

function boundedSize(value: string | undefined, fallback: string, name: string): string {
  const result = value || fallback
  if (!/^\d+(?:kb|mb)$/i.test(result)) {
    throw new PlatformConfigError(`${name} must use a bounded kb or mb value`)
  }
  return result.toLowerCase()
}

function ratio(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new PlatformConfigError(`${name} must be a number between 0 and 1`)
  }
  return parsed
}

export function loadPlatformConfig(env: NodeJS.ProcessEnv = process.env): PlatformConfig {
  const environment = (env.NODE_ENV || 'development') as PlatformEnvironment
  if (!['development', 'test', 'production'].includes(environment)) {
    throw new PlatformConfigError('NODE_ENV must be development, test, or production')
  }
  const production = environment === 'production'
  const publicOrigin = origin(env.PUBLIC_ORIGIN, 'PUBLIC_ORIGIN')
  if (production && (!publicOrigin || !publicOrigin.startsWith('https://'))) {
    throw new PlatformConfigError('production requires an HTTPS PUBLIC_ORIGIN')
  }
  const configuredOrigins = list(env.AUTH_ALLOWED_ORIGINS).map((item) => {
    const normalized = origin(item, 'AUTH_ALLOWED_ORIGINS')
    if (!normalized) throw new PlatformConfigError('AUTH_ALLOWED_ORIGINS contains an empty origin')
    return normalized
  })
  const allowedOrigins = [
    ...new Set([...(publicOrigin ? [publicOrigin] : []), ...configuredOrigins]),
  ]
  if (production && allowedOrigins.some((item) => !item.startsWith('https://'))) {
    throw new PlatformConfigError('production allowed origins must use HTTPS')
  }
  const trustedProxyCidrs = list(env.TRUSTED_PROXY_CIDRS)
  if (production && !trustedProxyCidrs.length) {
    throw new PlatformConfigError('production requires explicit TRUSTED_PROXY_CIDRS')
  }

  const requiredVersion = (name: string, fallback: string) => {
    const value = env[name] || fallback
    if (production && (!value || value === 'development')) {
      throw new PlatformConfigError(`production requires ${name}`)
    }
    return value
  }

  const onlineMode = publicOnlineMode(env)
  const allowedOnlineUsers = list(env.PUBLIC_ONLINE_ALLOWED_USER_IDS)
  if (onlineMode === 'controlled' && allowedOnlineUsers.length === 0) {
    throw new PlatformConfigError(
      'controlled PUBLIC_ONLINE_MODE requires PUBLIC_ONLINE_ALLOWED_USER_IDS',
    )
  }

  return {
    environment,
    production,
    publicOnlineEnabled: onlineMode !== 'off',
    publicOnlineMode: onlineMode,
    publicOnlineAllowedUserIds: allowedOnlineUsers,
    registrationEnabled: boolean(
      env.PUBLIC_REGISTRATION_ENABLED,
      true,
      'PUBLIC_REGISTRATION_ENABLED',
    ),
    publicOrigin,
    allowedOrigins,
    trustedProxyCidrs,
    apiJsonLimit: boundedSize(env.API_JSON_LIMIT, '64kb', 'API_JSON_LIMIT'),
    importJsonLimit: boundedSize(env.IMPORT_JSON_LIMIT, '2mb', 'IMPORT_JSON_LIMIT'),
    payloadMaxDepth: integer(env, 'PAYLOAD_MAX_DEPTH', 12, 3, 32),
    payloadMaxFields: integer(env, 'PAYLOAD_MAX_FIELDS', 2_000, 50, 50_000),
    wsMaxPayloadBytes: integer(env, 'WS_MAX_PAYLOAD_BYTES', 128 * 1024, 4_096, 1024 * 1024),
    gomokuWsMaxPayloadBytes: integer(
      env,
      'GOMOKU_WS_MAX_PAYLOAD_BYTES',
      32 * 1024,
      4_096,
      256 * 1024,
    ),
    maxWsPerIp: integer(env, 'MAX_WS_PER_IP', 30, 1, 1_000),
    maxWsPerUser: integer(env, 'MAX_WS_PER_USER', 10, 1, 100),
    maxPlayerConnectionsPerUser: integer(env, 'MAX_PLAYER_CONNECTIONS_PER_USER', 2, 1, 20),
    maxSpectatorsPerMatch: integer(env, 'MAX_SPECTATORS_PER_MATCH', 50, 0, 1_000),
    maxActiveMatchesPerUser: integer(env, 'MAX_ACTIVE_MATCHES_PER_USER', 3, 1, 20),
    maxMatchmakingQueueEntries: integer(env, 'MAX_MATCHMAKING_QUEUE_ENTRIES', 100, 1, 10_000),
    maxEngineProcesses: integer(env, 'MAX_ENGINE_PROCESSES', 6, 1, 64),
    maxEngineTasks: integer(env, 'MAX_ENGINE_TASKS', 4, 1, 128),
    shutdownGraceMs: integer(env, 'SHUTDOWN_GRACE_MS', 10_000, 1_000, 60_000),
    httpSuccessLogSampleRate: ratio(
      env.HTTP_SUCCESS_LOG_SAMPLE_RATE,
      production ? 0.1 : 1,
      'HTTP_SUCCESS_LOG_SAMPLE_RATE',
    ),
    metricsToken: env.METRICS_TOKEN || undefined,
    versions: {
      deployment: requiredVersion('DEPLOYMENT_VERSION', 'development'),
      node: process.version,
      pikafish: requiredVersion('PIKAFISH_VERSION', 'development'),
      jieqi: requiredVersion('JIEQI_ENGINE_VERSION', 'development'),
      rapfi: requiredVersion('RAPFI_VERSION', 'development'),
      weights: requiredVersion('ENGINE_WEIGHTS_VERSION', 'development'),
    },
  }
}
