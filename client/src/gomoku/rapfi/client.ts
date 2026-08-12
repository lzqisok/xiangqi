import type { Difficulty, Move, Player, Position } from '../core/types'

type RapfiStatus = 'idle' | 'connecting' | 'ready' | 'unavailable'

interface RapfiMoveRequest {
  moves: Move[]
  aiPlayer: Player
  difficulty: Difficulty
  forbiddenEnabled: boolean
}

interface PendingRequest {
  resolve: (move: Position) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class RapfiRequestCancelledError extends Error {
  constructor() {
    super('Rapfi request cancelled')
    this.name = 'RapfiRequestCancelledError'
  }
}

const REQUEST_TIMEOUT: Record<Difficulty, number> = {
  easy: 5_000,
  medium: 6_000,
  hard: 11_000,
  master: 16_000,
}

class RapfiClient {
  private socket: WebSocket | null = null
  private status: RapfiStatus = 'idle'
  private probePromise: Promise<boolean> | null = null
  private probeResolve: ((available: boolean) => void) | null = null
  private probeTimer: ReturnType<typeof setTimeout> | null = null
  private pending = new Map<string, PendingRequest>()
  private requestSequence = 0

  async probe(): Promise<boolean> {
    if (this.status === 'ready') return true
    if (this.status === 'unavailable') return false
    if (this.probePromise) return this.probePromise

    this.status = 'connecting'
    this.probePromise = new Promise(resolve => { this.probeResolve = resolve })
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${protocol}//${window.location.host}/gomoku-ws`)
    this.socket = socket

    socket.onopen = () => socket.send(JSON.stringify({ type: 'init' }))
    socket.onmessage = event => this.handleMessage(event.data)
    socket.onerror = () => socket.close()
    socket.onclose = () => {
      if (this.socket !== socket) return
      this.socket = null
      if (this.status !== 'unavailable') this.finishProbe(false)
      this.rejectPending(new Error('Rapfi connection closed'))
    }
    this.probeTimer = setTimeout(() => {
      this.finishProbe(false)
      socket.close()
    }, 25_000)

    return this.probePromise
  }

  async requestMove(request: RapfiMoveRequest): Promise<Position> {
    if (!await this.probe() || this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error('Rapfi engine is unavailable')
    }

    const requestId = `rapfi-${Date.now()}-${++this.requestSequence}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        if (this.socket?.readyState === WebSocket.OPEN) {
          this.socket.send(JSON.stringify({ type: 'stop', requestId }))
        }
        reject(new Error('Rapfi request timed out'))
      }, REQUEST_TIMEOUT[request.difficulty])
      this.pending.set(requestId, { resolve, reject, timer })
      this.socket!.send(JSON.stringify({ type: 'move', requestId, ...request }))
    })
  }

  cancelPending(): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'stop' }))
    this.rejectPending(new RapfiRequestCancelledError())
  }

  disconnect(): void {
    this.cancelPending()
    const socket = this.socket
    this.socket = null
    socket?.close()
    this.finishProbe(false, 'idle')
  }

  private handleMessage(raw: unknown): void {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(String(raw)) as Record<string, unknown>
    } catch {
      return
    }

    if (message.type === 'engine-status') {
      this.finishProbe(message.available === true)
      return
    }
    if (typeof message.requestId !== 'string') return
    const pending = this.pending.get(message.requestId)
    if (!pending) return
    this.pending.delete(message.requestId)
    clearTimeout(pending.timer)

    if (message.type === 'bestmove' && message.move && typeof message.move === 'object') {
      const move = message.move as Record<string, unknown>
      if (typeof move.row === 'number' && typeof move.col === 'number') {
        pending.resolve({ row: move.row, col: move.col })
        return
      }
    }
    pending.reject(new Error(typeof message.message === 'string' ? message.message : 'Rapfi request failed'))
  }

  private finishProbe(available: boolean, unavailableStatus: RapfiStatus = 'unavailable'): void {
    if (this.probeTimer) clearTimeout(this.probeTimer)
    this.probeTimer = null
    this.status = available ? 'ready' : unavailableStatus
    this.probeResolve?.(available)
    this.probeResolve = null
    this.probePromise = null
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    this.pending.clear()
  }
}

const client = new RapfiClient()

export const probeRapfi = () => client.probe()
export const requestRapfiMove = (request: RapfiMoveRequest) => client.requestMove(request)
export const cancelRapfiRequests = () => client.cancelPending()
export const disconnectRapfi = () => client.disconnect()
