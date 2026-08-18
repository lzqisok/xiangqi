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
import { GameLeaseManager } from './games/leases.js'
import { RoomRepository } from './rooms/repository.js'
import { RoomManager } from './rooms/manager.js'
import { createRoomRouter } from './rooms/routes.js'
import { StoredRoom, RoomColor } from './rooms/types.js'
import { RapfiEngine } from './gomoku/rapfiEngine.js'
import { registerRapfiWebSocketServer, type RapfiWebSocket } from './gomoku/websocket.js'
import { listLanIPv4 } from './network.js'

const app = express()
const server = createServer(app)
const LAN_MODE = process.env.LAN_MODE === '1'
const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 })
const gomokuWss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '/', 'http://localhost').pathname
  const target = pathname === '/ws' ? wss : pathname === '/gomoku-ws' ? gomokuWss : null
  if (!target) {
    socket.destroy()
    return
  }
  target.handleUpgrade(request, socket, head, ws => target.emit('connection', ws, request))
})
type LiveWebSocket = WebSocket & { isAlive?: boolean }
const heartbeatTimer = setInterval(() => {
  for (const socketServer of [wss, gomokuWss]) {
    for (const client of socketServer.clients as Set<LiveWebSocket | RapfiWebSocket>) {
      if (client.isAlive === false) { client.terminate(); continue }
      client.isAlive = false
      client.ping()
    }
  }
}, 15_000)
heartbeatTimer.unref()
const serverDirectory = fileURLToPath(new URL('../', import.meta.url))
const gameRepository = new JsonGameRepository(process.env.XIANGQI_DATA_DIR || path.resolve(serverDirectory, '../data/games'))
const roomRepository = new RoomRepository(process.env.XIANGQI_ROOM_DIR || path.resolve(serverDirectory, '../data/rooms'))
const gameLeases = new GameLeaseManager()
await gameRepository.init().catch(error => console.error('Game store initialization failed:', error))
await roomRepository.init().catch(error => console.error('Room store initialization failed:', error))
app.use(express.json({ limit: '10mb' }))
app.get('/api/network-info', (_req, res) => {
  res.json({ addresses: listLanIPv4(os.networkInterfaces()) })
})
app.use('/api/games', (req, res, next) => {
  if (!LAN_MODE) return next()
  const address = req.socket.remoteAddress || ''
  if (address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1') return next()
  res.status(403).json({ error: '局域网访客不能访问本机对局库' })
}, createGameRouter(gameRepository, gameLeases))

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
  ready: boolean
  initPromise: Promise<PikafishEngine | null> | null
  runtimeOptions?: EngineRuntimeOptions
  disposed: boolean
}

const liveEngines = new Set<PikafishEngine>()

function makeSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function sendError(ws: WebSocket, message: string, requestId?: string) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'error', requestId, message }))
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

