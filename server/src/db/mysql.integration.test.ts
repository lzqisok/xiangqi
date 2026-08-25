import '../env.js'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import test from 'node:test'
import express from 'express'
import mysql from 'mysql2/promise'
import { loadDatabaseConfig } from './config.js'
import { Database } from './database.js'
import { DatabaseUnavailableError, RepositoryRevisionConflictError } from './errors.js'
import { loadMigrations, migrate, migrationStatus, splitSqlStatements } from './migrations.js'
import {
  MySqlAccountRepository,
  MySqlMatchRepository,
  MySqlSessionRepository,
} from '../repositories/mysql.js'
import { MySqlAuthRepository } from '../auth/repository.js'
import { AuthService } from '../auth/service.js'
import type { DeliveredAccountToken } from '../auth/types.js'
import { createAuthRuntime, CSRF_COOKIE, DEVELOPMENT_SESSION_COOKIE } from '../auth/http.js'

function validTestConnectionString(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    const host = url.hostname.toLowerCase()
    const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1'
    const databaseName = decodeURIComponent(url.pathname.slice(1)).toLowerCase()
    return url.protocol === 'mysql:' && loopback && databaseName.includes('test') ? raw : undefined
  } catch {
    return undefined
  }
}

const configuredTestConnectionString = process.env.TEST_DATABASE_URL
const connectionString = validTestConnectionString(configuredTestConnectionString)
const integration = {
  skip: connectionString
    ? false
    : 'TEST_DATABASE_URL must be a loopback mysql:// URL with a test database name',
}

function databaseName(): string {
  return `xiangqi_test_${randomUUID().replaceAll('-', '')}`
}

async function withTestDatabase<T>(action: (database: Database) => Promise<T>): Promise<T> {
  if (!connectionString) throw new Error('MySQL test database is not configured')
  const name = databaseName()
  const adminUrl = new URL(connectionString)
  adminUrl.pathname = '/'
  const admin = mysql.createPool({ uri: adminUrl.toString() })
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`)
  const url = new URL(connectionString)
  url.pathname = `/${name}`
  const config = loadDatabaseConfig(
    {
      NODE_ENV: 'test',
      ONLINE_DATABASE_ENABLED: 'true',
      DATABASE_URL: url.toString(),
      DATABASE_SSL_MODE: 'disable',
    },
    { enabled: true },
  )
  const database = new Database(config)
  try {
    return await action(database)
  } finally {
    await database.close()
    await admin.query(`DROP DATABASE \`${name}\``)
    await admin.end()
  }
}

const objectState = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

