import './env.js'
import express from 'express'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { PikafishEngine, EngineSearchLimit, EngineRuntimeOptions, EngineVariant } from './engine.js'
import { parseClientMessage } from './protocol.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { createGameRouter } from './games/routes.js'
import { JsonGameRepository } from './games/repository.js'
import { MySqlGameRepository } from './games/mysqlRepository.js'
import { GameLeaseManager } from './games/leases.js'
import { RoomRepository } from './rooms/repository.js'
import { RoomManager } from './rooms/manager.js'
import { createRoomRouter } from './rooms/routes.js'
import { StoredRoom, RoomColor } from './rooms/types.js'
import { RapfiEngine } from './gomoku/rapfiEngine.js'
import { registerRapfiWebSocketServer, type RapfiWebSocket } from './gomoku/websocket.js'
import { isLocalGameLibraryRequest, listLanIPv4 } from './network.js'
import { loadDatabaseConfig } from './db/config.js'
import { Database } from './db/database.js'
import { assertSchemaReady } from './db/migrations.js'
import { createAuthRuntime } from './auth/http.js'
import type { UserActor } from './auth/types.js'
import { createAuthTokenDelivery } from './auth/delivery.js'
import { MySqlOnlineMatchRepository } from './online/repository.js'
import { OnlineMatchService } from './online/service.js'
import { OnlineMatchError } from './online/service.js'
import { OnlineMatchManager } from './online/manager.js'
import { createOnlineRouters } from './online/routes.js'
import { loadPlatformConfig, PlatformConfigError } from './platform/config.js'
import { canAccessPublicOnline } from './platform/rollout.js'
import {
  clientIp,
  createCorsAndOriginGuard,
  createPayloadComplexityGuard,
  createRequestContext,
  createSecurityHeaders,
  createTransportSecurity,
  jsonErrorHandler,
  requestOriginAllowed,
  TrustedProxyPolicy,
} from './platform/security.js'
import {
  createHttpObservability,
  engineHealthSnapshot,
  metrics,
  recordProcessMetrics,
  structuredLog,
} from './platform/observability.js'
import {
  ConnectionQuota,
  EngineResourceGovernor,
  ResourceLimitError,
} from './platform/resources.js'
import {
  createPersistentRateLimitMiddleware,
  MySqlRateLimitStore,
  rateLimitErrorMiddleware,
} from './platform/rateLimit.js'
import { createUserDocumentRouter } from './documents/routes.js'
import { userDocumentDefinition } from './documents/registry.js'
import { MySqlUserDocumentRepository } from './repositories/userDocuments.js'
import { createAccountDataRouter, MySqlAccountDataService } from './auth/accountData.js'

const app = express()
const server = createServer(app)
const LAN_MODE = process.env.LAN_MODE === '1'
const platformConfig = loadPlatformConfig()
const trustedProxies = new TrustedProxyPolicy(platformConfig.trustedProxyCidrs)
app.disable('x-powered-by')
app.set('trust proxy', (address: string) => trustedProxies.isTrusted(address))
const databaseConfig = loadDatabaseConfig()
if (platformConfig.publicOnlineEnabled && !databaseConfig.enabled) {
  throw new PlatformConfigError('PUBLIC_ONLINE_ENABLED requires ONLINE_DATABASE_ENABLED')
}
const database = databaseConfig.enabled ? new Database(databaseConfig) : null
const rateLimitStore = database ? new MySqlRateLimitStore(database) : null
const connectionQuota = new ConnectionQuota(platformConfig.maxWsPerIp, platformConfig.maxWsPerUser)
const engineGovernor = new EngineResourceGovernor(
  platformConfig.maxEngineProcesses,
  platformConfig.maxEngineTasks,
)
function logRuntimeError(event: string, error: unknown): void {
  if (error instanceof Error && /timeout|timed out|did not return/i.test(error.message)) {
    metrics.increment('xiangqi_engine_timeouts', { event })
  }
  structuredLog('error', event, {
    errorCode: error instanceof Error ? error.name : 'unknown',
  })
}
const authRuntime = database
  ? createAuthRuntime(database, createAuthTokenDelivery(process.env, platformConfig.production), {
      production: databaseConfig.environment === 'production',
      exposeDevelopmentTokens:
        databaseConfig.environment !== 'production' &&
        process.env.AUTH_DEV_EXPOSE_TOKENS === 'true',
      registrationEnabled: platformConfig.registrationEnabled,
      allowedOrigins: platformConfig.allowedOrigins,
      clientIp: (request) => clientIp(request, trustedProxies),
    })
  : null
