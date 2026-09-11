import '../env.js'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import test from 'node:test'
import express from 'express'
import mysql from 'mysql2/promise'
import { loadDatabaseConfig } from './config.js'
import { Database } from './database.js'
import {
  DatabaseUnavailableError,
  RepositoryNotFoundError,
  RepositoryRevisionConflictError,
} from './errors.js'
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
import { MySqlOnlineMatchRepository } from '../online/repository.js'
import {
  MySqlUserDocumentRepository,
  UserDocumentLimitError,
} from '../repositories/userDocuments.js'
import { MySqlGameRepository } from '../games/mysqlRepository.js'
import { GameNotFoundError } from '../games/repository.js'
import { OnlineMatchService } from '../online/service.js'
import { OnlineMatchManager } from '../online/manager.js'
import { verifyRestoredDatabase } from './restoreVerification.js'
import { readOnlineRefereeState } from '../online/state.js'
import type { OnlineActor } from '../online/types.js'
import { MySqlAccountDataService } from '../auth/accountData.js'
import { USER_DOCUMENT_RESOURCES, userDocumentDefinition } from '../documents/registry.js'
import { userDocumentSourceAccessible } from '../documents/routes.js'

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

const INITIAL_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'

function resourcePayload(resource: (typeof USER_DOCUMENT_RESOURCES)[number], suffix: string) {
  const now = suffix === 'a' ? 1 : 2
  switch (resource) {
    case 'studies':
      return {
        id: `study-${suffix}`,
        name: `研究${suffix}`,
        initialFen: INITIAL_FEN,
        moves: [],
        currentMoveIndex: -1,
        analysisPoints: [],
        createdAt: now,
        updatedAt: now,
      }
    case 'training-tasks':
      return {
        id: `training-${suffix}`,
        positionFen: INITIAL_FEN,
        mover: 'red',
        playedMove: 'a3a4',
        recommendedMove: 'a3a4',
        source: { type: 'study', id: `study-${suffix}`, name: `研究${suffix}`, nodeId: 'root' },
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }
    case 'custom-endgames':
      return { id: `endgame-${suffix}`, name: `残局${suffix}`, fen: INITIAL_FEN, source: 'custom' }
    case 'favorite-endgames':
      return { endgameId: `builtin-${suffix}` }
    case 'jieqi-seat-records':
      return {
        kind: 'jieqi-record-projection',
        schemaVersion: 1,
        recordId: `jieqi-${suffix}`,
        audience: suffix === 'a' ? 'red' : 'black',
        initialBoard: Array.from({ length: 10 }, () => []),
        events: [],
        privateEvents: [],
        createdAt: now,
        updatedAt: now,
      }
    case 'gomoku-history':
      return {
        id: `gomoku-${suffix}`,
        createdAt: now,
        mode: 'pvp',
        forbiddenEnabled: false,
        winner: 1,
        draw: false,
        moves: [
          { row: 7, col: 3, player: 1 },
          { row: 0, col: 0, player: 2 },
          { row: 7, col: 4, player: 1 },
          { row: 0, col: 1, player: 2 },
          { row: 7, col: 5, player: 1 },
          { row: 0, col: 2, player: 2 },
          { row: 7, col: 6, player: 1 },
          { row: 0, col: 3, player: 2 },
          { row: 7, col: 7, player: 1 },
        ],
      }
    case 'recent-fens':
      return { fen: INITIAL_FEN.replace(' 0 1', ` 0 ${now}`), label: `局面${suffix}`, savedAt: now }
    case 'account-settings':
      return { candidateCount: suffix === 'a' ? 3 : 4, searchMode: 'depth', searchDepth: 12 }
  }
}

