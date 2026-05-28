import express from 'express'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { PikafishEngine } from './engine.js'
import { parseClientMessage } from './protocol.js'
import { validateFenPosition } from './validation.js'

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

const INITIAL_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'

let sharedEngine: PikafishEngine | null = null
let engineReady = false
let engineInitPromise: Promise<PikafishEngine | null> | null = null
let activeAnalysis: { sessionId: string; requestId?: string } | null = null

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

async function getEngine(): Promise<PikafishEngine | null> {
  if (sharedEngine && engineReady) return sharedEngine
  if (engineInitPromise) return engineInitPromise

  engineInitPromise = (async () => {
    if (sharedEngine) {
      sharedEngine.destroy()
    }

    sharedEngine = new PikafishEngine()
    engineReady = await sharedEngine.init()

    if (!engineReady) {
      console.warn('Engine not available, running in local-only mode')
      return null
    }

    sharedEngine.on('exit', () => {
      engineReady = false
    })

    return sharedEngine
  })()

  try {
    return await engineInitPromise
  } finally {
    engineInitPromise = null
  }
}

// Pre-init engine on startup
getEngine()

wss.on('connection', async (ws) => {
  console.log('Client connected')

  const sessionId = makeSessionId()
  let currentDifficulty: 'easy' | 'medium' | 'hard' | 'master' = 'medium'
  let infoHandler: ((info: unknown) => void) | null = null
  let localAnalysisRequestId: string | undefined
  let localAnalysisFen = INITIAL_FEN
  let localAnalysisMoves: string[] = []
  let requestGeneration = 0

  const attachAnalysisHandler = (engine: PikafishEngine) => {
    if (infoHandler) {
      engine.removeListener('info', infoHandler)
    }
    infoHandler = (info) => {
      if (
        activeAnalysis?.sessionId === sessionId &&
        activeAnalysis.requestId === localAnalysisRequestId &&
        ws.readyState === WebSocket.OPEN
      ) {
        ws.send(JSON.stringify({ type: 'info', requestId: localAnalysisRequestId, data: info }))
      }
    }
    engine.on('info', infoHandler)
  }

  const detachAnalysisHandler = (engine: PikafishEngine) => {
    if (infoHandler) {
      engine.removeListener('info', infoHandler)
      infoHandler = null
    }
  }

  const shouldResumeLocalAnalysis = () => (
    Boolean(localAnalysisRequestId) &&
    activeAnalysis?.sessionId === sessionId &&
    activeAnalysis.requestId === localAnalysisRequestId &&
    ws.readyState === WebSocket.OPEN
  )

  getEngine()
    .then(engine => sendEngineStatus(
      ws,
      Boolean(engine),
      engine ? 'Engine ready' : 'Engine not available',
    ))
    .catch(() => sendEngineStatus(ws, false, 'Engine not available'))

  ws.on('message', async (data) => {
    try {
      const parsed = parseClientMessage(data.toString())
      if (!parsed.ok) {
        sendError(ws, parsed.error, parsed.requestId)
        return
      }
      const msg = parsed.message

      switch (msg.type) {
        case 'init': {
          currentDifficulty = msg.difficulty || 'medium'
          sendEngineStatus(ws, Boolean(sharedEngine && engineReady), engineReady ? 'Engine ready' : 'Engine not available')
          break
        }

        case 'move': {
          const engine = await getEngine()
          if (!engine) {
            sendEngineStatus(ws, false, 'Engine not available')
            sendError(ws, 'Engine not available', msg.requestId)
            break
          }

          const requestDifficulty = msg.difficulty || currentDifficulty
          const requestId = msg.requestId
          const fen = msg.fen || INITIAL_FEN
          const moves: string[] = msg.moves || []
          const validation = validateFenPosition(fen)
          if (!validation.ok) {
            sendError(ws, validation.errors[0] || 'Invalid position', requestId)
            break
          }

          try {
            const generation = requestGeneration
            const startedAt = Date.now()
            const bestMove = await engine.getBestMove(fen, moves, requestDifficulty)
            if (bestMove && generation === requestGeneration && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'bestmove',
                requestId,
                move: bestMove,
                elapsedMs: Date.now() - startedAt,
                requestKind: 'move',
              }))
            }
          } catch (err) {
            console.error('Engine error:', err)
            sendError(ws, 'Engine error', requestId)
          }
          break
        }

        case 'hint': {
          const engine = await getEngine()
          if (!engine) {
            sendEngineStatus(ws, false, 'Engine not available')
            sendError(ws, 'Engine not available', msg.requestId)
            break
          }

          const requestId = msg.requestId
          const fen = msg.fen || INITIAL_FEN
          const moves: string[] = msg.moves || []
          const validation = validateFenPosition(fen)
          if (!validation.ok) {
            sendError(ws, validation.errors[0] || 'Invalid position', requestId)
            break
          }

          try {
            const generation = requestGeneration
            const startedAt = Date.now()
            const bestMove = await engine.getBestMove(fen, moves, msg.difficulty || 'master')
            if (bestMove && generation === requestGeneration && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'bestmove',
                requestId,
                move: bestMove,
                elapsedMs: Date.now() - startedAt,
                requestKind: 'hint',
              }))
            }
          } catch (err) {
            console.error('Hint engine error:', err)
            sendError(ws, 'Hint engine error', requestId)
          }
          break
        }

        case 'candidates': {
          const engine = await getEngine()
          if (!engine) {
            sendEngineStatus(ws, false, 'Engine not available')
            sendError(ws, 'Engine not available', msg.requestId)
            break
          }

          const requestId = msg.requestId
          const fen = msg.fen || INITIAL_FEN
          const moves: string[] = msg.moves || []
          const validation = validateFenPosition(fen)
          if (!validation.ok) {
            sendError(ws, validation.errors[0] || 'Invalid position', requestId)
            break
          }

          const resumeAnalysis = shouldResumeLocalAnalysis()
          if (resumeAnalysis) {
            detachAnalysisHandler(engine)
          }
          try {
            const generation = requestGeneration
            const candidates = await engine.getCandidates(fen, moves, msg.difficulty || currentDifficulty, msg.count || 3)
            if (generation === requestGeneration && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'candidates', requestId, candidates }))
            }
          } catch (err) {
            console.error('Candidate engine error:', err)
            sendError(ws, 'Candidate engine error', requestId)
          } finally {
            if (resumeAnalysis && shouldResumeLocalAnalysis()) {
              try {
                attachAnalysisHandler(engine)
                await engine.analyze(localAnalysisFen, localAnalysisMoves)
              } catch (err) {
                console.error('Resume analysis error:', err)
              }
            }
          }
          break
        }

        case 'analyze': {
          const engine = await getEngine()
          if (!engine) {
            sendEngineStatus(ws, false, 'Engine not available')
            sendError(ws, 'Engine not available', msg.requestId)
            break
          }

          const fen = msg.fen || INITIAL_FEN
          const moves: string[] = msg.moves || []
          const validation = validateFenPosition(fen)
          if (!validation.ok) {
            sendError(ws, validation.errors[0] || 'Invalid position', msg.requestId)
            break
          }

          localAnalysisRequestId = msg.requestId
          localAnalysisFen = fen
          localAnalysisMoves = moves
          activeAnalysis = { sessionId, requestId: msg.requestId }
          attachAnalysisHandler(engine)

          engine.stopAnalysis()
          await engine.analyze(fen, moves)
          break
        }

        case 'stop': {
          requestGeneration++
          if (sharedEngine) {
            detachAnalysisHandler(sharedEngine)
          }
          const stopsOwnAnalysis =
            activeAnalysis?.sessionId === sessionId &&
            (!msg.requestId || activeAnalysis.requestId === msg.requestId)
          if (stopsOwnAnalysis) {
            activeAnalysis = null
            localAnalysisRequestId = undefined
          }
          if (sharedEngine && engineReady) {
            sharedEngine.interruptSearch()
          }
          break
        }
      }
    } catch (err) {
      console.error('Message parse error:', err)
    }
  })

  ws.on('close', () => {
    console.log('Client disconnected')
    if (sharedEngine) {
      detachAnalysisHandler(sharedEngine)
    }
    if (activeAnalysis?.sessionId === sessionId) {
      activeAnalysis = null
      if (sharedEngine && engineReady) sharedEngine.stopAnalysis()
    }
  })
})

const PORT = process.env.PORT || 3001

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(`WebSocket available at ws://localhost:${PORT}/ws`)
})

process.on('SIGINT', () => {
  console.log('\nShutting down...')
  if (sharedEngine) {
    sharedEngine.destroy()
  }
  server.close()
  process.exit(0)
})