const accountDataService = database ? new MySqlAccountDataService(database) : null
const socketActors = new WeakMap<object, UserActor>()
const wss = new WebSocketServer({ noServer: true, maxPayload: platformConfig.wsMaxPayloadBytes })
const gomokuWss = new WebSocketServer({
  noServer: true,
  maxPayload: platformConfig.gomokuWsMaxPayloadBytes,
})
server.on('upgrade', (request, socket, head) => {
  void (async () => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname
    const target = pathname === '/ws' ? wss : pathname === '/gomoku-ws' ? gomokuWss : null
    if (!target) {
      socket.destroy()
      return
    }
    if (platformConfig.production && !trustedProxies.isTrusted(request.socket.remoteAddress)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
      metrics.increment('xiangqi_ws_upgrade_rejected', { reason: 'proxy' })
      return
    }
    if (!requestOriginAllowed(request, platformConfig)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
      metrics.increment('xiangqi_ws_upgrade_rejected', { reason: 'origin' })
      return
    }
    let actor: UserActor | undefined
    if (authRuntime && !LAN_MODE) {
      actor = (await authRuntime.authenticateUpgrade(request).catch(() => null)) || undefined
      if (!actor) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      socketActors.set(request, actor)
    }
    let releaseQuota: () => void
    try {
      releaseQuota = connectionQuota.reserve(clientIp(request, trustedProxies), actor?.userId)
    } catch (error) {
      const retryAfter = error instanceof ResourceLimitError ? error.retryAfterSeconds : 30
      socket.write(
        `HTTP/1.1 429 Too Many Requests\r\nRetry-After: ${retryAfter}\r\nConnection: close\r\n\r\n`,
      )
      socket.destroy()
      return
    }
    try {
      target.handleUpgrade(request, socket, head, (ws) => {
        ws.once('close', releaseQuota)
        metrics.increment('xiangqi_ws_connected', {
          scene: pathname === '/gomoku-ws' ? 'gomoku' : 'core',
        })
        target.emit('connection', ws, request)
      })
    } catch (error) {
      releaseQuota()
      throw error
    }
  })().catch((error) => {
    structuredLog('error', 'ws_upgrade_failed', {
      errorCode: error instanceof Error ? error.name : 'unknown',
    })
    socket.destroy()
  })
})
type LiveWebSocket = WebSocket & { isAlive?: boolean }
const heartbeatTimer = setInterval(() => {
  for (const socketServer of [wss, gomokuWss]) {
    for (const client of socketServer.clients as Set<LiveWebSocket | RapfiWebSocket>) {
      if (client.isAlive === false) {
        metrics.increment('xiangqi_ws_heartbeat_timeouts')
        client.terminate()
        continue
      }
      client.isAlive = false
      client.ping()
    }
  }
}, 15_000)
heartbeatTimer.unref()
const serverDirectory = fileURLToPath(new URL('../', import.meta.url))
const gameRepository = new JsonGameRepository(
  process.env.XIANGQI_DATA_DIR || path.resolve(serverDirectory, '../data/games'),
)
const cloudGameRepository = database ? new MySqlGameRepository(database) : null
const jieqiSeatRecordDefinition = userDocumentDefinition('jieqi-seat-records')!
const jieqiSeatRecordRepository = database
  ? new MySqlUserDocumentRepository<Record<string, unknown>>(
      database,
      jieqiSeatRecordDefinition.resource,
      jieqiSeatRecordDefinition.schemaVersion,
      jieqiSeatRecordDefinition.validate,
      jieqiSeatRecordDefinition.maxDocuments,
      jieqiSeatRecordDefinition.logicalKey,
    )
  : null
const roomRepository = new RoomRepository(
  process.env.XIANGQI_ROOM_DIR || path.resolve(serverDirectory, '../data/rooms'),
)
const gameLeases = new GameLeaseManager()
await gameRepository.init().catch((error) => logRuntimeError('game_store_init_failed', error))
await roomRepository.init().catch((error) =>
  structuredLog('error', 'room_store_init_failed', {
    errorCode: error instanceof Error ? error.name : 'unknown',
  }),
)
app.use(createRequestContext())
app.use(createSecurityHeaders(platformConfig))
app.use(createHttpObservability(platformConfig.httpSuccessLogSampleRate))
app.use(createTransportSecurity(platformConfig, trustedProxies))
app.use('/api', createCorsAndOriginGuard(platformConfig))
app.use('/api/games/import', express.json({ limit: platformConfig.importJsonLimit, strict: true }))
app.use('/api', express.json({ limit: platformConfig.apiJsonLimit, strict: true }))
app.use('/api', createPayloadComplexityGuard(platformConfig))
app.get('/health/live', (_req, res) => res.json({ status: 'live' }))
app.get('/health/ready', async (_req, res) => {
  try {
    if (database) {
      await database.ping()
      await assertSchemaReady(database)
    }
    res.json({ status: 'ready' })
  } catch {
    res.status(503).json({ status: 'unavailable' })
  }
})
app.get('/health/engines', (_request, response) => {
  response.json({ status: 'available-separately', ...engineHealthSnapshot() })
})
app.get('/api/capabilities', (_request, response) => {
  response.json({
    publicOnline: platformConfig.publicOnlineEnabled,
    publicOnlineMode: platformConfig.publicOnlineMode,
    registration: platformConfig.registrationEnabled,
  })
})
app.get('/internal/metrics', (request, response) => {
  const supplied = request.header('authorization')?.replace(/^Bearer\s+/i, '')
  const internal = trustedProxies.isTrusted(request.socket.remoteAddress)
  if (platformConfig.metricsToken ? supplied !== platformConfig.metricsToken : !internal) {
    response.status(404).json({ error: 'not_found' })
    return
  }
  recordProcessMetrics()
  response.type('text/plain; version=0.0.4').send(metrics.prometheus())
})
if (authRuntime) {
  app.use(authRuntime.actorMiddleware)
  if (rateLimitStore) {
    app.use(
      createPersistentRateLimitMiddleware(rateLimitStore, (request) =>
        clientIp(request, trustedProxies),
      ),
    )
  }
  app.use('/api/auth', authRuntime.router)
  app.use('/api/account', authRuntime.accountRouter)
  app.use('/api/me', authRuntime.meRouter)
  app.use(
    '/api/me',
    createAccountDataRouter(accountDataService!, {
      requireUser: (response) => authRuntime.requireUser(response),
    }),
  )
  app.use(
    '/api/me/documents',
    createUserDocumentRouter(database!, {
      requireUser: (response) => authRuntime.requireUser(response),
      requireCsrf: (request, response) => authRuntime.requireCsrf(request, response),
    }),
  )
}
if (accountDataService) {
  void accountDataService
    .cleanupDue()
    .catch((error) => logRuntimeError('account_deletion_cleanup_failed', error))
  const accountDeletionCleanupTimer = setInterval(
    () =>
      void accountDataService
        .cleanupDue()
        .catch((error) => logRuntimeError('account_deletion_cleanup_failed', error)),
    60 * 60 * 1000,
  )
  accountDeletionCleanupTimer.unref()
}
if (LAN_MODE) {
  app.get('/api/network-info', (_req, res) => {
    res.json({ addresses: listLanIPv4(os.networkInterfaces()) })
  })
}
app.use(
  '/api/games',
  (req, res, next) => {
    if (res.locals.auth?.actor?.kind === 'user' && cloudGameRepository) return next()
    const address = req.socket.remoteAddress || ''
    if (
      isLocalGameLibraryRequest(
        address,
        req.get('host') || '',
        req.get('x-xiangqi-proxy-client-address'),
      )
    ) {
      return next()
    }
    res.status(403).json({ error: '本机对局库只允许从回环地址访问' })
  },
  createGameRouter(gameRepository, gameLeases, {
    cloudRepository: cloudGameRepository || undefined,
    currentUserId: (response) =>
      response.locals.auth?.actor?.kind === 'user' ? response.locals.auth.actor.userId : null,
    requireCsrf: (request, response) => {
      const actor = authRuntime?.requireCsrf(request, response)
      if (actor?.status === 'restricted') {
        throw Object.assign(new Error('account_read_only'), { status: 403 })
      }
    },
  }),
)