async function getEngine(slots: Record<EngineVariant, EngineSlot>, variant: EngineVariant = 'xiangqi'): Promise<PikafishEngine | null> {
  const slot = slots[variant]
  if (slot.disposed) return null
  if (slot.engine && slot.ready) return slot.engine
  if (slot.initPromise) return slot.initPromise

  slot.initPromise = (async () => {
    if (slot.engine) {
      slot.engine.destroy()
      liveEngines.delete(slot.engine)
    }

    const engine = new PikafishEngine(variant)
    liveEngines.add(engine)
    slot.engine = engine
    slot.ready = await engine.init(slot.runtimeOptions)

    if (slot.disposed) {
      engine.destroy()
      liveEngines.delete(engine)
      if (slot.engine === engine) slot.engine = null
      slot.ready = false
      return null
    }

    if (!slot.ready) {
      console.warn('Engine not available, running in local-only mode')
      return null
    }

    engine.on('exit', () => {
      if (slot.engine === engine) slot.ready = false
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
    slot.engine = null
    slot.ready = false
  }
}

const roomEngineSlots = createEngineSlots()
const JIEQI_INITIAL_FEN = 'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P5N2B2r2a2c2p5n2b2 0 1'
function roomIdentity(type: string, color: RoomColor) { return color === 'red' ? type.toUpperCase() : type }
async function getRoomHint(room: StoredRoom, viewer: RoomColor): Promise<string | null> {
  if (room.variant === 'gomoku') return null
  const engine = await getEngine(roomEngineSlots, room.variant)
  if (!engine) return null
  const moves = room.moves.map(move => {
    let text = move.uci
    if (move.revealed) text += roomIdentity(move.revealed, move.color)
    if (move.capturedHidden && move.captured && move.capturedColor && move.color === viewer) text += roomIdentity(move.captured, move.capturedColor)
    return text
  })
  const result = await engine.getBestMove(room.variant === 'jieqi' ? JIEQI_INITIAL_FEN : INITIAL_FEN, moves, 'master')
  return result.move?.slice(0, 4) || null
}
const roomManager = new RoomManager(roomRepository, getRoomHint)
void roomManager.cleanup().catch(error => console.error('Room cleanup failed:', error))
const roomCleanupTimer = setInterval(() => void roomManager.cleanup().catch(error => console.error('Room cleanup failed:', error)), 60 * 60 * 1000)
roomCleanupTimer.unref()
app.use('/api/rooms', createRoomRouter(roomManager))

const liveRapfiEngines = new Set<RapfiEngine>()
registerRapfiWebSocketServer(gomokuWss, { lanMode: LAN_MODE, liveEngines: liveRapfiEngines })

wss.on('connection', async (ws, request) => {
  if (LAN_MODE && request.headers.origin) {
    try {
      if (new URL(request.headers.origin).host !== request.headers.host) return ws.close(1008, 'Origin not allowed')
    } catch { return ws.close(1008, 'Origin not allowed') }
  }
  ;(ws as LiveWebSocket).isAlive = true
  ws.on('pong', () => { (ws as LiveWebSocket).isAlive = true })
  console.log('Client connected')

  const sessionId = makeSessionId()
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

  const shouldResumeLocalAnalysis = (variant: EngineVariant) => (
    Boolean(localAnalysisRequestId) &&
    localAnalysisVariant === variant &&
    activeAnalysis.get(variant)?.sessionId === sessionId &&
    activeAnalysis.get(variant)?.requestId === localAnalysisRequestId &&
    ws.readyState === WebSocket.OPEN
  )

  ws.on('message', async (data) => {
    try {
      const roomMessage = JSON.parse(data.toString()) as Record<string, unknown>
      if (typeof roomMessage.type === 'string' && roomMessage.type.startsWith('room-')) {
        try { await roomManager.handle(ws, roomMessage) }
        catch (error) { sendError(ws, error instanceof Error ? error.message : '房间操作失败', typeof roomMessage.commandId === 'string' ? roomMessage.commandId : undefined) }
        return
      }
      const parsed = parseClientMessage(data.toString())
      if (!parsed.ok) {
        sendError(ws, parsed.error, parsed.requestId)
        return
      }
      const msg = parsed.message
      switch (msg.type) {
        case 'claim-game':
        case 'takeover-game': {
          const result = gameLeases.claim(msg.gameId!, ws, msg.type === 'takeover-game')
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'game-lease', requestId: msg.requestId, gameId: msg.gameId, ...result }))
          }
          break
        }

        case 'release-game': {
          gameLeases.release(msg.gameId!, ws)
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
                console.error('Apply engine options error:', err)
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
            const result = await engine.getBestMove(fen, moves, requestDifficulty, getSearchLimit(msg))
            if (!result.move) {
              sendError(ws, 'Engine returned no move', requestId)
            } else if (generation === requestGeneration && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'bestmove',
                requestId,
                move: result.move,
                elapsedMs: Date.now() - startedAt,
                requestKind: 'move',
                searchCapped: result.searchCapped,
              }))
            }
          } catch (err) {
            console.error('Engine error:', err)
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
            const result = await engine.getBestMove(fen, moves, msg.difficulty || 'master', getSearchLimit(msg))
            if (!result.move) {
              sendError(ws, 'Engine returned no hint', requestId)
            } else if (generation === requestGeneration && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'bestmove',
                requestId,
                move: result.move,
                elapsedMs: Date.now() - startedAt,
                requestKind: 'hint',
                searchCapped: result.searchCapped,
              }))
            }
          } catch (err) {
            console.error('Hint engine error:', err)
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
            const candidates = await engine.getCandidates(fen, moves, msg.difficulty || currentDifficulty, msg.count || 3, getSearchLimit(msg))
            if (generation === requestGeneration && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'candidates', requestId, candidates }))
            }
          } catch (err) {
            console.error('Candidate engine error:', err)
            sendError(ws, 'Candidate engine error', requestId)
          } finally {
            if (requestId) activeFiniteRequests.delete(requestId)
            if (resumeAnalysis && shouldResumeLocalAnalysis(msg.variant || 'xiangqi')) {
              try {
                attachAnalysisHandler(engine)
                await engine.analyze(localAnalysisFen, localAnalysisMoves, localAnalysisLimit)
              } catch (err) {
                console.error('Resume analysis error:', err)
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
              const redToMove = prefixLength % 2 === 0
                ? initialTurn === 'red'
                : initialTurn === 'black'
              positions.push({
                moveIndex: prefixLength - 1,
                evaluation: redToMove ? candidate.score : -candidate.score,
                depth: candidate.depth,
                bestMove: candidate.move,
                pv: candidate.pv,
              })
              ws.send(JSON.stringify({
                type: 'review-progress',
                requestId,
                completed: prefixLength + 1,
                total: moves.length + 1,
              }))
            }

            if (generation === requestGeneration && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'review-result', requestId, positions }))
            }
          } catch (err) {
            console.error('Review engine error:', err)
            sendError(ws, 'Review engine error', requestId)
          } finally {
            if (requestId) activeFiniteRequests.delete(requestId)
            if (resumeAnalysis && shouldResumeLocalAnalysis(msg.variant || 'xiangqi')) {
              try {
                attachAnalysisHandler(engine)
                await engine.analyze(localAnalysisFen, localAnalysisMoves, localAnalysisLimit)
              } catch (err) {
                console.error('Resume analysis error:', err)
              }
            }
          }
          break
        }

        case 'analyze': {
          const engine = await getEngine(engineSlots, msg.variant)
          if (!engine) {
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
          const analysis = localAnalysisVariant ? activeAnalysis.get(localAnalysisVariant) : undefined
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
          }
          const enginesToInterrupt = new Set<PikafishEngine>()
          if (msg.requestId) {
            const finiteEngine = activeFiniteRequests.get(msg.requestId)
            if (finiteEngine) enginesToInterrupt.add(finiteEngine)
          } else {
            for (const finiteEngine of activeFiniteRequests.values()) enginesToInterrupt.add(finiteEngine)
          }
          if (stopsOwnAnalysis && localAnalysisEngine) enginesToInterrupt.add(localAnalysisEngine)
          for (const engine of enginesToInterrupt) engine.interruptSearch()
          if (stopsOwnAnalysis) localAnalysisEngine = null
          break
        }
      }
    } catch (err) {
      console.error('Message parse error:', err)
    }
  })

  ws.on('close', () => {
    console.log('Client disconnected')
    if (localAnalysisEngine) detachAnalysisHandler(localAnalysisEngine)
    if (localAnalysisVariant && activeAnalysis.get(localAnalysisVariant)?.sessionId === sessionId) {
      activeAnalysis.delete(localAnalysisVariant)
      localAnalysisEngine?.stopAnalysis()
    }
    destroyEngineSlots(engineSlots)
    gameLeases.releaseSocket(ws)
    if (!shuttingDown) roomManager.disconnect(ws)
  })
})

