import assert from 'node:assert/strict'
import test from 'node:test'
import type { Pool } from 'mysql2/promise'
import { loadDatabaseConfig } from './config.js'
import { Database } from './database.js'

function sqlText(value: unknown): string {
  return typeof value === 'string' ? value : String((value as { sql?: string })?.sql || '')
}

function fakePool(failAction = false) {
  const commands: string[] = []
  let releases = 0
  const connection = {
    async query(value: unknown) {
      const sql = sqlText(value)
      commands.push(sql)
      if (failAction && sql === 'ACTION') throw new Error('failed')
      return [[], []]
    },
    async beginTransaction() {
      commands.push('BEGIN')
    },
    async commit() {
      commands.push('COMMIT')
    },
    async rollback() {
      commands.push('ROLLBACK')
    },
    release() {
      releases++
    },
  }
  const pool = {
    async getConnection() {
      return connection
    },
    async query(value: unknown) {
      return connection.query(value)
    },
    async end() {},
  } as unknown as Pool
  return { pool, commands, releases: () => releases }
}

const config = loadDatabaseConfig(
  {
    NODE_ENV: 'development',
    ONLINE_DATABASE_ENABLED: 'true',
    DATABASE_URL: 'mysql://user:pass@127.0.0.1:3306/xiangqi_development',
  },
  { enabled: true },
)

test('transaction configures UTC and strict mode, commits, and releases the connection', async () => {
  const fake = fakePool()
  const database = new Database(config, fake.pool)
  await database.transaction(async (client) => client.query('ACTION'))
  assert.deepEqual(fake.commands, [
    "SET time_zone = '+00:00'",
    'SET SESSION MAX_EXECUTION_TIME = ?',
    "SET SESSION sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'",
    'BEGIN',
    'ACTION',
    'COMMIT',
  ])
  assert.equal(fake.releases(), 1)
})

test('transaction rolls back and releases the connection when an action fails', async () => {
  const fake = fakePool(true)
  const database = new Database(config, fake.pool)
  await assert.rejects(
    database.transaction(async (client) => client.query('ACTION')),
    /failed/,
  )
  assert.deepEqual(fake.commands, [
    "SET time_zone = '+00:00'",
    'SET SESSION MAX_EXECUTION_TIME = ?',
    "SET SESSION sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'",
    'BEGIN',
    'ACTION',
    'ROLLBACK',
  ])
  assert.equal(fake.releases(), 1)
})