const INITIAL_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'

function getSearchLimit(msg: {
  searchMode?: EngineSearchLimit['searchMode']
  searchDepth?: number
  searchTimeMs?: number
}): EngineSearchLimit | undefined {
  if (!msg.searchMode) return undefined
  return {
    searchMode: msg.searchMode,
    searchDepth: msg.searchDepth,
    searchTimeMs: msg.searchTimeMs,
  }
}

function getRuntimeOptions(msg: {
  engineThreads?: EngineRuntimeOptions['engineThreads']
  engineHashMb?: number
}): EngineRuntimeOptions | undefined {
  if (msg.engineThreads === undefined && msg.engineHashMb === undefined) return undefined
  return {
    engineThreads: msg.engineThreads,
    engineHashMb: msg.engineHashMb,
  }
}

type EngineSlot = {
  engine: PikafishEngine | null
  releaseProcess?: () => void
  ready: boolean
  initPromise: Promise<PikafishEngine | null> | null
  runtimeOptions?: EngineRuntimeOptions
  disposed: boolean
}

const liveEngines = new Set<PikafishEngine>()

function makeSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function sendError(
  ws: WebSocket,
  message: string,
  requestId?: string,
  code?: string,
  retryAfter?: number,
) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'error', requestId, message, code, retryAfter }))
  }
}

function sendEngineStatus(ws: WebSocket, available: boolean, message?: string) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'engine-status', available, message }))
  }
}

function createEngineSlots(): Record<EngineVariant, EngineSlot> {
  return {
    xiangqi: { engine: null, ready: false, initPromise: null, disposed: false },
    jieqi: { engine: null, ready: false, initPromise: null, disposed: false },
  }
}

async function getEngine(
  slots: Record<EngineVariant, EngineSlot>,
  variant: EngineVariant = 'xiangqi',
): Promise<PikafishEngine | null> {
  const slot = slots[variant]
  if (slot.disposed) return null
  if (slot.engine && slot.ready) return slot.engine
  if (slot.initPromise) return slot.initPromise

  slot.initPromise = (async () => {
    if (slot.engine) {
      slot.engine.destroy()
      liveEngines.delete(slot.engine)
      slot.releaseProcess?.()
      slot.releaseProcess = undefined
    }

    let releaseProcess: () => void
    try {
      releaseProcess = engineGovernor.reserveProcess(variant === 'jieqi' ? 'jieqi' : 'pikafish')
    } catch {
      return null
    }
    const engine = new PikafishEngine(variant)
    liveEngines.add(engine)
    slot.engine = engine
    slot.releaseProcess = releaseProcess
    slot.ready = await engine.init(slot.runtimeOptions)

    if (slot.disposed) {
      engine.destroy()
      liveEngines.delete(engine)
      slot.releaseProcess?.()
      slot.releaseProcess = undefined
      if (slot.engine === engine) slot.engine = null
      slot.ready = false
      return null
    }

    if (!slot.ready) {
      engine.destroy()
      liveEngines.delete(engine)
      slot.releaseProcess?.()
      slot.releaseProcess = undefined
      slot.engine = null
      structuredLog('warn', 'engine_unavailable', { kind: variant })
      return null
    }

    engine.on('exit', () => {
      if (slot.engine === engine) {
        slot.ready = false
        slot.releaseProcess?.()
        slot.releaseProcess = undefined
        metrics.increment('xiangqi_engine_exits', { kind: variant })
      }
    })

    return engine
  })()

  try {
    return await slot.initPromise
  } finally {
    slot.initPromise = null
  }
}

function destroyEngineSlots(slots: Record<EngineVariant, EngineSlot>) {
  for (const slot of Object.values(slots)) {
    slot.disposed = true
    if (!slot.engine) continue
    slot.engine.destroy()
    liveEngines.delete(slot.engine)
    slot.releaseProcess?.()
    slot.releaseProcess = undefined
    slot.engine = null
    slot.ready = false
  }
}

const roomEngineSlots = createEngineSlots()
const JIEQI_INITIAL_FEN =
  'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P5N2B2r2a2c2p5n2b2 0 1'