if (LAN_MODE) {
  const clientDist = path.resolve(serverDirectory, '../client/dist')
  app.use(express.static(clientDist))
  app.get('*', (req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.join(clientDist, 'index.html')))
}

const PORT = process.env.PORT || 3001
const HOST = process.env.HOST || (LAN_MODE ? '0.0.0.0' : '127.0.0.1')

server.listen(Number(PORT), HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`)
  console.log(`WebSocket available at ws://${HOST}:${PORT}/ws`)
  console.log(`Rapfi WebSocket available at ws://${HOST}:${PORT}/gomoku-ws`)
  if (LAN_MODE) {
    const addresses = listLanIPv4(os.networkInterfaces()).map(address => `http://${address}:${PORT}/?lan=1`)
    for (const address of addresses) console.log(`LAN lobby: ${address}`)
  }
})

let shuttingDown = false
function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  console.log('\nShutting down...')
  clearInterval(heartbeatTimer)
  clearInterval(roomCleanupTimer)
  for (const engine of liveEngines) engine.destroy()
  liveEngines.clear()
  for (const engine of liveRapfiEngines) engine.destroy()
  liveRapfiEngines.clear()
  for (const client of wss.clients) client.terminate()
  for (const client of gomokuWss.clients) client.terminate()
  wss.close()
  gomokuWss.close()
  roomManager.dispose()
  const serverClosed = new Promise<void>(resolve => server.close(() => resolve()))
  Promise.allSettled([gameRepository.flush(), roomManager.flush(), serverClosed]).then(results => {
    const failed = results.some(result => result.status === 'rejected')
    if (failed) console.error('Shutdown completed with errors:', results)
    process.exit(failed ? 1 : 0)
  })
  const forcedExit = setTimeout(() => {
    console.error('Shutdown timed out')
    process.exit(1)
  }, 5_000)
  forcedExit.unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