test(
  'empty MySQL database migrates and repositories preserve atomic revisions',
  integration,
  async () => {
    await withTestDatabase(async (database) => {
      assert.deepEqual(await migrate(database), [1, 2])
      assert.deepEqual(await migrate(database), [])
      assert.equal((await migrationStatus(database)).currentVersion, 2)

      const accounts = new MySqlAccountRepository(database)
      const sessions = new MySqlSessionRepository(database)
      const matches = new MySqlMatchRepository(database, objectState, objectState)
      const first = await accounts.create({
        emailNormalized: 'first@example.com',
        emailDisplay: 'First@example.com',
        displayName: '红方棋手',
        passwordHash: '$argon2id$placeholder-first-hash',
        passwordHashVersion: 1,
        verificationTokenHash: randomBytes(32),
        verificationExpiresAt: new Date(Date.now() + 86_400_000),
      })
      const second = await accounts.create({
        emailNormalized: 'second@example.com',
        emailDisplay: 'second@example.com',
        displayName: '黑方棋手',
        passwordHash: '$argon2id$placeholder-second-hash',
        passwordHashVersion: 1,
        verificationTokenHash: randomBytes(32),
        verificationExpiresAt: new Date(Date.now() + 86_400_000),
      })
      await assert.rejects(
        accounts.create({
          emailNormalized: 'first@example.com',
          emailDisplay: 'first@example.com',
          displayName: '重复账号',
          passwordHash: '$argon2id$placeholder-duplicate-hash',
          passwordHashVersion: 1,
          verificationTokenHash: randomBytes(32),
          verificationExpiresAt: new Date(Date.now() + 86_400_000),
        }),
        { code: 'unique_conflict' },
      )
      const count = await database.query<{ count: string }>('SELECT count(*) AS count FROM users')
      assert.equal(Number(count.rows[0].count), 2)

      const now = new Date()
      const tokenHash = randomBytes(32)
      const createdSession = await sessions.create({
        userId: first.id,
        tokenHash,
        csrfSecretHash: randomBytes(32),
        authEpoch: first.authEpoch,
        idleExpiresAt: new Date(now.getTime() + 60_000),
        absoluteExpiresAt: new Date(now.getTime() + 120_000),
      })
      assert.equal((await sessions.findValidByTokenHash(tokenHash, now))?.id, createdSession.id)
      assert.equal(await sessions.revoke(createdSession.id, first.id), true)
      assert.equal(await sessions.findValidByTokenHash(tokenHash, now), null)

      const expiresAt = new Date(now.getTime() + 365 * 86_400_000)
      const createdMatch = await matches.create({
        variant: 'xiangqi',
        visibility: 'public',
        phase: 'playing',
        status: 'playing',
        createdByUserId: first.id,
        participants: [
          { userId: first.id, side: 'red', isOwner: true, displayNameSnapshot: '红方棋手' },
          { userId: second.id, side: 'black', isOwner: false, displayNameSnapshot: '黑方棋手' },
        ],
        stateSchemaVersion: 1,
        publicState: { turn: 'red' },
        refereeState: { turn: 'red', private: true },
        startedAt: now,
        expiresAt,
      })
      const updated = await matches.updateState(
        createdMatch.id,
        0,
        { turn: 'black' },
        { turn: 'black', private: true },
      )
      assert.equal(updated.revision, 1)
      assert.equal((await matches.getStateForReferee(createdMatch.id))?.revision, 1)
      await assert.rejects(
        matches.updateState(createdMatch.id, 0, { turn: 'red' }, { private: true }),
        RepositoryRevisionConflictError,
      )
      assert.deepEqual((await matches.getStateForReferee(createdMatch.id))?.publicState, {
        turn: 'black',
      })

      const waiting = await matches.create({
        variant: 'gomoku',
        gomokuRule: 'renju',
        visibility: 'invite',
        phase: 'waiting',
        status: 'playing',
        createdByUserId: first.id,
        participants: [
          { userId: first.id, side: 'red', isOwner: true, displayNameSnapshot: '红方棋手' },
        ],
        stateSchemaVersion: 1,
        publicState: { board: [] },
        refereeState: { board: [] },
        expiresAt,
      })
      await matches.deleteWaiting(waiting.id, 0)
      assert.equal(await matches.findById(waiting.id), null)

      const config = database.config
      await database.close()
      const reconnected = new Database(config)
      try {
        assert.equal(
          (await new MySqlAccountRepository(reconnected).findById(first.id))?.id,
          first.id,
        )
      } finally {
        await reconnected.close()
      }
      await assert.rejects(database.ping(), DatabaseUnavailableError)
    })
  },
)