function roomIdentity(type: string, color: RoomColor) {
  return color === 'red' ? type.toUpperCase() : type
}
async function getRoomHint(room: StoredRoom, viewer: RoomColor): Promise<string | null> {
  if (room.variant === 'gomoku') return null
  let releaseTask: (() => void) | undefined
  try {
    releaseTask = engineGovernor.reserveTask(`room:${room.id}:${viewer}`, 'finite')
  } catch {
    return null
  }
  const engine = await getEngine(roomEngineSlots, room.variant)
  if (!engine) {
    releaseTask()
    return null
  }
  const moves = room.moves.map((move) => {
    let text = move.uci
    if (move.revealed) text += roomIdentity(move.revealed, move.color)
    if (move.capturedHidden && move.captured && move.capturedColor && move.color === viewer)
      text += roomIdentity(move.captured, move.capturedColor)
    return text
  })
  const startedAt = Date.now()
  try {
    const result = await engine.getBestMove(
      room.variant === 'jieqi' ? JIEQI_INITIAL_FEN : INITIAL_FEN,
      moves,
      'master',
    )
    metrics.observe('xiangqi_engine_search_duration', Date.now() - startedAt, {
      kind: room.variant,
      task: 'room_hint',
    })
    return result.move?.slice(0, 4) || null
  } finally {
    releaseTask()
  }
}
const roomManager = new RoomManager(roomRepository, getRoomHint)
roomManager.startPresenceRecovery()
void roomManager.cleanup().catch((error) => logRuntimeError('room_cleanup_failed', error))
const roomCleanupTimer = setInterval(
  () => void roomManager.cleanup().catch((error) => logRuntimeError('room_cleanup_failed', error)),
  60 * 60 * 1000,
)
roomCleanupTimer.unref()
if (LAN_MODE) app.use('/api/rooms', createRoomRouter(roomManager))
const onlineService =
  database && platformConfig.publicOnlineEnabled
    ? new OnlineMatchService(new MySqlOnlineMatchRepository(database), {
        rateLimitStore: rateLimitStore || undefined,
        maxActiveMatchesPerUser: platformConfig.maxActiveMatchesPerUser,
        maxMatchmakingQueueEntries: platformConfig.maxMatchmakingQueueEntries,
        jieqiSeatRecords: jieqiSeatRecordRepository || undefined,
      })
    : null
const onlineManager = onlineService
  ? new OnlineMatchManager(
      onlineService,
      60_000,
      platformConfig.maxSpectatorsPerMatch,
      platformConfig.maxPlayerConnectionsPerUser,
    )
  : null
if (onlineService && authRuntime) {
  const onlineRollout = {
    mode: platformConfig.publicOnlineMode,
    allowedUserIds: new Set(platformConfig.publicOnlineAllowedUserIds),
  }
  const onlineRouters = createOnlineRouters(onlineService, authRuntime, onlineRollout)
  app.use('/api/online', onlineRouters.router)
  app.use('/api/me/matches', onlineRouters.meMatchesRouter)
  app.use(onlineRouters.errorMiddleware)
  void onlineManager
    ?.restore()
    .catch((error) => logRuntimeError('online_match_recovery_failed', error))
}
if (authRuntime) app.use(authRuntime.errorMiddleware)

const liveRapfiEngines = new Set<RapfiEngine>()
registerRapfiWebSocketServer(gomokuWss, {
  liveEngines: liveRapfiEngines,
  originAllowed: (request) => requestOriginAllowed(request, platformConfig),
  reserveProcess: () => engineGovernor.reserveProcess('rapfi'),
  reserveTask: (owner) => engineGovernor.reserveTask(owner, 'finite'),
  taskOwner: (request) => socketActors.get(request)?.userId || clientIp(request, trustedProxies),
})
gomokuWss.on('connection', (ws, request) => {
  const actor = socketActors.get(request)
  if (actor && authRuntime) authRuntime.bindSocket(actor, ws)
})

