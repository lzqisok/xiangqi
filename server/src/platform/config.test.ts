import assert from 'node:assert/strict'
import test from 'node:test'
import { loadPlatformConfig } from './config.js'

test('platform defaults keep local development bounded without requiring deployment secrets', () => {
  const config = loadPlatformConfig({ NODE_ENV: 'development' })
  assert.equal(config.apiJsonLimit, '64kb')
  assert.equal(config.importJsonLimit, '2mb')
  assert.equal(config.wsMaxPayloadBytes, 128 * 1024)
  assert.equal(config.maxEngineProcesses, 6)
  assert.equal(config.maxMatchmakingQueueEntries, 100)
  assert.equal(config.publicOnlineEnabled, false)
  assert.equal(config.publicOnlineMode, 'off')
  assert.equal(config.registrationEnabled, true)
  assert.deepEqual(config.allowedOrigins, [])
})

test('production requires HTTPS, explicit trusted proxies, and an engine version manifest', () => {
  assert.throws(() => loadPlatformConfig({ NODE_ENV: 'production' }), /PUBLIC_ORIGIN/)
  assert.throws(
    () => loadPlatformConfig({ NODE_ENV: 'production', PUBLIC_ORIGIN: 'http://chess.test' }),
    /HTTPS PUBLIC_ORIGIN/,
  )
  const base = {
    NODE_ENV: 'production',
    PUBLIC_ORIGIN: 'https://chess.test',
    TRUSTED_PROXY_CIDRS: '10.0.0.0/8',
    DEPLOYMENT_VERSION: 'release-1',
    PIKAFISH_VERSION: '2026.08',
    JIEQI_ENGINE_VERSION: 'jieqi-old-2026.08',
    RAPFI_VERSION: '2026.08',
    ENGINE_WEIGHTS_VERSION: 'weights-2026.08',
    PUBLIC_ONLINE_ENABLED: 'true',
  }
  const config = loadPlatformConfig(base)
  assert.equal(config.publicOrigin, 'https://chess.test')
  assert.deepEqual(config.allowedOrigins, ['https://chess.test'])
  assert.deepEqual(config.trustedProxyCidrs, ['10.0.0.0/8'])
  assert.equal(config.publicOnlineEnabled, true)
  assert.equal(config.publicOnlineMode, 'open')
})

test('controlled and drain rollout modes validate their operational boundaries', () => {
  assert.throws(
    () => loadPlatformConfig({ NODE_ENV: 'development', PUBLIC_ONLINE_MODE: 'controlled' }),
    /PUBLIC_ONLINE_ALLOWED_USER_IDS/,
  )
  const controlled = loadPlatformConfig({
    NODE_ENV: 'development',
    PUBLIC_ONLINE_MODE: 'controlled',
    PUBLIC_ONLINE_ALLOWED_USER_IDS: 'user-a,user-b,user-a',
    PUBLIC_REGISTRATION_ENABLED: 'false',
  })
  assert.equal(controlled.publicOnlineEnabled, true)
  assert.equal(controlled.publicOnlineMode, 'controlled')
  assert.deepEqual(controlled.publicOnlineAllowedUserIds, ['user-a', 'user-b'])
  assert.equal(controlled.registrationEnabled, false)
  assert.equal(
    loadPlatformConfig({ NODE_ENV: 'development', PUBLIC_ONLINE_MODE: 'drain' }).publicOnlineMode,
    'drain',
  )
})

test('production refuses wildcard, path-bearing, and insecure allowed origins', () => {
  assert.throws(
    () =>
      loadPlatformConfig({
        NODE_ENV: 'production',
        PUBLIC_ORIGIN: 'https://chess.test/path',
        TRUSTED_PROXY_CIDRS: '10.0.0.0/8',
      }),
    /origin without a path/,
  )
  assert.throws(
    () =>
      loadPlatformConfig({
        NODE_ENV: 'production',
        PUBLIC_ORIGIN: 'https://chess.test',
        AUTH_ALLOWED_ORIGINS: 'http://other.test',
        TRUSTED_PROXY_CIDRS: '10.0.0.0/8',
      }),
    /allowed origins must use HTTPS/,
  )
})
