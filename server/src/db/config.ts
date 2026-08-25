export type AppEnvironment = 'development' | 'test' | 'production'
export type DatabaseSslMode = 'disable' | 'require'

export type DatabaseConfig = {
  enabled: boolean
  environment: AppEnvironment
  connectionString?: string
  databaseName?: string
  poolMax: number
  connectionTimeoutMs: number
  queryTimeoutMs: number
  statementTimeoutMs: number
  sslMode: DatabaseSslMode
}

export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DatabaseConfigError'
  }
}

function oneOf<T extends string>(
  value: string | undefined,
  values: readonly T[],
  label: string,
): T {
  if (value && values.includes(value as T)) return value as T
  throw new DatabaseConfigError(`${label} must be one of: ${values.join(', ')}`)
}

function integer(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new DatabaseConfigError(`${label} must be an integer between ${minimum} and ${maximum}`)
  }
  return parsed
}

function boolean(value: string | undefined, fallback: boolean, label: string): boolean {
  if (value === undefined || value === '') return fallback
  if (value === '1' || value === 'true') return true
  if (value === '0' || value === 'false') return false
  throw new DatabaseConfigError(`${label} must be true, false, 1, or 0`)
}

function assertSafeTestDatabase(url: URL, databaseName: string): void {
  const host = url.hostname.toLowerCase()
  const safeHost = host === 'localhost' || host === '127.0.0.1' || host === '::1'
  if (!safeHost || !databaseName.toLowerCase().includes('test')) {
    throw new DatabaseConfigError(
      'test database must use a loopback host and a database name containing "test"',
    )
  }
}

export function loadDatabaseConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<DatabaseConfig> = {},
): DatabaseConfig {
  const environment =
    overrides.environment ??
    oneOf(env.NODE_ENV || 'development', ['development', 'test', 'production'] as const, 'NODE_ENV')
  const enabled =
    overrides.enabled ?? boolean(env.ONLINE_DATABASE_ENABLED, false, 'ONLINE_DATABASE_ENABLED')
  const connectionString = overrides.connectionString ?? env.DATABASE_URL
  let parsed: URL | undefined
  let databaseName = overrides.databaseName
  if (connectionString) {
    try {
      parsed = new URL(connectionString)
    } catch {
      throw new DatabaseConfigError('DATABASE_URL must be a valid MySQL URL')
    }
    if (parsed.protocol !== 'mysql:') {
      throw new DatabaseConfigError('DATABASE_URL must use mysql://')
    }
    databaseName ??= decodeURIComponent(parsed.pathname.slice(1))
    if (!parsed.username || !parsed.hostname || !databaseName || databaseName.includes('/')) {
      throw new DatabaseConfigError('DATABASE_URL must include username, host, and database')
    }
  }
  if (enabled && !parsed) {
    throw new DatabaseConfigError('DATABASE_URL is required when the online database is enabled')
  }

  const sslMode =
    overrides.sslMode ??
    oneOf(
      env.DATABASE_SSL_MODE || (environment === 'production' ? 'require' : 'disable'),
      ['disable', 'require'] as const,
      'DATABASE_SSL_MODE',
    )
  if (environment === 'production' && enabled && sslMode !== 'require') {
    throw new DatabaseConfigError('production database connections must require TLS')
  }
  if (environment === 'production' && parsed) {
    const host = parsed.hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      throw new DatabaseConfigError('production database cannot use a loopback host')
    }
  }
  if (environment === 'test' && enabled && parsed && databaseName) {
    assertSafeTestDatabase(parsed, databaseName)
  }

  return {
    enabled,
    environment,
    connectionString,
    databaseName,
    poolMax: overrides.poolMax ?? integer(env.DATABASE_POOL_MAX, 10, 1, 50, 'DATABASE_POOL_MAX'),
    connectionTimeoutMs:
      overrides.connectionTimeoutMs ??
      integer(
        env.DATABASE_CONNECTION_TIMEOUT_MS,
        5_000,
        100,
        60_000,
        'DATABASE_CONNECTION_TIMEOUT_MS',
      ),
    queryTimeoutMs:
      overrides.queryTimeoutMs ??
      integer(env.DATABASE_QUERY_TIMEOUT_MS, 10_000, 100, 120_000, 'DATABASE_QUERY_TIMEOUT_MS'),
    statementTimeoutMs:
      overrides.statementTimeoutMs ??
      integer(
        env.DATABASE_STATEMENT_TIMEOUT_MS,
        8_000,
        100,
        120_000,
        'DATABASE_STATEMENT_TIMEOUT_MS',
      ),
    sslMode,
  }
}