wss.on('connection', async (ws, request) => {
  const actor = socketActors.get(request)
  if (actor && authRuntime) {
    authRuntime.bindSocket(actor, ws)
    if (
      canAccessPublicOnline(
        {
          mode: platformConfig.publicOnlineMode,
          allowedUserIds: new Set(platformConfig.publicOnlineAllowedUserIds),
        },
        actor,
      )
    ) {
      onlineManager?.bind(ws, actor)
    }
  }
  ;(ws as LiveWebSocket).isAlive = true
  ws.on('pong', () => {
    ;(ws as LiveWebSocket).isAlive = true
  })
  const sessionId = makeSessionId()
  structuredLog('info', 'ws_connected', { connectionId: sessionId, scene: 'core' })
  const engineSlots = createEngineSlots()
  const activeAnalysis = new Map<EngineVariant, { sessionId: string; requestId?: string }>()
  let currentDifficulty: 'easy' | 'medium' | 'hard' | 'master' = 'medium'
  let infoHandler: ((info: unknown) => void) | null = null
  let localAnalysisRequestId: string | undefined
  let localAnalysisFen = INITIAL_FEN
  let localAnalysisMoves: string[] = []
  let localAnalysisLimit: EngineSearchLimit | undefined
  let localAnalysisVariant: EngineVariant | null = null
  let localAnalysisEngine: PikafishEngine | null = null
  let requestGeneration = 0
  const activeFiniteRequests = new Map<string, PikafishEngine>()
  let infoEngine: PikafishEngine | null = null
  let releaseAnalysisTask: (() => void) | undefined

  const attachAnalysisHandler = (engine: PikafishEngine) => {
    if (infoHandler && infoEngine) {
      infoEngine.removeListener('info', infoHandler)
    }
    infoHandler = (info) => {
      const analysis = localAnalysisVariant ? activeAnalysis.get(localAnalysisVariant) : undefined
      if (
        analysis?.sessionId === sessionId &&
        analysis.requestId === localAnalysisRequestId &&
        ws.readyState === WebSocket.OPEN
      ) {
        ws.send(JSON.stringify({ type: 'info', requestId: localAnalysisRequestId, data: info }))
      }
    }
    infoEngine = engine
    engine.on('info', infoHandler)
  }

  const detachAnalysisHandler = (engine: PikafishEngine) => {
    if (infoHandler) {
      ;(infoEngine || engine).removeListener('info', infoHandler)
      infoHandler = null
      infoEngine = null
    }
  }

  const shouldResumeLocalAnalysis = (variant: EngineVariant) =>
    Boolean(localAnalysisRequestId) &&
    localAnalysisVariant === variant &&
    activeAnalysis.get(variant)?.sessionId === sessionId &&
    activeAnalysis.get(variant)?.requestId === localAnalysisRequestId &&
    ws.readyState === WebSocket.OPEN

  ws.on('message', async (data) => {
    let releaseFiniteTask: (() => void) | undefined
    let finiteTaskStartedAt = 0
    let finiteTaskKind = 'unknown'
    try {
      const rawMessage = data.toString()
      let roomMessage: Record<string, unknown> = {}
      try {
        const candidate = JSON.parse(rawMessage)
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
          roomMessage = candidate as Record<string, unknown>
        }
      } catch {
        // The engine protocol parser below returns the stable invalid JSON response.
      }
      if (typeof roomMessage.type === 'string' && roomMessage.type.startsWith('match-')) {
        if (!onlineManager) {
          sendError(ws, '公网对局服务未启用')
          return
        }
        if (roomMessage.type === 'match-subscribe' && localAnalysisEngine) {
          detachAnalysisHandler(localAnalysisEngine)
          localAnalysisEngine.stopAnalysis()
          localAnalysisEngine = null
          if (localAnalysisVariant) activeAnalysis.delete(localAnalysisVariant)
          localAnalysisVariant = null
          localAnalysisRequestId = undefined
          releaseAnalysisTask?.()
          releaseAnalysisTask = undefined
        }
        try {
          await onlineManager.handle(ws, roomMessage)
        } catch (error) {
          if (ws.readyState === WebSocket.OPEN && error instanceof OnlineMatchError) {
            ws.send(
              JSON.stringify({
                type: 'match-error',
                code: error.code,
                message:
                  error.code === 'revision_conflict'
                    ? '对局状态已更新，正在重新同步'
                    : error.message,
                ...(error.code === 'revision_conflict'
                  ? { currentRevision: Number(error.message) }
                  : {}),
                ...(error.retryAfterSeconds ? { retryAfter: error.retryAfterSeconds } : {}),
                commandId:
                  typeof roomMessage.commandId === 'string' ? roomMessage.commandId : undefined,
              }),
            )
          } else {
            sendError(
              ws,
              error instanceof Error ? error.message : '公网对局操作失败',
              typeof roomMessage.commandId === 'string' ? roomMessage.commandId : undefined,
            )
          }
        }
        return
      }
      if (typeof roomMessage.type === 'string' && roomMessage.type.startsWith('room-')) {
        if (!LAN_MODE) {
          sendError(ws, '局域网房间协议在当前服务模式下未启用')
          return
        }
        try {
          await roomManager.handle(ws, roomMessage)
        } catch (error) {
          sendError(
            ws,
            error instanceof Error ? error.message : '房间操作失败',
            typeof roomMessage.commandId === 'string' ? roomMessage.commandId : undefined,
          )
        }
        return
      }
      const parsed = parseClientMessage(rawMessage)
      if (!parsed.ok) {
        sendError(ws, parsed.error, parsed.requestId)
        return
      }
      const msg = parsed.message
      const engineMessage = new Set([
        'init',
        'move',
        'hint',
        'candidates',
        'review',
        'analyze-nodes',
        'analyze',
      ]).has(msg.type)
      if (engineMessage && onlineManager?.isSubscribed(ws)) {
        sendError(
          ws,
          '公网实战连接禁止使用分析和提示',
          msg.requestId,
          'online_match_analysis_forbidden',
        )
        metrics.increment('xiangqi_engine_rejected', { reason: 'online_match' })
        return
      }
      if (['move', 'hint', 'candidates', 'review', 'analyze-nodes'].includes(msg.type)) {
        try {
          releaseFiniteTask = engineGovernor.reserveTask(actor?.userId || sessionId, 'finite')
          finiteTaskStartedAt = performance.now()
          finiteTaskKind = msg.type
        } catch (error) {
          const retryAfter = error instanceof ResourceLimitError ? error.retryAfterSeconds : 5
          sendError(
            ws,
            `引擎任务繁忙，请在 ${retryAfter} 秒后重试`,
            msg.requestId,
            error instanceof ResourceLimitError ? error.code : 'engine_busy',
            retryAfter,
          )
          return
        }
      }
      switch (msg.type) {
        case 'claim-game':
        case 'takeover-game': {
          try {
            if (actor && cloudGameRepository)
              await cloudGameRepository.get(actor.userId, msg.gameId!)
            else gameRepository.get(msg.gameId!)
          } catch {
            sendError(ws, '对局不存在或无权访问', msg.requestId, 'game_not_found')
            break
          }
          const result = gameLeases.claim(
            msg.gameId!,
            ws,
            msg.type === 'takeover-game',
            actor ? `user:${actor.userId}` : 'local',
          )
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'game-lease',
                requestId: msg.requestId,
                gameId: msg.gameId,
                ...result,
              }),
            )
          }
          break
        }

        case 'release-game': {
          gameLeases.release(msg.gameId!, ws, actor ? `user:${actor.userId}` : 'local')
          break
        }

        case 'init': {
          currentDifficulty = msg.difficulty || 'medium'
          const runtimeOptions = getRuntimeOptions(msg)
          const engine = await getEngine(engineSlots, msg.variant)
          if (runtimeOptions) {
            engineSlots[msg.variant || 'xiangqi'].runtimeOptions = runtimeOptions
            if (engine) {
              try {
                await engine.applyRuntimeOptions(runtimeOptions)
              } catch (err) {
                logRuntimeError('engine_options_failed', err)
                sendError(ws, 'Engine option update failed')
              }
            }
          }
          sendEngineStatus(ws, Boolean(engine), engine ? 'Engine ready' : 'Engine not available')
          break
        }

        case 'move': {
          const engine = await getEngine(engineSlots, msg.variant)
          if (!engine) {
            sendEngineStatus(ws, false, 'Engine not available')
            sendError(ws, 'Engine not available', msg.requestId)
            break
          }

          const requestDifficulty = msg.difficulty || currentDifficulty
          const requestId = msg.requestId
          const fen = msg.fen || INITIAL_FEN
          const moves: string[] = msg.moves || []
          try {
            const generation = requestGeneration
            const startedAt = Date.now()
            if (requestId) activeFiniteRequests.set(requestId, engine)
            const result = await engine.getBestMove(
              fen,
              moves,
              requestDifficulty,
              getSearchLimit(msg),
            )
            if (!result.move) {
              sendError(ws, 'Engine returned no move', requestId)
            } else if (generation === requestGeneration && ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: 'bestmove',
                  requestId,
                  move: result.move,
                  elapsedMs: Date.now() - startedAt,
                  requestKind: 'move',
                  searchCapped: result.searchCapped,
                }),
              )
            }
          } catch (err) {
            logRuntimeError('engine_move_failed', err)
            sendError(ws, 'Engine error', requestId)
          } finally {
            if (requestId) activeFiniteRequests.delete(requestId)
          }
          break
        }

        case 'hint': {
          const engine = await getEngine(engineSlots, msg.variant)
          if (!engine) {
            sendEngineStatus(ws, false, 'Engine not available')
            sendError(ws, 'Engine not available', msg.requestId)
            break
          }

          const requestId = msg.requestId
          const fen = msg.fen || INITIAL_FEN
          const moves: string[] = msg.moves || []
          try {
            const generation = requestGeneration
            const startedAt = Date.now()
            if (requestId) activeFiniteRequests.set(requestId, engine)
            const result = await engine.getBestMove(
              fen,
              moves,
              msg.difficulty || 'master',
              getSearchLimit(msg),
            )
            if (!result.move) {
              sendError(ws, 'Engine returned no hint', requestId)
            } else if (generation === requestGeneration && ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: 'bestmove',
                  requestId,
                  move: result.move,
                  elapsedMs: Date.now() - startedAt,
                  requestKind: 'hint',
                  searchCapped: result.searchCapped,
                }),
              )
            }
          } catch (err) {
            logRuntimeError('engine_hint_failed', err)
            sendError(ws, 'Hint engine error', requestId)
          } finally {
            if (requestId) activeFiniteRequests.delete(requestId)
          }
          break
        }

        case 'candidates': {
          const engine = await getEngine(engineSlots, msg.variant)
          if (!engine) {
            sendEngineStatus(ws, false, 'Engine not available')
            sendError(ws, 'Engine not available', msg.requestId)
            break
          }

          const requestId = msg.requestId
          const fen = msg.fen || INITIAL_FEN
          const moves: string[] = msg.moves || []
          const resumeAnalysis = shouldResumeLocalAnalysis(msg.variant || 'xiangqi')
          if (resumeAnalysis) {
            detachAnalysisHandler(engine)
          }
          try {
            const generation = requestGeneration
            if (requestId) activeFiniteRequests.set(requestId, engine)
            const candidates = await engine.getCandidates(
              fen,
              moves,
              msg.difficulty || currentDifficulty,
              msg.count || 3,
              getSearchLimit(msg),
            )
            if (generation === requestGeneration && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'candidates', requestId, candidates }))
            }
          } catch (err) {
            logRuntimeError('engine_candidates_failed', err)
            sendError(ws, 'Candidate engine error', requestId)
          } finally {
            if (requestId) activeFiniteRequests.delete(requestId)
            if (resumeAnalysis && shouldResumeLocalAnalysis(msg.variant || 'xiangqi')) {
              try {
                attachAnalysisHandler(engine)
                await engine.analyze(localAnalysisFen, localAnalysisMoves, localAnalysisLimit)
              } catch (err) {
                logRuntimeError('engine_analysis_resume_failed', err)
              }
            }
          }
          break
        }

        case 'review': {
          const engine = await getEngine(engineSlots, msg.variant)
          if (!engine) {
            sendEngineStatus(ws, false, 'Engine not available')
            sendError(ws, 'Engine not available', msg.requestId)
            break
          }

          const requestId = msg.requestId
          const fen = msg.fen || INITIAL_FEN
          const moves: string[] = msg.moves || []
          const resumeAnalysis = shouldResumeLocalAnalysis(msg.variant || 'xiangqi')
          if (resumeAnalysis) detachAnalysisHandler(engine)

          try {
            const generation = requestGeneration
            if (requestId) activeFiniteRequests.set(requestId, engine)
            const initialTurn = fen.trim().split(/\s+/)[1] === 'b' ? 'black' : 'red'
            const positions = []

            for (let prefixLength = 0; prefixLength <= moves.length; prefixLength++) {
              if (generation !== requestGeneration || ws.readyState !== WebSocket.OPEN) break
              const candidates = await engine.getCandidates(
                fen,
                moves.slice(0, prefixLength),
                'master',
                1,
                { searchMode: 'depth', searchDepth: msg.searchDepth || 12 },
              )
              if (generation !== requestGeneration || ws.readyState !== WebSocket.OPEN) break
              const candidate = candidates[0]
              if (!candidate) throw new Error('Engine returned no review candidate')
              const redToMove =
                prefixLength % 2 === 0 ? initialTurn === 'red' : initialTurn === 'black'
              positions.push({
                moveIndex: prefixLength - 1,
                evaluation: redToMove ? candidate.score : -candidate.score,
                depth: candidate.depth,
                bestMove: candidate.move,
                pv: candidate.pv,
              })
              ws.send(
                JSON.stringify({
                  type: 'review-progress',
                  requestId,
                  completed: prefixLength + 1,
                  total: moves.length + 1,
                }),
              )
            }

            if (generation === requestGeneration && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'review-result', requestId, positions }))
            }
          } catch (err) {
            logRuntimeError('engine_review_failed', err)
            sendError(ws, 'Review engine error', requestId)
          } finally {
            if (requestId) activeFiniteRequests.delete(requestId)
            if (resumeAnalysis && shouldResumeLocalAnalysis(msg.variant || 'xiangqi')) {
              try {
                attachAnalysisHandler(engine)
                await engine.analyze(localAnalysisFen, localAnalysisMoves, localAnalysisLimit)
              } catch (err) {
                logRuntimeError('engine_analysis_resume_failed', err)
              }
            }
          }
          break
        }

        case 'analyze-nodes': {
          const engine = await getEngine(engineSlots, msg.variant)
          if (!engine) {
            sendEngineStatus(ws, false, 'Engine not available')
            sendError(ws, 'Engine not available', msg.requestId)
            break
          }

          const requestId = msg.requestId
          const fen = msg.fen || INITIAL_FEN
          const moves: string[] = msg.moves || []
          const moveIndexes = msg.moveIndexes || []
          const resumeAnalysis = shouldResumeLocalAnalysis(msg.variant || 'xiangqi')
          if (resumeAnalysis) detachAnalysisHandler(engine)

          try {
            const generation = requestGeneration
            if (requestId) activeFiniteRequests.set(requestId, engine)
            const initialTurn = fen.trim().split(/\s+/)[1] === 'b' ? 'black' : 'red'
            const positions = []
            const searchLimit = getSearchLimit(msg) || {
              searchMode: 'depth' as const,
              searchDepth: 16,
            }

            for (let index = 0; index < moveIndexes.length; index++) {
              if (generation !== requestGeneration || ws.readyState !== WebSocket.OPEN) break
              const moveIndex = moveIndexes[index]
              const prefixLength = moveIndex + 1
              const candidates = await engine.getCandidates(
                fen,
                moves.slice(0, prefixLength),
                'master',
                1,
                searchLimit,
              )
              if (generation !== requestGeneration || ws.readyState !== WebSocket.OPEN) break
              const candidate = candidates[0]
              if (!candidate) throw new Error('Engine returned no node analysis candidate')
              const redToMove =
                prefixLength % 2 === 0 ? initialTurn === 'red' : initialTurn === 'black'
              positions.push({
                moveIndex,
                evaluation: redToMove ? candidate.score : -candidate.score,
                depth: candidate.depth,
                bestMove: candidate.move,
                pv: candidate.pv,
              })
              ws.send(
                JSON.stringify({
                  type: 'node-analysis-progress',
                  requestId,
                  completed: index + 1,
                  total: moveIndexes.length,
                }),
              )
            }

            if (generation === requestGeneration && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'node-analysis-result', requestId, positions }))
            }
          } catch (err) {
            logRuntimeError('engine_node_analysis_failed', err)
            sendError(ws, 'Node analysis engine error', requestId)
          } finally {
            if (requestId) activeFiniteRequests.delete(requestId)
            if (resumeAnalysis && shouldResumeLocalAnalysis(msg.variant || 'xiangqi')) {
              try {
                attachAnalysisHandler(engine)
                await engine.analyze(localAnalysisFen, localAnalysisMoves, localAnalysisLimit)
              } catch (err) {
                logRuntimeError('engine_analysis_resume_failed', err)
              }
            }
          }
          break
        }

        case 'analyze': {
          if (!releaseAnalysisTask) {
            try {
              releaseAnalysisTask = engineGovernor.reserveTask(
                actor?.userId || sessionId,
                'interactive',
              )
            } catch (error) {
              const retryAfter = error instanceof ResourceLimitError ? error.retryAfterSeconds : 5
              sendError(
                ws,
                `引擎任务繁忙，请在 ${retryAfter} 秒后重试`,
                msg.requestId,
                error instanceof ResourceLimitError ? error.code : 'engine_busy',
                retryAfter,
              )
              break
            }
          }
          const engine = await getEngine(engineSlots, msg.variant)
          if (!engine) {
            releaseAnalysisTask?.()
            releaseAnalysisTask = undefined
            sendEngineStatus(ws, false, 'Engine not available')
            sendError(ws, 'Engine not available', msg.requestId)
            break
          }

          const fen = msg.fen || INITIAL_FEN
          const moves: string[] = msg.moves || []
          localAnalysisRequestId = msg.requestId
          localAnalysisFen = fen
          localAnalysisMoves = moves
          localAnalysisLimit = getSearchLimit(msg)
          localAnalysisVariant = msg.variant || 'xiangqi'
          localAnalysisEngine = engine
          activeAnalysis.set(localAnalysisVariant, { sessionId, requestId: msg.requestId })
          attachAnalysisHandler(engine)

          engine.stopAnalysis()
          await engine.analyze(fen, moves, localAnalysisLimit)
          break
        }

        case 'stop': {
          const analysis = localAnalysisVariant
            ? activeAnalysis.get(localAnalysisVariant)
            : undefined
          const stopsOwnAnalysis =
            analysis?.sessionId === sessionId &&
            (!msg.requestId || analysis.requestId === msg.requestId)
          const stopsFiniteRequest = msg.requestId
            ? activeFiniteRequests.has(msg.requestId)
            : activeFiniteRequests.size > 0

          if (stopsFiniteRequest) {
            requestGeneration++
          }
          if (stopsOwnAnalysis) {
            if (localAnalysisEngine) detachAnalysisHandler(localAnalysisEngine)
            if (localAnalysisVariant) activeAnalysis.delete(localAnalysisVariant)
            localAnalysisRequestId = undefined
            localAnalysisLimit = undefined
            localAnalysisVariant = null
            releaseAnalysisTask?.()
            releaseAnalysisTask = undefined
          }
          const enginesToInterrupt = new Set<PikafishEngine>()
          if (msg.requestId) {
            const finiteEngine = activeFiniteRequests.get(msg.requestId)
            if (finiteEngine) enginesToInterrupt.add(finiteEngine)
          } else {
            for (const finiteEngine of activeFiniteRequests.values())
              enginesToInterrupt.add(finiteEngine)
          }
          if (stopsOwnAnalysis && localAnalysisEngine) enginesToInterrupt.add(localAnalysisEngine)
          for (const engine of enginesToInterrupt) engine.interruptSearch()
          if (stopsOwnAnalysis) localAnalysisEngine = null
          break
        }
      }
    } catch (err) {
      structuredLog('warn', 'ws_message_rejected', {
        connectionId: sessionId,
        errorCode: err instanceof Error ? err.name : 'unknown',
      })
    } finally {
      if (releaseFiniteTask && finiteTaskStartedAt) {
        metrics.observe('xiangqi_engine_search_duration', performance.now() - finiteTaskStartedAt, {
          kind: 'pikafish',
          task: finiteTaskKind,
        })
      }
      releaseFiniteTask?.()
    }
  })

  ws.on('close', () => {
    structuredLog('info', 'ws_disconnected', { connectionId: sessionId, scene: 'core' })
    metrics.increment('xiangqi_ws_disconnects', { scene: 'core' })
    if (localAnalysisEngine) detachAnalysisHandler(localAnalysisEngine)
    releaseAnalysisTask?.()
    releaseAnalysisTask = undefined
    if (localAnalysisVariant && activeAnalysis.get(localAnalysisVariant)?.sessionId === sessionId) {
      activeAnalysis.delete(localAnalysisVariant)
      localAnalysisEngine?.stopAnalysis()
    }
    destroyEngineSlots(engineSlots)
    gameLeases.releaseSocket(ws)
    if (!shuttingDown) {
      roomManager.disconnect(ws)
      onlineManager?.disconnect(ws)
    }
  })
})

