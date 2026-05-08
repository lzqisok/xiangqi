import express from 'express'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { PikafishEngine } from './engine.js'

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

const INITIAL_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'

let sharedEngine: PikafishEngine | null = null
let engineReady = false

async function getEngine(): Promise<PikafishEngine | null> {
  if (sharedEngine && engineReady) return sharedEngine

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
}

// Pre-init engine on startup
getEngine()

wss.on('connection', async (ws) => {
  console.log('Client connected')

  let currentDifficulty: 'easy' | 'medium' | 'hard' | 'master' = 'medium'
  let infoHandler: ((info: unknown) => void) | null = null

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString())

      switch (msg.type) {
        case 'init': {
          currentDifficulty = msg.difficulty || 'medium'
          break
        }

        case 'move': {
          const engine = await getEngine()
          if (!engine) {
            ws.send(JSON.stringify({ type: 'error', message: 'Engine not available' }))
            break
          }

          const requestDifficulty = msg.difficulty || currentDifficulty
          engine.setDifficulty(requestDifficulty)
          const requestId = msg.requestId
          const fen = msg.fen || INITIAL_FEN
          const moves: string[] = msg.moves || []

          try {
            const startedAt = Date.now()
            const bestMove = await engine.getBestMove(fen, moves)
            if (bestMove && ws.readyState === WebSocket.OPEN) {
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
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'error', message: 'Engine error' }))
            }
          }
          break
        }

        case 'hint': {
          const engine = await getEngine()
          if (!engine) {
            ws.send(JSON.stringify({ type: 'error', message: 'Engine not available' }))
            break
          }

          engine.setDifficulty(msg.difficulty || 'master')
          const requestId = msg.requestId
          const fen = msg.fen || INITIAL_FEN
          const moves: string[] = msg.moves || []

          try {
            const startedAt = Date.now()
            const bestMove = await engine.getBestMove(fen, moves)
            if (bestMove && ws.readyState === WebSocket.OPEN) {
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
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'error', message: 'Hint engine error' }))
            }
          }
          break
        }

        case 'analyze': {
          const engine = await getEngine()
          if (!engine) break

          if (infoHandler) {
            engine.removeListener('info', infoHandler)
          }
          infoHandler = (info) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'info', data: info }))
            }
          }
          engine.on('info', infoHandler)

          engine.stopAnalysis()
          const fen = msg.fen || INITIAL_FEN
          const moves: string[] = msg.moves || []
          await engine.analyze(fen, moves)
          break
        }

        case 'stop': {
          if (infoHandler && sharedEngine) {
            sharedEngine.removeListener('info', infoHandler)
            infoHandler = null
          }
          if (sharedEngine && engineReady) {
            sharedEngine.stopAnalysis()
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
    if (infoHandler && sharedEngine) {
      sharedEngine.removeListener('info', infoHandler)
      infoHandler = null
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
