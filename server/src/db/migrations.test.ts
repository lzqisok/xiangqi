import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  EXPECTED_SCHEMA_VERSION,
  MigrationError,
  defaultMigrationsDirectory,
  loadMigrations,
  splitSqlStatements,
} from './migrations.js'

test('migration files are contiguous, immutable inputs with the expected latest version', async () => {
  const migrations = await loadMigrations()
  assert.deepEqual(
    migrations.map((migration) => migration.version),
    [1, 2, 3, 4, 5, 6, 7],
  )
  assert.equal(migrations.at(-1)?.version, EXPECTED_SCHEMA_VERSION)
  assert.ok(migrations.every((migration) => /^[0-9a-f]{64}$/.test(migration.checksum)))
  assert.match(migrations[0].sql, /CREATE TABLE IF NOT EXISTS users/)
  assert.match(migrations[1].sql, /CREATE TABLE IF NOT EXISTS match_states/)
  assert.match(migrations[2].sql, /CREATE TABLE IF NOT EXISTS matchmaking_entries/)
  assert.match(migrations[3].sql, /CREATE TABLE IF NOT EXISTS rate_limit_buckets/)
  assert.match(migrations[4].sql, /CREATE TABLE IF NOT EXISTS user_documents/)
  assert.match(migrations[5].sql, /'timeout'/)
  assert.match(migrations[6].sql, /CREATE TABLE IF NOT EXISTS match_rating_settlements/)
})

test('MySQL migration splitter ignores comments and quoted semicolons', () => {
  assert.deepEqual(
    splitSqlStatements(`
      -- comment;
      INSERT INTO sample (value) VALUES ('a;b');
      # another comment
      SELECT \`semi;colon\` FROM sample;
    `),
    ["INSERT INTO sample (value) VALUES ('a;b')", 'SELECT `semi;colon` FROM sample'],
  )
})

test('migration discovery rejects gaps instead of guessing an unknown schema', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-migrations-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(path.join(directory, '0002_gap.sql'), 'SELECT 1;', 'utf8')
  await assert.rejects(loadMigrations(directory), MigrationError)
})

test('checked-in migration SQL does not contain down or destructive schema operations', async () => {
  for (const file of [
    '0001_accounts.sql',
    '0002_matches.sql',
    '0003_online_matches.sql',
    '0004_platform_operations.sql',
    '0005_user_documents.sql',
    '0006_online_match_completion_reasons.sql',
    '0007_ratings.sql',
  ]) {
    const sql = await readFile(path.join(defaultMigrationsDirectory(), file), 'utf8')
    assert.doesNotMatch(sql, /\b(?:DROP\s+(?:TABLE|COLUMN)|TRUNCATE)\b/i)
    assert.doesNotMatch(sql, /\b(?:timestamptz|jsonb|bytea|uuid)\b/i)
  }
})