app.use(jsonErrorHandler)
app.use(rateLimitErrorMiddleware)
app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'not_found', requestId: response.locals.requestId })
})
app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    structuredLog('error', 'http_unhandled_error', {
      requestId: response.locals.requestId,
      errorCode: error instanceof Error ? error.name : 'unknown',
    })
    response.status(500).json({ error: 'internal_error', requestId: response.locals.requestId })
  },
)

if (LAN_MODE) {
  const clientDist = path.resolve(serverDirectory, '../client/dist')
  app.use(
    express.static(clientDist, {
      etag: true,
      maxAge: '1h',
      setHeaders: (response, resourcePath) => {
        if (resourcePath.includes(`${path.sep}assets${path.sep}`)) {
          response.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        }
      },
    }),
  )
  app.get('*', (req, res, next) =>
    req.path.startsWith('/api/')
      ? next()
      : res.setHeader('Cache-Control', 'no-store').sendFile(path.join(clientDist, 'index.html')),
  )
}

const PORT = process.env.PORT || 3001
const HOST = process.env.HOST || (LAN_MODE ? '0.0.0.0' : '127.0.0.1')

server.listen(Number(PORT), HOST, () => {
  structuredLog('info', 'server_started', {
    host: HOST,
    port: String(PORT),
    environment: platformConfig.environment,
    publicOnline: platformConfig.publicOnlineEnabled,
  })
  if (LAN_MODE) {
    const addresses = listLanIPv4(os.networkInterfaces()).map(
      (address) => `http://${address}:${PORT}/?lan=1`,
    )
    for (const address of addresses) structuredLog('info', 'lan_lobby_available', { address })
  }
})

