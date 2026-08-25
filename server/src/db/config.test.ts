import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseConfigError, loadDatabaseConfig } from './config.js'

test('database configuration remains optional for the existing local server', () => {
  const config = loadDatabaseConfig({ NODE_ENV: 'development' })
  assert.equal(config.enabled, false)
  assert.equal(config.connectionString, undefined)
  assert.equal(config.databaseName, undefined)
  assert.equal(config.sslMode, 'disable')
})

test('enabled database configuration validates URL, bounds, and production TLS', () => {
  assert.throws(
    () => loadDatabaseConfig({ NODE_ENV: 'development', ONLINE_DATABASE_ENABLED: 'true' }),
    DatabaseConfigError,
  )
  assert.throws(
    () =>
      loadDatabaseConfig({
        NODE_ENV: 'development',
        ONLINE_DATABASE_ENABLED: 'true',
        DATABASE_URL: 'postgresql://user:pass@localhost/db',
      }),
    /mysql:\/\//,
  )
  assert.throws(
    () =>
      loadDatabaseConfig({
        NODE_ENV: 'production',
        ONLINE_DATABASE_ENABLED: 'true',
        DATABASE_URL: 'mysql://user:pass@db.example.com/xiangqi',
        DATABASE_SSL_MODE: 'disable',
      }),
    /require TLS/,
  )
  assert.throws(
    () =>
      loadDatabaseConfig({
        NODE_ENV: 'development',
        DATABASE_POOL_MAX: '0',
      }),
    /DATABASE_POOL_MAX/,
  )
})

test('test configuration refuses non-isolated database targets', () => {
  assert.throws(
    () =>
      loadDatabaseConfig({
        NODE_ENV: 'test',
        ONLINE_DATABASE_ENABLED: 'true',
        DATABASE_URL: 'mysql://user:pass@production.example.com/xiangqi',
      }),
    /test database/,
  )
  const config = loadDatabaseConfig({
    NODE_ENV: 'test',
    ONLINE_DATABASE_ENABLED: 'true',
    DATABASE_URL: 'mysql://user:pass@127.0.0.1/xiangqi_test',
  })
  assert.equal(config.environment, 'test')
  assert.equal(config.databaseName, 'xiangqi_test')
})
