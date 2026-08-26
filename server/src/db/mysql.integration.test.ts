import '../env.js'
import assert from 'node:assert/strict'
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
import { MySqlUserDocumentRepository } from '../repositories/userDocuments.js'
import { MySqlGameRepository } from '../games/mysqlRepository.js'
import { GameNotFoundError } from '../games/repository.js'
import { OnlineMatchService } from '../online/service.js'
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
      assert.deepEqual(await migrate(database), [1, 2, 3, 4, 5])
      assert.deepEqual(await migrate(database), [])
      assert.equal((await migrationStatus(database)).currentVersion, 5)

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
    assert.deepEqual(await migrate(database), [2, 3, 4, 5])
    assert.equal((await migrationStatus(database)).currentVersion, 5)
  })
})