let shuttingDown = false
function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  structuredLog('info', 'shutdown_started', { graceMs: platformConfig.shutdownGraceMs })
  clearInterval(heartbeatTimer)
  clearInterval(roomCleanupTimer)
  for (const client of wss.clients) client.close(1012, 'Server restarting')
  for (const client of gomokuWss.clients) client.close(1012, 'Server restarting')
  const coreSocketsClosed = new Promise<void>((resolve) => wss.close(() => resolve()))
  const gomokuSocketsClosed = new Promise<void>((resolve) => gomokuWss.close(() => resolve()))
  roomManager.dispose()
  onlineManager?.dispose()
  const serverClosed = new Promise<void>((resolve) => server.close(() => resolve()))
  Promise.allSettled([
    coreSocketsClosed,
    gomokuSocketsClosed,
    serverClosed,
    gameRepository.flush(),
    roomManager.flush(),
  ]).then(async (results) => {
    for (const engine of liveEngines) engine.destroy()
    liveEngines.clear()
    for (const engine of liveRapfiEngines) engine.destroy()
    liveRapfiEngines.clear()
    const databaseResult = await database?.close().then(
      () => ({ status: 'fulfilled' as const, value: undefined }),
      (reason) => ({ status: 'rejected' as const, reason }),
    )
    if (databaseResult) results.push(databaseResult)
    const failed = results.some((result) => result.status === 'rejected')
    structuredLog(failed ? 'error' : 'info', 'shutdown_completed', { failed })
    process.exit(failed ? 1 : 0)
  })
  const forcedExit = setTimeout(() => {
    for (const client of wss.clients) client.terminate()
    for (const client of gomokuWss.clients) client.terminate()
    structuredLog('error', 'shutdown_timed_out')
    process.exit(1)
  }, platformConfig.shutdownGraceMs)
  forcedExit.unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
