import type { IncomingMessage } from 'node:http'
import { WebSocket, type WebSocketServer } from 'ws'
import { parseRapfiClientMessage } from './protocol.js'
import { RapfiEngine } from './rapfiEngine.js'

export type RapfiWebSocket = WebSocket & { isAlive?: boolean }

export class RapfiRequestGate {
  private generation = 0
  private readonly activeGenerations = new Set<number>()

  get currentGeneration(): number {
    return this.generation
  }

  begin(): number | null {
    if (this.activeGenerations.has(this.generation) || this.activeGenerations.size >= 2) return null
    this.activeGenerations.add(this.generation)
    return this.generation
  }

  cancel(): void {
    this.generation += 1
  }

  finish(generation: number): void {
    this.activeGenerations.delete(generation)
  }
}

function send(ws: WebSocket, payload: object): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload))
}

function originAllowed(request: IncomingMessage): boolean {
  if (!request.headers.origin) return true
  try {
    return new URL(request.headers.origin).host === request.headers.host
  } catch {
    return false
  }
}

export function registerRapfiWebSocketServer(
  wss: WebSocketServer,
  options: { lanMode: boolean; liveEngines: Set<RapfiEngine> },
): void {
  wss.on('connection', (ws, request) => {
    if (options.lanMode && !originAllowed(request)) return ws.close(1008, 'Origin not allowed')
    ;(ws as RapfiWebSocket).isAlive = true
    ws.on('pong', () => {
      ;(ws as RapfiWebSocket).isAlive = true
    })

    const engine = new RapfiEngine()
    options.liveEngines.add(engine)
    const requestGate = new RapfiRequestGate()

    const initialize = async () => {
      const available = await engine.init()
      send(ws, {
        type: 'engine-status',
        available,
        engine: 'rapfi',
        message: available ? 'Rapfi ready' : 'Rapfi files are not available',
      })
      return available
    }

    ws.on('message', async (data) => {
      const parsed = parseRapfiClientMessage(data.toString())
      if (!parsed.ok) {
        send(ws, { type: 'error', requestId: parsed.requestId, message: parsed.error })
        return
      }

      if (parsed.message.type === 'stop') {
        requestGate.cancel()
        engine.interrupt()
        return
      }

      if (parsed.message.type === 'init') {
        await initialize()
        return
      }

      const request = parsed.message
      const requestGeneration = requestGate.begin()
      if (requestGeneration === null) {
        send(ws, { type: 'error', requestId: request.requestId, message: 'Rapfi engine is busy' })
        return
      }
      const startedAt = Date.now()
      try {
        if (!engine.available && !(await initialize())) {
          send(ws, {
            type: 'error',
            requestId: request.requestId,
            message: 'Rapfi engine is unavailable',
          })
          return
        }
        const move = await engine.getBestMove(request)
        if (requestGeneration === requestGate.currentGeneration) {
          send(ws, {
            type: 'bestmove',
            requestId: request.requestId,
            move,
            elapsedMs: Date.now() - startedAt,
            engine: 'rapfi',
          })
        }
      } catch (error) {
        console.error('Rapfi search error:', error)
        if (requestGeneration === requestGate.currentGeneration) {
          send(ws, { type: 'error', requestId: request.requestId, message: 'Rapfi search failed' })
        }
      } finally {
        requestGate.finish(requestGeneration)
      }
    })

    ws.on('close', () => {
      requestGate.cancel()
      engine.destroy()
      options.liveEngines.delete(engine)
    })
  })
}