test(
  'empty MySQL database migrates and repositories preserve atomic revisions',
  integration,
  async () => {
    await withTestDatabase(async (database) => {
      assert.deepEqual(await migrate(database), [1, 2, 3, 4, 5, 6, 7, 8, 9])
      assert.deepEqual(await migrate(database), [])
      assert.equal((await migrationStatus(database)).currentVersion, 9)

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

      const documents = new MySqlUserDocumentRepository(
        database,
        'test-documents',
        1,
        (value): value is { title: string } =>
          Boolean(value) &&
          typeof value === 'object' &&
          typeof (value as { title?: unknown }).title === 'string',
        10,
        (value) => value.title,
      )
      const createdDocument = await documents.create(first.id, { title: '第一版' }, 'create-1')
      const repeatedCreate = await documents.create(first.id, { title: '第一版' }, 'create-1')
      assert.equal(repeatedCreate.id, createdDocument.id)
      const deduplicatedCreate = await documents.create(
        first.id,
        { title: '第一版' },
        'create-same-logical-key',
      )
      assert.equal(deduplicatedCreate.id, createdDocument.id)
      assert.equal((await documents.list(first.id)).length, 1)
      assert.equal(await documents.find(second.id, createdDocument.id), null)
      const updatedDocument = await documents.update(
        first.id,
        createdDocument.id,
        0,
        { title: '第二版' },
        'update-1',
      )
      assert.equal(updatedDocument.revision, 1)
      assert.equal(
        (
          await documents.update(
            first.id,
            createdDocument.id,
            0,
            { title: '重复请求不会重复更新' },
            'update-1',
          )
        ).revision,
        1,
      )
      await assert.rejects(
        documents.update(first.id, createdDocument.id, 0, { title: '过期写入' }, 'update-stale'),
        RepositoryRevisionConflictError,
      )
      await documents.delete(first.id, createdDocument.id, 1, 'delete-1')
      await documents.delete(first.id, createdDocument.id, 1, 'delete-1')
      assert.equal(await documents.find(first.id, createdDocument.id), null)
      const limitedDocuments = new MySqlUserDocumentRepository(
        database,
        'limited-documents',
        1,
        objectState,
        1,
      )
      await limitedDocuments.create(first.id, { id: 'first' }, 'limited-create-1')
      await assert.rejects(
        limitedDocuments.create(first.id, { id: 'second' }, 'limited-create-2'),
        UserDocumentLimitError,
      )

      const games = new MySqlGameRepository(database)
      const gameInput = {
        name: '账号私有对局',
        mode: 'human-vs-human' as const,
        config: {
          difficulty: 'medium' as const,
          playerSide: 'red' as const,
          aiRedDifficulty: 'medium' as const,
          aiBlackDifficulty: 'medium' as const,
        },
        state: {
          f: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',
          t: { r: 'root', c: 'root', n: { root: { p: null, c: [] } } },
          s: 'playing' as const,
        },
        clientMutationId: 'game-create-1',
      }
      const cloudGame = await games.create(first.id, gameInput)
      assert.equal((await games.create(first.id, gameInput)).id, cloudGame.id)
      assert.equal(cloudGame.ownerUserId, first.id)
      await assert.rejects(games.get(second.id, cloudGame.id), GameNotFoundError)
      const renamedGame = await games.rename(
        first.id,
        cloudGame.id,
        0,
        '账号私有对局-已改名',
        'game-rename-1',
      )
      assert.equal(renamedGame.revision, 1)
      assert.equal((await games.list(second.id)).length, 0)
      const exportFile = await games.export(first.id)
      const importedOnce = await games.import(second.id, exportFile, 'game-import-1')
      const importedTwice = await games.import(second.id, exportFile, 'game-import-1')
      assert.equal(importedOnce.imported[0].id, importedTwice.imported[0].id)
      assert.equal((await games.list(second.id)).length, 1)

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
      await database.query(
        `UPDATE matches SET phase = 'finished', status = 'red-wins', status_reason = 'timeout'
         WHERE id = ?`,
        [createdMatch.id],
      )
      assert.equal(
        (
          await database.query<{ status_reason: string }>(
            'SELECT status_reason FROM matches WHERE id = ?',
            [createdMatch.id],
          )
        ).rows[0].status_reason,
        'timeout',
      )

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
  'account online matches atomically pair users and enforce actor, revision, idempotency, and history',
  integration,
  async () => {
    await withTestDatabase(async (database) => {
      await migrate(database)
      const accounts = new MySqlAccountRepository(database)
      const createAccount = (ordinal: number) =>
        accounts.create({
          emailNormalized: `online-${ordinal}@example.com`,
          emailDisplay: `online-${ordinal}@example.com`,
          displayName: `公网棋手${ordinal}`,
          passwordHash: `$argon2id$online-placeholder-${ordinal}`,
          passwordHashVersion: 1,
          verificationTokenHash: randomBytes(32),
          verificationExpiresAt: new Date(Date.now() + 86_400_000),
        })
      const [first, second, outsider] = await Promise.all([
        createAccount(1),
        createAccount(2),
        createAccount(3),
      ])
      await database.query("UPDATE users SET status = 'active'")
      const actor = (userId: string): OnlineActor => ({
        userId,
        sessionId: randomUUID(),
        ipKey: `ip:${userId}`,
        capabilities: ['online:play', 'online:watch'],
      })
      const firstActor = actor(first.id)
      const secondActor = actor(second.id)
      const outsiderActor = actor(outsider.id)
      const repository = new MySqlOnlineMatchRepository(database)
      const service = new OnlineMatchService(repository)
      const firstRequestKey = randomUUID()
      const secondRequestKey = randomUUID()
      const [firstRequest, secondRequest] = await Promise.all([
        service.quickMatch(firstActor, {
          variant: 'xiangqi',
          requestKey: firstRequestKey,
        }),
        service.quickMatch(secondActor, {
          variant: 'xiangqi',
          requestKey: secondRequestKey,
        }),
      ])
      assert.equal(firstRequest.record.match.id, secondRequest.record.match.id)
      const matchId = firstRequest.record.match.id
      const paired = await service.get(firstActor, matchId)
      assert.equal(paired.match.phase, 'playing')
      assert.equal(paired.match.revision, 1)
      assert.equal(paired.participants.filter((item) => item.side).length, 2)
      assert.deepEqual(
        new Set(paired.participants.map((item) => item.userId)),
        new Set([first.id, second.id]),
      )
      const queueCount = await database.query<{ count: string }>(
        'SELECT count(*) AS count FROM matchmaking_entries',
      )
      assert.equal(Number(queueCount.rows[0].count), 0)
      const retriedMatchedRequest = await service.quickMatch(firstActor, {
        variant: 'xiangqi',
        requestKey: firstRequestKey,
      })
      assert.equal(retriedMatchedRequest.record.match.id, matchId)
      assert.equal(retriedMatchedRequest.created, false)

      const [timedFirst, timedSecond] = await Promise.all([
        service.quickMatch(firstActor, {
          variant: 'xiangqi',
          clockPreset: '15m-10s',
          requestKey: randomUUID(),
        }),
        service.quickMatch(secondActor, {
          variant: 'xiangqi',
          clockPreset: '15m-10s',
          requestKey: randomUUID(),
        }),
      ])
      assert.equal(timedFirst.record.match.id, timedSecond.record.match.id)
      const timed = await service.get(firstActor, timedFirst.record.match.id)
      assert.equal(timed.state.clock?.activeSide, 'red')
      assert.equal(timed.state.clock?.incrementMs, 10_000)
      const timedRedId = timed.participants.find((item) => item.side === 'red')!.userId
      const timedRedActor = timedRedId === first.id ? firstActor : secondActor
      const timedMoved = await service.move(timedRedActor, {
        matchId: timed.match.id,
        commandId: randomUUID(),
        expectedRevision: timed.match.revision,
        uci: 'a3a4',
      })
      assert.equal(timedMoved.record.state.clock?.activeSide, 'black')
      assert.ok((timedMoved.record.state.clock?.redRemainingMs ?? 0) > 900_000)
      assert.equal(
        await repository.adjudicateClock(
          timed.match.id,
          timed.state.clock?.deadlineAt ?? 'invalid',
        ),
        null,
      )
      const persistedTimedState = await database.query<{ referee_state: unknown }>(
        'SELECT referee_state FROM match_states WHERE match_id = ?',
        [timed.match.id],
      )
      assert.equal(
        readOnlineRefereeState(persistedTimedState.rows[0].referee_state, 'xiangqi').clock
          ?.activeSide,
        'black',
      )

      const [ratedFirst, ratedSecond] = await Promise.all([
        service.quickMatch(firstActor, {
          variant: 'xiangqi',
          competitionMode: 'rated',
          clockPreset: '10m',
          requestKey: randomUUID(),
        }),
        service.quickMatch(secondActor, {
          variant: 'xiangqi',
          competitionMode: 'rated',
          clockPreset: '10m',
          requestKey: randomUUID(),
        }),
      ])
      assert.equal(ratedFirst.record.match.id, ratedSecond.record.match.id)
      const rated = await service.get(firstActor, ratedFirst.record.match.id)
      const ratedRedId = rated.participants.find((item) => item.side === 'red')!.userId
      const ratedRedActor = ratedRedId === first.id ? firstActor : secondActor
      const ratedResignCommand = randomUUID()
      // A ledger write failure must roll back the outcome, balances and command receipt together.
      await database.query(
        `CREATE TRIGGER reject_test_rating BEFORE INSERT ON rating_ledger
         FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test rating rollback'`,
      )
      try {
        await assert.rejects(
          service.resign(ratedRedActor, {
            matchId: rated.match.id,
            commandId: ratedResignCommand,
            expectedRevision: rated.match.revision,
          }),
        )
        const rolledBack = await service.get(firstActor, rated.match.id)
        assert.equal(rolledBack.match.phase, 'playing')
        assert.equal(rolledBack.match.revision, rated.match.revision)
        assert.deepEqual(await service.ratings(ratedRedActor), [])
        assert.equal(
          await repository.findCommand(rated.match.id, ratedRedActor.userId, ratedResignCommand),
          null,
        )
      } finally {
        await database.query('DROP TRIGGER reject_test_rating')
      }
      const ratedFinished = await service.resign(ratedRedActor, {
        matchId: rated.match.id,
        commandId: ratedResignCommand,
        expectedRevision: rated.match.revision,
      })
      assert.equal(ratedFinished.record.match.status, 'black-wins')
      const redRating = (await service.ratings(ratedRedActor)).find(
        (item) => item.pool === 'xiangqi',
      )!
      const ratedBlackActor = ratedRedId === first.id ? secondActor : firstActor
      const blackRating = (await service.ratings(ratedBlackActor)).find(
        (item) => item.pool === 'xiangqi',
      )!
      assert.deepEqual(
        [redRating.rating, redRating.gamesPlayed, redRating.losses, redRating.provisional],
        [1480, 1, 1, true],
      )
      assert.deepEqual(
        [blackRating.rating, blackRating.gamesPlayed, blackRating.wins, blackRating.provisional],
        [1520, 1, 1, true],
      )
      const repeatedRatedFinish = await service.resign(ratedRedActor, {
        matchId: rated.match.id,
        commandId: ratedResignCommand,
        expectedRevision: rated.match.revision,
      })
      assert.equal(repeatedRatedFinish.duplicate, true)
      const ratedRematch = await service.rematch(ratedRedActor, rated.match.id)
      assert.equal(ratedRematch.match.competitionMode, 'casual')
      assert.equal(ratedRematch.match.matchmaking, false)
      assert.equal((await service.ratings(ratedRedActor))[0]?.gamesPlayed, 1)
      const voidResults = await Promise.all([
        repository.voidRatingSettlement(rated.match.id, '集成测试作废'),
        repository.voidRatingSettlement(rated.match.id, '并发作废'),
      ])
      assert.deepEqual(voidResults.sort(), [false, true])
      assert.equal(await repository.voidRatingSettlement(rated.match.id, '重复作废'), false)
      assert.deepEqual(
        (await service.ratings(ratedRedActor)).map((item) => [item.rating, item.gamesPlayed]),
        [[1500, 0]],
      )
      assert.equal(
        Number(
          (
            await database.query<{ count: string }>(
              'SELECT COUNT(*) AS count FROM rating_ledger WHERE match_id = ?',
              [rated.match.id],
            )
          ).rows[0].count,
        ),
        4,
      )

      const boundedQueue = new OnlineMatchService(repository, { maxMatchmakingQueueEntries: 1 })
      await boundedQueue.quickMatch(outsiderActor, {
        variant: 'gomoku',
        gomokuRule: 'freestyle',
        requestKey: randomUUID(),
      })
      await assert.rejects(
        boundedQueue.safe(() =>
          boundedQueue.quickMatch(firstActor, {
            variant: 'jieqi',
            requestKey: randomUUID(),
          }),
        ),
        (error: unknown) =>
          error instanceof Error && 'code' in error && error.code === 'matchmaking_queue_full',
      )
      await boundedQueue.cancelMatchmaking(outsiderActor)

      const redId = paired.participants.find((item) => item.side === 'red')!.userId!
      const redActor = redId === first.id ? firstActor : secondActor
      const blackActor = redId === first.id ? secondActor : firstActor
      const moveCommand = randomUUID()
      const moved = await service.move(redActor, {
        matchId,
        commandId: moveCommand,
        expectedRevision: 1,
        uci: 'a3a4',
        userId: outsider.id,
        role: 'owner',
      })
      assert.equal(moved.record.state.moves.length, 1)
      assert.equal(moved.record.match.revision, 2)
      const replayed = await service.move(redActor, {
        matchId,
        commandId: moveCommand,
        expectedRevision: 1,
        uci: 'a3a4',
      })
      assert.equal(replayed.duplicate, true)
      assert.equal(replayed.record.state.moves.length, 1)
      await assert.rejects(
        service.safe(() =>
          service.move(blackActor, {
            matchId,
            commandId: randomUUID(),
            expectedRevision: 1,
            uci: 'c6c5',
          }),
        ),
        { code: 'revision_conflict' },
      )
      await assert.rejects(
        service.move(outsiderActor, {
          matchId,
          commandId: randomUUID(),
          expectedRevision: 2,
          uci: 'a3a4',
        }),
        { code: 'not_found' },
      )
      await assert.rejects(
        service.ready(outsiderActor, {
          matchId,
          commandId: randomUUID(),
          expectedRevision: 2,
          ready: true,
        }),
        { code: 'not_found' },
      )
      await assert.rejects(
        service.propose(outsiderActor, {
          matchId,
          commandId: randomUUID(),
          expectedRevision: 2,
          kind: 'undo',
        }),
        { code: 'not_found' },
      )

      const chatCommand = randomUUID()
      const firstChat = await service.chat(redActor, matchId, chatCommand, '<b>服务端昵称</b>')
      const repeatedChat = await service.chat(redActor, matchId, chatCommand, '重复载荷不会新增')
      assert.equal(repeatedChat.id, firstChat.id)
      assert.equal(
        repeatedChat.nickname,
        paired.participants.find((item) => item.userId === redId)!.displayNameSnapshot,
      )
      assert.equal((await service.chatHistory(firstActor, matchId)).length, 1)

      const firstHistory = await service.history(firstActor, {})
      const secondHistory = await service.history(secondActor, {})
      const outsiderHistory = await service.history(outsiderActor, {})
      assert.equal(
        firstHistory.matches.some((item) => item.id === matchId),
        true,
      )
      assert.equal(
        secondHistory.matches.some((item) => item.id === matchId),
        true,
      )
      assert.equal(
        outsiderHistory.matches.some((item) => item.id === matchId),
        false,
      )
      const restrictedFirstActor: OnlineActor = {
        ...firstActor,
        capabilities: ['online:history'],
      }
      const restrictedOutsiderActor: OnlineActor = {
        ...outsiderActor,
        capabilities: ['online:history'],
      }
      assert.equal((await service.read(restrictedFirstActor, matchId)).match.id, matchId)
      await assert.rejects(service.read(restrictedOutsiderActor, matchId), { code: 'not_found' })
      assert.equal(
        (await service.history(firstActor, { from: '2999-01-01T00:00:00.000Z' })).matches.length,
        0,
      )
      assert.equal(
        (await service.history(firstActor, { to: '2000-01-01T00:00:00.000Z' })).matches.length,
        0,
      )

      const privateMatch = await service.create(firstActor, {
        name: '仅邀请可见棋局',
        variant: 'jieqi',
        visibility: 'private',
        side: 'red',
      })
      await assert.rejects(service.get(outsiderActor, privateMatch.match.id), { code: 'not_found' })
      await assert.rejects(service.chatHistory(outsiderActor, privateMatch.match.id), {
        code: 'not_found',
      })
      const invite = await service.createInvite(firstActor, privateMatch.match.id)
      const invited = await service.joinInvite(secondActor, invite.token)
      assert.equal(
        invited.participants.some((item) => item.userId === second.id),
        true,
      )
      await assert.rejects(service.joinInvite(outsiderActor, invite.token), { code: 'not_found' })
      const firstReady = await service.ready(firstActor, {
        matchId: privateMatch.match.id,
        commandId: randomUUID(),
        expectedRevision: 0,
        ready: true,
      })
      const secondReady = await service.ready(secondActor, {
        matchId: privateMatch.match.id,
        commandId: randomUUID(),
        expectedRevision: firstReady.record.match.revision,
        ready: true,
      })
      assert.equal(secondReady.record.match.phase, 'playing')
      const proposed = await service.propose(firstActor, {
        matchId: privateMatch.match.id,
        commandId: randomUUID(),
        expectedRevision: secondReady.record.match.revision,
        kind: 'draw',
      })
      const agreed = await service.respondProposal(secondActor, {
        matchId: privateMatch.match.id,
        commandId: randomUUID(),
        expectedRevision: proposed.record.match.revision,
        proposalId: proposed.record.proposal!.id,
        accept: true,
      })
      assert.equal(agreed.record.match.statusReason, 'agreement')
      const rematch = await service.rematch(firstActor, privateMatch.match.id)
      assert.equal(rematch.match.previousMatchId, privateMatch.match.id)

      const lobbyMatch = await service.create(firstActor, {
        name: '大厅 DTO 测试',
        variant: 'xiangqi',
        visibility: 'public',
        side: 'red',
      })
      const lobbyItem = (await service.lobby(firstActor, {})).find(
        (item) => item.id === lobbyMatch.match.id,
      )!
      assert.deepEqual(lobbyItem.openSeats, ['black'])
      assert.equal('visibility' in lobbyItem, false)

      const waiting = await service.quickMatch(firstActor, {
        variant: 'gomoku',
        gomokuRule: 'renju',
        requestKey: randomUUID(),
      })
      const repeatedWaiting = await service.quickMatch(firstActor, {
        variant: 'gomoku',
        gomokuRule: 'renju',
        requestKey: randomUUID(),
      })
      assert.equal(repeatedWaiting.record.match.id, waiting.record.match.id)
      assert.equal((await service.cancelMatchmaking(firstActor)).cancelled, true)
      assert.equal((await service.cancelMatchmaking(firstActor)).cancelled, false)

      const [gomokuFirst, gomokuSecond] = await Promise.all([
        service.quickMatch(firstActor, {
          variant: 'gomoku',
          gomokuRule: 'renju',
          requestKey: randomUUID(),
        }),
        service.quickMatch(secondActor, {
          variant: 'gomoku',
          gomokuRule: 'renju',
          requestKey: randomUUID(),
        }),
      ])
      assert.equal(gomokuFirst.record.match.id, gomokuSecond.record.match.id)
      const gomokuRecord = await service.get(firstActor, gomokuFirst.record.match.id)
      const gomokuRedId = gomokuRecord.participants.find((item) => item.side === 'red')!.userId
      const gomokuMoved = await service.move(gomokuRedId === first.id ? firstActor : secondActor, {
        matchId: gomokuFirst.record.match.id,
        commandId: randomUUID(),
        expectedRevision: 1,
        row: 7,
        col: 7,
      })
      assert.equal(gomokuMoved.record.state.moves.length, 1)

      const [jieqiFirst, jieqiSecond] = await Promise.all([
        service.quickMatch(firstActor, { variant: 'jieqi', requestKey: randomUUID() }),
        service.quickMatch(secondActor, { variant: 'jieqi', requestKey: randomUUID() }),
      ])
      assert.equal(jieqiFirst.record.match.id, jieqiSecond.record.match.id)
      const jieqiRecord = await service.get(firstActor, jieqiFirst.record.match.id)
      const jieqiRedId = jieqiRecord.participants.find((item) => item.side === 'red')!.userId
      const jieqiMoved = await service.move(jieqiRedId === first.id ? firstActor : secondActor, {
        matchId: jieqiFirst.record.match.id,
        commandId: randomUUID(),
        expectedRevision: 1,
        uci: 'a3a4',
      })
      assert.equal(jieqiMoved.record.state.moves.length, 1)
      assert.equal(
        (await repository.recoverActiveMatches()).some((item) => item.match.id === matchId),
        true,
      )
      const deletionChanges = await repository.cleanupUserActivityForDeletion(first.id)
      assert.equal(
        deletionChanges.some(
          (item) => item.match.phase === 'finished' && item.match.statusReason === 'disconnect',
        ),
        true,
      )
      assert.equal(
        Number(
          (
            await database.query<{ count: string }>(
              `SELECT COUNT(*) AS count FROM match_participants p
               JOIN matches m ON m.id = p.match_id
               WHERE p.user_id = ? AND p.left_at IS NULL
                 AND m.phase IN ('waiting', 'playing')`,
              [first.id],
            )
          ).rows[0].count,
        ),
        0,
      )
      assert.equal(
        Number(
          (
            await database.query<{ count: string }>(
              'SELECT COUNT(*) AS count FROM matchmaking_entries WHERE user_id = ?',
              [first.id],
            )
          ).rows[0].count,
        ),
        0,
      )
    })
  },
)

test(
  'every private resource enforces owner-scoped CRUD, export, deduplication, and references',
  integration,
  async () => {
    await withTestDatabase(async (database) => {
      await migrate(database)
      const accounts = new MySqlAccountRepository(database)
      const createAccount = (suffix: string) =>
        accounts.create({
          emailNormalized: `documents-${suffix}@example.com`,
          emailDisplay: `documents-${suffix}@example.com`,
          displayName: `文档棋手${suffix}`,
          passwordHash: `$argon2id$documents-placeholder-${suffix}`,
          passwordHashVersion: 1,
          verificationTokenHash: randomBytes(32),
          verificationExpiresAt: new Date(Date.now() + 86_400_000),
        })
      const [first, second] = await Promise.all([createAccount('a'), createAccount('b')])
      await database.query("UPDATE users SET status = 'active'")
      const firstDocuments: Array<{
        resource: (typeof USER_DOCUMENT_RESOURCES)[number]
        repository: MySqlUserDocumentRepository<Record<string, unknown>>
        id: string
        revision: number
      }> = []

      for (const resource of USER_DOCUMENT_RESOURCES) {
        const definition = userDocumentDefinition(resource)!
        const repository = new MySqlUserDocumentRepository<Record<string, unknown>>(
          database,
          definition.resource,
          definition.schemaVersion,
          definition.validate,
          definition.maxDocuments,
          definition.logicalKey,
        )
        const firstPayload = resourcePayload(resource, 'a')
        const secondPayload = resourcePayload(resource, 'b')
        const created = await repository.create(first.id, firstPayload, randomUUID())
        const duplicate = await repository.create(first.id, firstPayload, randomUUID())
        assert.equal(duplicate.id, created.id, `${resource} logical key must deduplicate per owner`)
        const secondCreated = await repository.create(second.id, secondPayload, randomUUID())
        assert.notEqual(secondCreated.id, created.id)
        assert.deepEqual(
          (await repository.list(second.id)).map((document) => document.ownerUserId),
          [second.id],
        )
        assert.equal(await repository.find(second.id, created.id), null)
        await assert.rejects(
          repository.update(second.id, created.id, 0, firstPayload, randomUUID()),
          RepositoryNotFoundError,
        )
        await assert.rejects(
          repository.delete(second.id, created.id, 0, randomUUID()),
          RepositoryNotFoundError,
        )
        const updated = await repository.update(first.id, created.id, 0, firstPayload, randomUUID())
        firstDocuments.push({ resource, repository, id: created.id, revision: updated.revision })
      }

      const training = resourcePayload('training-tasks', 'a')
      assert.equal(await userDocumentSourceAccessible(database, first.id, training), true)
      assert.equal(await userDocumentSourceAccessible(database, second.id, training), false)
      const exported = await new MySqlAccountDataService(database).export(first.id)
      assert.equal((exported.privateDocuments as unknown[]).length, USER_DOCUMENT_RESOURCES.length)

      for (const document of firstDocuments) {
        await document.repository.delete(first.id, document.id, document.revision, randomUUID())
        assert.equal(await document.repository.find(first.id, document.id), null)
      }
    })
  },
)

test(
  'due account deletion removes private data and anonymizes retained shared history',
  integration,
  async () => {
    await withTestDatabase(async (database) => {
      await migrate(database)
      const accounts = new MySqlAccountRepository(database)
      const account = await accounts.create({
        emailNormalized: 'delete-me@example.com',
        emailDisplay: 'delete-me@example.com',
        displayName: '待删除棋手',
        passwordHash: '$argon2id$deletion-placeholder-hash',
        passwordHashVersion: 1,
        verificationTokenHash: randomBytes(32),
        verificationExpiresAt: new Date(Date.now() + 86_400_000),
      })
      await database.query("UPDATE users SET status = 'active' WHERE id = ?", [account.id])
      const documents = new MySqlUserDocumentRepository(database, 'studies', 1, objectState)
      await documents.create(account.id, { id: 'private-study' }, randomUUID())

      const matchId = randomUUID()
      await database.query(
        `INSERT INTO matches
        (id, variant, matchmaking, visibility, phase, status, created_by_user_id, expires_at)
       VALUES (?, 'xiangqi', false, 'private', 'finished', 'draw', ?, ?)`,
        [matchId, account.id, new Date(Date.now() + 86_400_000)],
      )
      await database.query(
        `INSERT INTO match_participants
        (id, match_id, user_id, side, is_owner, display_name_snapshot, ready, left_at)
       VALUES (?, ?, ?, 'red', true, '待删除棋手', true, CURRENT_TIMESTAMP(6))`,
        [randomUUID(), matchId, account.id],
      )
      await database.query(
        `INSERT INTO match_states
        (match_id, schema_version, revision, public_state, referee_state)
       VALUES (?, 1, 0, JSON_OBJECT('moves', JSON_ARRAY()), JSON_OBJECT('moves', JSON_ARRAY()))`,
        [matchId],
      )

      const service = new MySqlAccountDataService(database)
      const exported = await service.export(account.id)
      assert.equal((exported.privateDocuments as unknown[]).length, 1)
      assert.equal((exported.sharedMatchViews as unknown[]).length, 1)
      assert.equal(JSON.stringify(exported).includes('refereeState'), false)
      const impact = await service.deletionImpact(account.id)
      assert.equal(impact.privateDocumentTotal, 1)
      assert.equal(impact.sharedMatchesToAnonymize, 1)

      const due = new Date(Date.now() - 1_000)
      await database.query(
        `UPDATE users SET status = 'pending_deletion', deletion_requested_at = ?, deletion_due_at = ?
       WHERE id = ?`,
        [new Date(due.getTime() - 1_000), due, account.id],
      )
      assert.deepEqual(await service.pendingDeletionUserIds(null, 1), [account.id])
      assert.deepEqual(await service.pendingDeletionUserIds(account.id, 1), [])
      assert.equal(await service.cleanupDue(new Date()), 1)
      assert.equal(await service.cleanupDue(new Date()), 0)
      assert.equal(
        Number(
          (
            await database.query<{ count: string }>(
              'SELECT COUNT(*) AS count FROM users WHERE id = ?',
              [account.id],
            )
          ).rows[0].count,
        ),
        0,
      )
      assert.equal(
        Number(
          (
            await database.query<{ count: string }>(
              'SELECT COUNT(*) AS count FROM user_documents WHERE owner_user_id = ?',
              [account.id],
            )
          ).rows[0].count,
        ),
        0,
      )
      const participant = await database.query<{
        user_id: string | null
        display_name_snapshot: string
        anonymized_at: Date | null
      }>(
        'SELECT user_id, display_name_snapshot, anonymized_at FROM match_participants WHERE match_id = ?',
        [matchId],
      )
      assert.equal(participant.rows[0].user_id, null)
      assert.equal(participant.rows[0].display_name_snapshot, '已注销棋手')
      assert.ok(participant.rows[0].anonymized_at)
      assert.equal(
        Number(
          (
            await database.query<{ count: string }>(
              'SELECT COUNT(*) AS count FROM matches WHERE id = ?',
              [matchId],
            )
          ).rows[0].count,
        ),
        1,
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
    assert.deepEqual(await migrate(database), [2, 3, 4, 5, 6, 7, 8, 9])
    assert.equal((await migrationStatus(database)).currentVersion, 9)
  })
})

test(
  'automatic rated timeout survives transaction failure and restore checker rejects corrupted data',
  integration,
  async () => {
    await withTestDatabase(async (database) => {
      await migrate(database)
      const accounts = new MySqlAccountRepository(database)
      const users = await Promise.all(
        [1, 2].map((i) =>
          accounts.create({
            emailNormalized: `recovery-${i}@example.com`,
            emailDisplay: `recovery-${i}@example.com`,
            displayName: `恢复棋手${i}`,
            passwordHash: '$argon2id$placeholder',
            passwordHashVersion: 1,
            verificationTokenHash: randomBytes(32),
            verificationExpiresAt: new Date(Date.now() + 86400000),
          }),
        ),
      )
      await database.query("UPDATE users SET status='active'")
      const actors = users.map(
        (user) =>
          ({
            userId: user.id,
            sessionId: randomUUID(),
            ipKey: 'test',
            capabilities: ['online:play', 'online:watch'],
          }) as OnlineActor,
      )
      const repository = new MySqlOnlineMatchRepository(database),
        service = new OnlineMatchService(repository)
      const pair = await Promise.all(
        actors.map((actor) =>
          service.quickMatch(actor, {
            variant: 'xiangqi',
            competitionMode: 'rated',
            clockPreset: '10m',
            requestKey: randomUUID(),
          }),
        ),
      )
      const id = pair[0].record.match.id
      const deadline = new Date(Date.now() - 100).toISOString()
      await database.query(
        "UPDATE match_states SET referee_state=JSON_SET(referee_state,'$.clock.deadlineAt',?) WHERE match_id=?",
        [deadline, id],
      )
      const before = await repository.recoverActiveMatches()
      await database.query(
        `CREATE TRIGGER recovery_rating_fault BEFORE INSERT ON rating_ledger FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected settlement failure'`,
      )
      const manager = new OnlineMatchManager(service, 60000, 50, 2, 50, 10)
      try {
        await manager.restore()
        await new Promise((resolve) => setTimeout(resolve, 60))
        const rolledBack = await service.get(actors[0], id)
        assert.equal(rolledBack.match.phase, 'playing')
        assert.equal(rolledBack.match.revision, before[0].match.revision)
        await database.query('DROP TRIGGER recovery_rating_fault')
        const end = Date.now() + 3000
        // Only the manager accesses the match during this wait; the assertion reads SQL metadata.
        let finished = false
        while (Date.now() < end) {
          const result = await database.query<{ phase: string }>(
            'SELECT phase FROM matches WHERE id=?',
            [id],
          )
          if (result.rows[0].phase === 'finished') {
            finished = true
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        assert.ok(finished)
        const settled = await service.get(actors[0], id)
        assert.equal(settled.match.revision, before[0].match.revision + 1)
        await Promise.all([
          repository.adjudicateClock(id, deadline),
          repository.adjudicateDisconnect(id, users[0].id, new Date(0)),
        ])
        assert.equal((await service.get(actors[0], id)).match.revision, settled.match.revision)
        assert.equal((await verifyRestoredDatabase(database)).ok, true)
        const racePair = await Promise.all(
          actors.map((actor) =>
            service.quickMatch(actor, {
              variant: 'xiangqi',
              clockPreset: '10m',
              requestKey: randomUUID(),
            }),
          ),
        )
        const raceId = racePair[0].record.match.id
        const race = await service.get(actors[0], raceId)
        const redId = race.participants.find((p) => p.side === 'red')!.userId
        const redActor = actors.find((a) => a.userId === redId)!
        await database.query(
          "UPDATE match_states SET referee_state=JSON_SET(referee_state,'$.clock.deadlineAt',?) WHERE match_id=?",
          [deadline, raceId],
        )
        const offline = new Date(Date.now() - 100)
        await repository.setPresence(raceId, redActor.userId, false, offline)
        await Promise.allSettled([
          repository.adjudicateClock(raceId, deadline),
          repository.adjudicateDisconnect(raceId, redActor.userId, offline),
          service.move(redActor, {
            matchId: raceId,
            commandId: randomUUID(),
            expectedRevision: race.match.revision,
            uci: 'a0a1',
          }),
        ])
        const raceFinished = await service.get(redActor, raceId)
        assert.equal(raceFinished.match.phase, 'finished')
        assert.equal(raceFinished.match.revision, race.match.revision + 1)
        assert.equal(raceFinished.state.moves.length, 0)
        assert.equal((await verifyRestoredDatabase(database)).ok, true)

        await database.query('UPDATE user_ratings SET rating=rating+1 WHERE user_id=?', [
          users[0].id,
        ])
        await assert.rejects(verifyRestoredDatabase(database), /rating_balances/)
        await new Promise<void>((resolve, reject) => {
          execFile(
            process.execPath,
            ['--import', 'tsx', 'src/db/restore-verify-cli.ts'],
            {
              env: {
                ...process.env,
                DATABASE_URL: database.config.connectionString,
                ONLINE_DATABASE_ENABLED: 'true',
                NODE_ENV: 'development',
                DATABASE_SSL_MODE: 'disable',
              },
            },
            (error, stdout, stderr) => {
              try {
                assert.equal(error?.code, 1)
                assert.equal(stdout, '')
                assert.match(stderr, /Restore consistency verification failed/)
                resolve()
              } catch (failure) {
                reject(failure)
              }
            },
          )
        })
        await database.query('UPDATE user_ratings SET rating=rating-1 WHERE user_id=?', [
          users[0].id,
        ])
        await database.query(
          "UPDATE match_states SET public_state=JSON_SET(public_state,'$.initialLayout','leaked') WHERE match_id=?",
          [id],
        )
        await assert.rejects(verifyRestoredDatabase(database), /projection/)
        await database.query(
          "UPDATE match_states SET public_state=JSON_REMOVE(public_state,'$.initialLayout') WHERE match_id=?",
          [id],
        )
        await database.query('DELETE FROM match_states WHERE match_id=?', [id])
        await assert.rejects(verifyRestoredDatabase(database), /match_states/)
      } finally {
        manager.dispose()
      }
    })
  },
)

test(
  'rated disconnect settlement is atomic and idempotent even before the first move',
  integration,
  async () => {
    await withTestDatabase(async (database) => {
      await migrate(database)
      const accounts = new MySqlAccountRepository(database)
      const users = await Promise.all(
        [1, 2].map((i) =>
          accounts.create({
            emailNormalized: `disconnect-${i}@example.com`,
            emailDisplay: `disconnect-${i}@example.com`,
            displayName: `断线棋手${i}`,
            passwordHash: '$argon2id$placeholder',
            passwordHashVersion: 1,
            verificationTokenHash: randomBytes(32),
            verificationExpiresAt: new Date(Date.now() + 86400000),
          }),
        ),
      )
      await database.query("UPDATE users SET status='active'")
      const actors: OnlineActor[] = users.map((u) => ({
        userId: u.id,
        sessionId: randomUUID(),
        ipKey: 'test',
        capabilities: ['online:play', 'online:watch'],
      }))
      const repository = new MySqlOnlineMatchRepository(database)
      const service = new OnlineMatchService(repository)
      for (const bothOffline of [false, true]) {
        const pair = await Promise.all(
          actors.map((actor) =>
            service.quickMatch(actor, {
              variant: 'xiangqi',
              competitionMode: 'rated',
              clockPreset: '10m',
              requestKey: randomUUID(),
            }),
          ),
        )
        const source = await service.get(actors[0], pair[0].record.match.id)
        const id = source.match.id
        const redId = source.participants.find((p) => p.side === 'red')!.userId
        assert.ok(redId)
        const deadline = new Date(Date.now() - 100)
        await repository.setPresence(id, redId, false, deadline)
        if (bothOffline) {
          await repository.setPresence(id, users.find((u) => u.id !== redId)!.id, false, deadline)
        } else {
          await database.query(
            "CREATE TRIGGER disconnect_rating_fault BEFORE INSERT ON rating_ledger FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected settlement failure'",
          )
          await assert.rejects(repository.adjudicateDisconnect(id, redId, deadline))
          const rollback = await service.get(actors[0], id)
          assert.equal(rollback.match.phase, 'playing')
          assert.equal(rollback.match.revision, source.match.revision)
          assert.deepEqual(await service.ratings(actors[0]), [])
          await database.query('DROP TRIGGER disconnect_rating_fault')
        }
        const results = await Promise.all([
          repository.adjudicateDisconnect(id, redId, deadline),
          repository.adjudicateDisconnect(id, redId, deadline),
        ])
        assert.equal(results.filter(Boolean).length, 1)
        const finished = await service.get(actors[0], id)
        assert.equal(finished.match.statusReason, bothOffline ? 'abandoned' : 'disconnect')
        assert.equal(finished.match.status, bothOffline ? 'draw' : 'black-wins')
        for (const actor of actors) {
          const ratings = await service.ratings(actor)
          assert.equal(ratings[0].gamesPlayed, 1)
          if (!bothOffline) assert.equal(ratings[0].rating, actor.userId === redId ? 1480 : 1520)
        }
        assert.equal((await verifyRestoredDatabase(database)).ok, true)
      }
    })
  },
)

test(
  'matchmaking fairness persists across sessions, clock switches and concurrent cancellation',
  integration,
  async () => {
    await withTestDatabase(async (database) => {
      await migrate(database)
      const accounts = new MySqlAccountRepository(database)
      const users = await Promise.all(
        [1, 2, 3, 4].map((i) =>
          accounts.create({
            emailNormalized: `fair-${i}@example.com`,
            emailDisplay: `fair-${i}@example.com`,
            displayName: `公平棋手${i}`,
            passwordHash: '$argon2id$placeholder',
            passwordHashVersion: 1,
            verificationTokenHash: randomBytes(32),
            verificationExpiresAt: new Date(Date.now() + 86400000),
          }),
        ),
      )
      await database.query("UPDATE users SET status='active'")
      const actors: OnlineActor[] = users.map((u) => ({
        userId: u.id,
        sessionId: randomUUID(),
        ipKey: 'test',
        capabilities: ['online:play', 'online:watch'],
      }))
      let service = new OnlineMatchService(new MySqlOnlineMatchRepository(database))
      const quick = (index: number, overrides: Record<string, unknown> = {}) =>
        service.quickMatch(
          { ...actors[index], sessionId: randomUUID() },
          {
            variant: 'xiangqi',
            gomokuRule: 'freestyle',
            competitionMode: 'rated',
            clockPreset: '10m',
            requestKey: randomUUID(),
            ...overrides,
          },
        )
      const recentIds: string[] = []
      for (const clockPreset of ['10m', '15m-10s', '30m']) {
        const pair = await Promise.all([quick(0, { clockPreset }), quick(1, { clockPreset })])
        assert.equal(pair[0].record.match.id, pair[1].record.match.id)
        recentIds.push(pair[0].record.match.id)
      }
      // Even uncompleted games count, preventing simultaneous games bypassing a settlement-only cap.
      service = new OnlineMatchService(new MySqlOnlineMatchRepository(database))
      const blocked = await Promise.all([quick(0), quick(1)])
      assert.notEqual(blocked[0].record.match.id, blocked[1].record.match.id)
      assert.equal(blocked[0].record.match.phase, 'waiting')
      assert.equal(blocked[1].record.match.phase, 'waiting')
      const third = await quick(2)
      assert.ok(blocked.some((r) => r.record.match.id === third.record.match.id))
      const remaining = blocked.findIndex((r) => r.record.match.id !== third.record.match.id)
      await service.cancelMatchmaking(actors[remaining])
      // Pool and casual boundaries remain independent.
      for (const overrides of [
        { competitionMode: 'casual' },
        { variant: 'jieqi' },
        { variant: 'gomoku', gomokuRule: 'renju' },
      ]) {
        const pair = await Promise.all([quick(0, overrides), quick(1, overrides)])
        assert.equal(pair[0].record.match.id, pair[1].record.match.id)
      }
      await database.query('UPDATE matches SET started_at = ? WHERE id IN (?, ?, ?)', [
        new Date(Date.now() - 86400001),
        ...recentIds,
      ])
      const renewed = await Promise.all([quick(0), quick(1)])
      assert.equal(renewed[0].record.match.id, renewed[1].record.match.id)

      // Switching conditions or retrying from another tab keeps the existing sole queue entry.
      const queued = await quick(3)
      const switched = await Promise.all([
        quick(3, { variant: 'jieqi' }),
        quick(3, { competitionMode: 'casual' }),
      ])
      assert.ok(switched.every((r) => r.record.match.id === queued.record.match.id))
      const cancelResults = await Promise.all([
        service.cancelMatchmaking(actors[3]),
        service.cancelMatchmaking(actors[3]),
      ])
      assert.equal(cancelResults.filter((r) => r.cancelled).length, 1)
      for (let i = 1; i < 5; i++) {
        await quick(3, { variant: i % 2 ? 'gomoku' : 'jieqi' })
        assert.equal((await service.cancelMatchmaking(actors[3])).cancelled, true)
      }
      assert.equal((await service.cancelMatchmaking(actors[3])).cancelled, false)
      const limit = await database.query<{ cancellation_count: number }>(
        'SELECT cancellation_count FROM matchmaking_cancellation_limits WHERE user_id = ?',
        [actors[3].userId],
      )
      assert.equal(limit.rows[0].cancellation_count, 5)
      service = new OnlineMatchService(new MySqlOnlineMatchRepository(database))
      for (const overrides of [{}, { variant: 'gomoku' }, { competitionMode: 'casual' }]) {
        await assert.rejects(
          service.safe(() => quick(3, overrides)),
          (error: unknown) =>
            error instanceof Error &&
            'code' in error &&
            error.code === 'matchmaking_cooldown' &&
            'retryAfterSeconds' in error &&
            Number(error.retryAfterSeconds) > 0,
        )
      }
      await database.query(
        'UPDATE matchmaking_cancellation_limits SET window_started_at = ?, blocked_until = ? WHERE user_id = ?',
        [new Date(Date.now() - 1200000), new Date(Date.now() - 1), actors[3].userId],
      )
      const requestKey = randomUUID()
      const resumed = await quick(3, { requestKey })
      assert.equal((await quick(3, { requestKey })).record.match.id, resumed.record.match.id)
      await service.cancelMatchmaking(actors[3])
      const reset = await database.query<{ cancellation_count: number }>(
        'SELECT cancellation_count FROM matchmaking_cancellation_limits WHERE user_id = ?',
        [actors[3].userId],
      )
      assert.equal(reset.rows[0].cancellation_count, 1)
      const raceQueue = await quick(3)
      const [cancelRace, joinRace] = await Promise.all([
        service.cancelMatchmaking(actors[3]),
        quick(0),
      ])
      if (cancelRace.cancelled) {
        assert.notEqual(joinRace.record.match.id, raceQueue.record.match.id)
        assert.equal(joinRace.record.match.phase, 'waiting')
      } else {
        assert.equal(joinRace.record.match.id, raceQueue.record.match.id)
        assert.equal(joinRace.record.match.phase, 'playing')
        assert.equal(
          (await service.get(actors[3], raceQueue.record.match.id)).participants.filter(
            (p) => p.side,
          ).length,
          2,
        )
      }
      const finalCount = await database.query<{ cancellation_count: number }>(
        'SELECT cancellation_count FROM matchmaking_cancellation_limits WHERE user_id = ?',
        [actors[3].userId],
      )
      assert.equal(finalCount.rows[0].cancellation_count, cancelRace.cancelled ? 2 : 1)
    })
  },
)

test(
  'B completion: authorized rating pages, invalid eligibility, interruption audit and account engine guard',
  integration,
  async () => {
    await withTestDatabase(async (database) => {
      await migrate(database)
      const accounts = new MySqlAccountRepository(database)
      const users = await Promise.all(
        [1, 2, 3].map((i) =>
          accounts.create({
            emailNormalized: `b-complete-${i}@example.com`,
            emailDisplay: `b-complete-${i}@example.com`,
            displayName: `排位棋手${i}`,
            passwordHash: '$argon2id$placeholder',
            passwordHashVersion: 1,
            verificationTokenHash: randomBytes(32),
            verificationExpiresAt: new Date(Date.now() + 86400000),
          }),
        ),
      )
      await database.query("UPDATE users SET status = 'active'")
      const actors = users.map((u) => ({
        kind: 'user' as const,
        userId: u.id,
        sessionId: randomUUID(),
        ipKey: 'test',
        capabilities: ['online:play', 'online:watch'],
        requestId: 'test',
        authEpoch: 1,
        expiresAt: new Date(Date.now() + 60000),
        status: 'active' as const,
      }))
      const repository = new MySqlOnlineMatchRepository(database)
      const service = new OnlineMatchService(repository)
      const pair = async (variant = 'xiangqi', competitionMode = 'rated') => {
        const first = await service.quickMatch(actors[0], {
          variant,
          competitionMode,
          clockPreset: '10m',
          gomokuRule: 'freestyle',
          requestKey: randomUUID(),
        })
        await service.quickMatch(actors[1], {
          variant,
          competitionMode,
          clockPreset: '10m',
          gomokuRule: 'freestyle',
          requestKey: randomUUID(),
        })
        return service.get(actors[0], first.record.match.id)
      }
      assert.equal(await repository.hasActiveRatedMatch(users[0].id), false)
      const played = await pair()
      assert.equal(await repository.hasActiveRatedMatch(users[0].id), true)
      assert.equal(await repository.hasActiveRatedMatch(users[1].id), true)
      assert.equal(await repository.hasActiveRatedMatch(users[2].id), false)
      assert.equal((await service.ratingDetail(actors[0], played.match.id)).state, 'pending')
      await service.resign(actors[0], {
        matchId: played.match.id,
        expectedRevision: played.match.revision,
        commandId: randomUUID(),
      })
      assert.equal(await repository.hasActiveRatedMatch(users[0].id), false)
      assert.equal((await service.ratingDetail(actors[0], played.match.id)).delta, -20)
      await repository.voidRatingSettlement(played.match.id, '测试服务故障补偿')
      const detail = await service.ratingDetail(actors[0], played.match.id)
      assert.equal(detail.state, 'voided')
      assert.equal(detail.before, 1500)
      assert.equal(detail.after, 1480)
      assert.equal(detail.voidReason, '测试服务故障补偿')
      await assert.rejects(service.ratingDetail(actors[2], played.match.id))
      // Identical microsecond timestamps must still paginate without duplicates or omissions.
      await database.query('UPDATE rating_ledger SET created_at = ?', [
        new Date('2026-09-01T00:00:00Z'),
      ])
      const page1 = await service.ratingLedger(actors[0], { limit: 1 })
      assert.equal(page1.entries.length, 1)
      assert.ok(page1.nextCursor)
      const page2 = await service.ratingLedger(actors[0], { limit: 1, cursor: page1.nextCursor })
      assert.equal(page2.entries.length, 1)
      assert.notEqual(page1.entries[0].id, page2.entries[0].id)
      assert.equal(page2.nextCursor, undefined)
      assert.deepEqual(
        new Set([...page1.entries, ...page2.entries].map((e) => e.type)),
        new Set(['settlement', 'void']),
      )
      assert.ok([...page1.entries, ...page2.entries].every((e) => e.voided))
      await assert.rejects(service.ratingLedger(actors[2], { cursor: page1.nextCursor }))
      assert.deepEqual((await service.ratingLedger(actors[2], {})).entries, [])
      await assert.rejects(service.ratingLedger(actors[0], { limit: 101 }))

      const adminGame = await pair()
      await service.propose(actors[0], {
        matchId: adminGame.match.id,
        expectedRevision: adminGame.match.revision,
        commandId: randomUUID(),
        kind: 'draw',
      })
      const stopped = await repository.interruptMatch(
        adminGame.match.id,
        'admin_abort',
        'operator-test',
        '管理员中止测试',
      )
      assert.equal(stopped!.match.statusReason, 'abandoned')
      assert.equal(stopped!.proposal, null)
      assert.equal(
        await repository.interruptMatch(adminGame.match.id, 'admin_abort', 'operator-test', '重复'),
        null,
      )
      assert.equal(
        (await service.ratingDetail(actors[0], adminGame.match.id)).reason,
        'admin_abort',
      )
      const restarted = await pair()
      const casual = await pair('xiangqi', 'casual')
      await repository.interruptRatedAfterRestart()
      await repository.interruptRatedAfterRestart()
      assert.equal((await service.get(actors[0], restarted.match.id)).match.phase, 'finished')
      assert.equal(
        (await service.ratingDetail(actors[0], restarted.match.id)).reason,
        'service_restart',
      )
      assert.equal((await service.get(actors[0], casual.match.id)).match.phase, 'playing')
      assert.equal((await service.ratings(actors[0]))[0].gamesPlayed, 0)
      const audit = await database.query<{ operator_name: string }>(
        'SELECT operator_name FROM match_interruptions WHERE match_id = ?',
        [adminGame.match.id],
      )
      assert.equal(audit.rows[0].operator_name, 'operator-test')
      const invalid = await pair('jieqi')
      await database.query(
        'UPDATE match_participants SET user_id = NULL WHERE match_id = ? AND user_id = ?',
        [invalid.match.id, users[1].id],
      )
      await service.resign(actors[0], {
        matchId: invalid.match.id,
        expectedRevision: invalid.match.revision,
        commandId: randomUUID(),
      })
      assert.equal(
        (await service.ratingDetail(actors[0], invalid.match.id)).reason,
        'ineligible_or_legacy',
      )

      const failedService = await pair('gomoku')
      await repository.interruptMatch(
        failedService.match.id,
        'service_failure',
        'automatic-recovery',
        '数据库中断',
      )
      assert.equal(
        (await service.ratingDetail(actors[0], failedService.match.id)).reason,
        'service_failure',
      )
      const race = await pair('gomoku')
      const deadline = new Date(Date.now() - 100).toISOString()
      await database.query(
        "UPDATE match_states SET referee_state = JSON_SET(referee_state, '$.clock.deadlineAt', ?) WHERE match_id = ?",
        [deadline, race.match.id],
      )
      const raced = await Promise.all([
        repository.interruptMatch(race.match.id, 'admin_abort', 'operator-test', '并发中止'),
        repository.adjudicateClock(race.match.id, deadline),
      ])
      assert.equal(raced.filter(Boolean).length, 1)
      const raceDetail = await service.ratingDetail(actors[0], race.match.id)
      assert.equal(raceDetail.state, raced[0] ? 'unrated' : 'settled')

      const { createOnlineRouters } = await import('../online/routes.js')
      const app = express()
      app.use((request, response, next) => {
        response.locals.testActor = actors[Number(request.headers['x-test-user'] || 0)]
        next()
      })
      const current = (response: express.Response) =>
        response.locals.testActor as (typeof actors)[number]
      const routers = createOnlineRouters(service, {
        currentActor: current,
        requireUser: current,
        requireCsrf: (_r, response) => current(response),
      })
      app.use('/api/me/ratings', routers.meRatingsRouter)
      app.use('/api/online', routers.router)
      app.use(routers.errorMiddleware)
      const http = createServer(app)
      await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
      const base = `http://127.0.0.1:${(http.address() as import('node:net').AddressInfo).port}`
      try {
        const mine = await fetch(`${base}/api/me/ratings/matches/${played.match.id}`)
        assert.equal(mine.status, 200)
        assert.equal((await mine.json()).state, 'voided')
        const denied = await fetch(`${base}/api/me/ratings/matches/${played.match.id}`, {
          headers: { 'x-test-user': '2' },
        })
        assert.equal(denied.status, 404)
        const malicious = await fetch(`${base}/api/me/ratings/ledger?userId=${users[0].id}`, {
          headers: { 'x-test-user': '2' },
        })
        assert.deepEqual((await malicious.json()).entries, [])
        assert.equal((await fetch(`${base}/api/me/ratings/ledger?limit=0`)).status, 400)
        assert.equal(
          (
            await fetch(`${base}/api/online/matches/${played.match.id}/interrupt`, {
              method: 'POST',
            })
          ).status,
          404,
        )
      } finally {
        await new Promise<void>((resolve) => http.close(() => resolve()))
      }
    })
  },
)
