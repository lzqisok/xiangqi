import '../env.js'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
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
