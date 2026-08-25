import type { IncomingMessage } from 'node:http'
import { randomUUID } from 'node:crypto'
import { WebSocket, type WebSocketServer } from 'ws'
import { parseRapfiClientMessage } from './protocol.js'
import { RapfiEngine } from './rapfiEngine.js'
import { metrics, structuredLog } from '../platform/observability.js'
import { ResourceLimitError } from '../platform/resources.js'

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
  options: {
    liveEngines: Set<RapfiEngine>
    originAllowed?: (request: IncomingMessage) => boolean
    reserveProcess?: () => () => void
    reserveTask?: (owner: string) => () => void
    taskOwner?: (request: IncomingMessage) => string
  },
): void {
  wss.on('connection', (ws, request) => {
    if (!(options.originAllowed?.(request) ?? originAllowed(request))) {
      metrics.increment('xiangqi_ws_rejected', { reason: 'origin', scene: 'gomoku' })
      return ws.close(1008, 'Origin not allowed')
    }
    ;(ws as RapfiWebSocket).isAlive = true
    const connectionId = `gomoku-${randomUUID()}`
    structuredLog('info', 'ws_connected', { connectionId, scene: 'gomoku' })
    ws.on('pong', () => {
      ;(ws as RapfiWebSocket).isAlive = true
    })

    const engine = new RapfiEngine()
    options.liveEngines.add(engine)
    const requestGate = new RapfiRequestGate()
    let releaseProcess: (() => void) | undefined
    const owner = options.taskOwner?.(request) || request.socket.remoteAddress || 'unknown'
    engine.on('engine-exit', (code: number | null) => {
      releaseProcess?.()
      releaseProcess = undefined
      if (code !== null) metrics.increment('xiangqi_engine_exits', { kind: 'rapfi' })
    })

    const initialize = async () => {
      try {
        releaseProcess ??= options.reserveProcess?.()
      } catch {
        send(ws, {
          type: 'error',
          code: 'engine_process_quota_exceeded',
          message: 'Rapfi process quota exceeded',
          retryAfter: 10,
        })
        return false
      }
      const available = await engine.init()
      if (!available) {
        releaseProcess?.()
        releaseProcess = undefined
      }
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
      let releaseTask: (() => void) | undefined
      try {
        releaseTask = options.reserveTask?.(owner)
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
        structuredLog('warn', 'rapfi_search_failed', {
          errorCode: error instanceof Error ? error.name : 'unknown',
        })
        if (requestGeneration === requestGate.currentGeneration) {
          const quota = error instanceof ResourceLimitError
          send(ws, {
            type: 'error',
            requestId: request.requestId,
            code: quota ? error.code : 'rapfi_search_failed',
            message: quota ? 'Rapfi engine task quota exceeded' : 'Rapfi search failed',
            ...(quota ? { retryAfter: error.retryAfterSeconds } : {}),
          })
        }
      } finally {
        metrics.observe('xiangqi_engine_search_duration', Date.now() - startedAt, {
          kind: 'rapfi',
          task: 'move',
        })
        releaseTask?.()
        requestGate.finish(requestGeneration)
      }
    })

    ws.on('close', () => {
      structuredLog('info', 'ws_disconnected', { connectionId, scene: 'gomoku' })
      metrics.increment('xiangqi_ws_disconnects', { scene: 'gomoku' })
      requestGate.cancel()
      engine.destroy()
      releaseProcess?.()
      releaseProcess = undefined
      options.liveEngines.delete(engine)
    })
  })
}
