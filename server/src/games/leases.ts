import { randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'

type Lease = { ws: WebSocket; token: string }

export class GameLeaseManager {
  private readonly leases = new Map<string, Lease>()
  private readonly gamesBySocket = new Map<WebSocket, Set<string>>()

  claim(gameId: string, ws: WebSocket, force = false): { status: 'granted' | 'readonly'; leaseToken?: string } {
    const current = this.leases.get(gameId)
    if (current?.ws === ws) return { status: 'granted', leaseToken: current.token }
    if (current && !force) return { status: 'readonly' }
    if (current) {
      this.detach(gameId, current.ws)
      if (current.ws.readyState === WebSocket.OPEN) {
        current.ws.send(JSON.stringify({ type: 'game-lease-lost', gameId }))
      }
    }
    const token = randomUUID()
    this.leases.set(gameId, { ws, token })
    const games = this.gamesBySocket.get(ws) || new Set<string>()
    games.add(gameId)
    this.gamesBySocket.set(ws, games)
    return { status: 'granted', leaseToken: token }
  }

  release(gameId: string, ws: WebSocket): void {
    if (this.leases.get(gameId)?.ws !== ws) return
    this.leases.delete(gameId)
    this.detach(gameId, ws)
  }

  releaseSocket(ws: WebSocket): void {
    for (const gameId of this.gamesBySocket.get(ws) || []) {
      if (this.leases.get(gameId)?.ws === ws) this.leases.delete(gameId)
    }
    this.gamesBySocket.delete(ws)
  }

  hasLease(gameId: string): boolean {
    return this.leases.has(gameId)
  }

  validates(gameId: string, token: string | undefined): boolean {
    return Boolean(token) && this.leases.get(gameId)?.token === token
  }

  private detach(gameId: string, ws: WebSocket): void {
    const games = this.gamesBySocket.get(ws)
    games?.delete(gameId)
    if (games?.size === 0) this.gamesBySocket.delete(ws)
  }
}