test(
  'account authentication lifecycle uses hashed credentials and revocable sessions',
  integration,
  async () => {
    await withTestDatabase(async (database) => {
      await migrate(database)
      const delivered: DeliveredAccountToken[] = []
      const auth = new AuthService(
        new MySqlAccountRepository(database),
        new MySqlAuthRepository(database),
        { deliver: async (token) => void delivered.push(token) },
      )

      const registration = await auth.register({
        email: 'Player@Example.com',
        password: 'correct horse battery',
        displayName: '云端棋手',
        ipKey: '127.0.0.1',
      })
      assert.equal(registration.accepted, true)
      assert.equal(delivered.length, 1)
      await auth.register({
        email: 'player@example.com',
        password: 'another safe password',
        displayName: '重复注册',
        ipKey: '127.0.0.2',
      })
      assert.equal(delivered.length, 1)

      const firstLogin = await auth.login({
        email: 'PLAYER@example.com',
        password: 'correct horse battery',
        ipKey: '127.0.0.1',
        deviceKey: 'browser-one',
      })
      const pending = await auth.authenticate(firstLogin.sessionToken, 'request-1', '127.0.0.1')
      assert.equal(pending.actor.kind === 'user' && pending.actor.status, 'pending_verification')
      assert.equal(auth.csrfValid(firstLogin.session, firstLogin.csrfToken), true)

      assert.equal(await auth.verifyEmail(delivered[0].token), true)
      assert.equal(await auth.verifyEmail(delivered[0].token), false)
      const active = await auth.authenticate(firstLogin.sessionToken, 'request-2', '127.0.0.1')
      assert.equal(active.actor.kind === 'user' && active.actor.status, 'active')
      if (active.actor.kind !== 'user') throw new Error('expected authenticated actor')
      assert.equal((await auth.updateProfile(active.actor, '已验证棋手')).displayName, '已验证棋手')

      await auth.changePassword(active.actor, 'correct horse battery', 'new correct horse battery')
      assert.equal(
        (await auth.authenticate(firstLogin.sessionToken, 'request-3', '127.0.0.1')).actor.kind,
        'user',
      )
      await auth.logout(active.actor)
      assert.equal(
        (await auth.authenticate(firstLogin.sessionToken, 'request-4', '127.0.0.1')).actor.kind,
        'anonymous',
      )

      const resetToken = await auth.requestPasswordReset('player@example.com')
      assert.ok(resetToken)
      assert.equal(await auth.resetPassword(resetToken, 'reset correct horse battery'), true)
      await assert.rejects(
        auth.login({
          email: 'player@example.com',
          password: 'new correct horse battery',
          ipKey: '127.0.0.3',
          deviceKey: 'browser-two',
        }),
        { code: 'invalid_credentials' },
      )
      const recoveredLogin = await auth.login({
        email: 'player@example.com',
        password: 'reset correct horse battery',
        ipKey: '127.0.0.3',
        deviceKey: 'browser-two',
      })
      const recoveredActor = await auth.authenticate(
        recoveredLogin.sessionToken,
        'request-5',
        '127.0.0.3',
      )
      if (recoveredActor.actor.kind !== 'user') throw new Error('expected authenticated actor')
      const deletionToken = await auth.beginDeletion(
        recoveredActor.actor,
        'reset correct horse battery',
      )
      assert.equal(
        (await auth.authenticate(recoveredLogin.sessionToken, 'request-6', '127.0.0.3')).actor.kind,
        'anonymous',
      )
      assert.equal(await auth.recoverDeletion(deletionToken), true)
      const afterRecovery = await auth.login({
        email: 'player@example.com',
        password: 'reset correct horse battery',
        ipKey: '127.0.0.4',
        deviceKey: 'browser-three',
      })
      assert.equal(
        (await auth.authenticate(afterRecovery.sessionToken, 'request-7', '127.0.0.4')).actor.kind,
        'user',
      )
    })
  },
)

