import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Database, Queryable } from './database.js'

export const EXPECTED_SCHEMA_VERSION = 4
const MIGRATION_FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/
const MIGRATION_LOCK_NAME = 'xiangqi_platform_schema_migrations'

export type Migration = { version: number; name: string; checksum: string; sql: string }
export type MigrationStatus = {
  currentVersion: number
  expectedVersion: number
  pending: Migration[]
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MigrationError'
  }
}

export function defaultMigrationsDirectory(): string {
  return fileURLToPath(new URL('../../migrations/', import.meta.url))
}

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let quote: "'" | '"' | '`' | null = null
  let lineComment = false
  let blockComment = false

  for (let index = 0; index < sql.length; index++) {
    const char = sql[index]
    const next = sql[index + 1]
    if (lineComment) {
      if (char === '\n') {
        lineComment = false
        current += char
      }
      continue
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        index++
      }
      continue
    }
    if (!quote && char === '-' && next === '-' && /\s/.test(sql[index + 2] || '')) {
      lineComment = true
      index++
      continue
    }
    if (!quote && char === '#') {
      lineComment = true
      continue
    }
    if (!quote && char === '/' && next === '*') {
      blockComment = true
      index++
      continue
    }
    if (quote) {
      current += char
      if (char === '\\') {
        current += next || ''
        index++
      } else if (char === quote) {
        if (next === quote) {
          current += next
          index++
        } else {
          quote = null
        }
      }
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      current += char
    } else if (char === ';') {
      if (current.trim()) statements.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  if (quote || blockComment)
    throw new MigrationError('migration SQL contains an unterminated token')
  if (current.trim()) statements.push(current.trim())
  return statements
}

export async function loadMigrations(
  directory = defaultMigrationsDirectory(),
): Promise<Migration[]> {
  const migrations: Migration[] = []
  for (const file of (await readdir(directory)).sort()) {
    const match = MIGRATION_FILE.exec(file)
    if (!match) continue
    const sql = await readFile(path.join(directory, file), 'utf8')
    if (!splitSqlStatements(sql).length) throw new MigrationError(`migration ${file} is empty`)
    migrations.push({
      version: Number(match[1]),
      name: match[2],
      checksum: createHash('sha256').update(sql).digest('hex'),
      sql,
    })
  }
  for (const [index, migration] of migrations.entries()) {
    if (migration.version !== index + 1) {
      throw new MigrationError(
        `migration versions must be contiguous from 0001; found ${migration.version}`,
      )
    }
  }
  if (migrations.at(-1)?.version !== EXPECTED_SCHEMA_VERSION) {
    throw new MigrationError('EXPECTED_SCHEMA_VERSION does not match migration files')
  }
  return migrations
}

async function ensureMetadata(client: Queryable): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS platform_schema_migrations (
      version int NOT NULL PRIMARY KEY,
      name varchar(100) NOT NULL,
      checksum char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      applied_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      CONSTRAINT platform_schema_migrations_version_chk CHECK (version > 0),
      CONSTRAINT platform_schema_migrations_checksum_chk CHECK (checksum REGEXP '^[0-9a-f]{64}$')
    ) ENGINE=InnoDB
  `)
}

async function tableExists(client: Queryable, tableName: string): Promise<boolean> {
  const result = await client.query<{ present: number }>(
    `SELECT EXISTS(
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = ?
     ) AS present`,
    [tableName],
  )
  return Number(result.rows[0]?.present) === 1
}

async function appliedMigrations(
  client: Queryable,
): Promise<Map<number, { name: string; checksum: string }>> {
  if (!(await tableExists(client, 'platform_schema_migrations'))) {
    if ((await tableExists(client, 'users')) || (await tableExists(client, 'matches'))) {
      throw new MigrationError('database has platform tables without migration metadata')
    }
    return new Map()
  }
  const result = await client.query<{ version: number; name: string; checksum: string }>(
    'SELECT version, name, checksum FROM platform_schema_migrations ORDER BY version',
  )
  return new Map(result.rows.map((row) => [Number(row.version), row]))
}

function verifyApplied(
  applied: Map<number, { name: string; checksum: string }>,
  migrations: Migration[],
): void {
  for (const [version, record] of applied) {
    const migration = migrations.find((candidate) => candidate.version === version)
    if (!migration) throw new MigrationError(`database contains unknown migration ${version}`)
    if (migration.name !== record.name || migration.checksum !== record.checksum) {
      throw new MigrationError(`migration ${version} was modified after being applied`)
    }
  }
}

export async function migrationStatus(
  database: Database,
  directory?: string,
): Promise<MigrationStatus> {
  const migrations = await loadMigrations(directory)
  return database.connection(async (client) => {
    const applied = await appliedMigrations(client)
    verifyApplied(applied, migrations)
    const currentVersion = Math.max(0, ...applied.keys())
    return {
      currentVersion,
      expectedVersion: EXPECTED_SCHEMA_VERSION,
      pending: migrations.filter((migration) => !applied.has(migration.version)),
    }
  })
}

export async function migrate(database: Database, directory?: string): Promise<number[]> {
  await database.ping()
  const migrations = await loadMigrations(directory)
  return database.connection(async (client) => {
    const lock = await client.query<{ acquired: number }>('SELECT GET_LOCK(?, 10) AS acquired', [
      MIGRATION_LOCK_NAME,
    ])
    if (Number(lock.rows[0]?.acquired) !== 1) {
      throw new MigrationError('could not acquire migration lock')
    }
    try {
      const applied = await appliedMigrations(client)
      await ensureMetadata(client)
      verifyApplied(applied, migrations)
      const appliedNow: number[] = []
      for (const migration of migrations) {
        if (applied.has(migration.version)) continue
        for (const statement of splitSqlStatements(migration.sql)) await client.query(statement)
        await client.query(
          'INSERT INTO platform_schema_migrations (version, name, checksum) VALUES (?, ?, ?)',
          [migration.version, migration.name, migration.checksum],
        )
        appliedNow.push(migration.version)
      }
      return appliedNow
    } finally {
      await client.query('SELECT RELEASE_LOCK(?)', [MIGRATION_LOCK_NAME]).catch(() => undefined)
    }
  })
}

export async function assertSchemaReady(database: Database): Promise<void> {
  const status = await migrationStatus(database)
  if (status.currentVersion !== status.expectedVersion || status.pending.length) {
    throw new MigrationError('database schema is not at the required version')
  }
}