test(
  'account HTTP flow enforces Origin, Cookie, CSRF, expiry, and logout',
  integration,
  async () => {
    await withTestDatabase(async (database) => {
      await migrate(database)
      const delivered: DeliveredAccountToken[] = []
      const app = express()
      const runtime = createAuthRuntime(
        database,
        { deliver: async (token) => void delivered.push(token) },
        {
          production: false,
          exposeDevelopmentTokens: true,
          allowedOrigins: ['http://app.test'],
        },
      )
      app.use(express.json())
      app.use(runtime.actorMiddleware)
      app.use('/api/auth', runtime.router)
      app.use('/api/me', runtime.meRouter)
      app.use(runtime.errorMiddleware)
      const server = createServer(app)
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      try {
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('expected TCP test server')
        const base = `http://127.0.0.1:${address.port}`
        const send = (path: string, init: RequestInit = {}) =>
          fetch(`${base}${path}`, {
            ...init,
            headers: { Origin: 'http://app.test', ...(init.headers || {}) },
          })
        const badOrigin = await fetch(`${base}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://evil.test' },
          body: JSON.stringify({
            email: 'http@example.com',
            password: 'correct horse battery',
            displayName: '网页棋手',
          }),
        })
        assert.equal(badOrigin.status, 403)

        const registration = await send('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'http@example.com',
            password: 'correct horse battery',
            displayName: '网页棋手',
          }),
        })
        assert.equal(registration.status, 202)
        assert.equal(await runtime.service.verifyEmail(delivered[0].token), true)
        await database.query('UPDATE password_credentials SET hash_version = 2')

        const login = await send('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'http@example.com', password: 'correct horse battery' }),
        })
        assert.equal(login.status, 200)
        assert.equal(
          Number(
            (
              await database.query<{ hash_version: number }>(
                'SELECT hash_version FROM password_credentials',
              )
            ).rows[0].hash_version,
          ),
          1,
        )
        const loginBody = (await login.json()) as { csrfToken: string }
        const setCookies = login.headers.getSetCookie()
        const sessionCookie = setCookies.find((value) =>
          value.startsWith(`${DEVELOPMENT_SESSION_COOKIE}=`),
        )
        const csrfCookie = setCookies.find((value) => value.startsWith(`${CSRF_COOKIE}=`))
        assert.match(sessionCookie || '', /HttpOnly/)
        assert.match(sessionCookie || '', /SameSite=Lax/)
        assert.doesNotMatch(sessionCookie || '', /Secure/)
        assert.doesNotMatch(csrfCookie || '', /HttpOnly/)
        const cookie = setCookies.map((value) => value.split(';', 1)[0]).join('; ')

        assert.equal((await send('/api/auth/session', { headers: { Cookie: cookie } })).status, 200)
        const rejected = await send('/api/me/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ displayName: '改名棋手', userId: randomUUID() }),
        })
        assert.equal(rejected.status, 403)
        const updated = await send('/api/me/profile', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            'X-CSRF-Token': loginBody.csrfToken,
          },
          body: JSON.stringify({ displayName: '改名棋手', userId: randomUUID() }),
        })
        assert.equal(updated.status, 200)
        assert.equal(
          ((await updated.json()) as { user: { displayName: string } }).user.displayName,
          '改名棋手',
        )

        const expiringLogin = await send('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'http@example.com',
            password: 'correct horse battery',
            deviceLabel: 'expiry-test',
          }),
        })
        const expiringCookie = expiringLogin.headers
          .getSetCookie()
          .map((value) => value.split(';', 1)[0])
          .join('; ')
        await database.query(
          "UPDATE sessions SET idle_expires_at = DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 1 SECOND) WHERE device_label = 'expiry-test'",
        )
        const expired = await send('/api/auth/session', { headers: { Cookie: expiringCookie } })
        assert.deepEqual(await expired.json(), { authenticated: false })

        const logout = await send('/api/auth/logout', {
          method: 'POST',
          headers: { Cookie: cookie, 'X-CSRF-Token': loginBody.csrfToken },
        })
        assert.equal(logout.status, 204)
        const afterLogout = await send('/api/auth/session', { headers: { Cookie: cookie } })
        assert.deepEqual(await afterLogout.json(), { authenticated: false })
        const events = await database.query<{ metadata: string }>(
          'SELECT metadata FROM security_events',
        )
        assert.equal(JSON.stringify(events.rows).includes(delivered[0].token), false)
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        )
      }
    })
  },
)

test('a database at migration 0001 upgrades to the current version', integration, async () => {
  await withTestDatabase(async (database) => {
    const [first] = await loadMigrations()
    await database.connection(async (client) => {
      await client.query(`
        CREATE TABLE platform_schema_migrations (
          version int NOT NULL PRIMARY KEY,
          name varchar(100) NOT NULL,
          checksum char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          applied_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
        ) ENGINE=InnoDB
      `)
      for (const statement of splitSqlStatements(first.sql)) await client.query(statement)
      await client.query(
        'INSERT INTO platform_schema_migrations (version, name, checksum) VALUES (?, ?, ?)',
        [first.version, first.name, first.checksum],
      )
    })
    assert.deepEqual(await migrate(database), [2])
    assert.equal((await migrationStatus(database)).currentVersion, 2)
  })
})
