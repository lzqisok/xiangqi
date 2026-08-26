import { randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'

type Lease = { ws: WebSocket; token: string }

export class GameLeaseManager {
  private readonly leases = new Map<string, Lease>()
  private readonly gamesBySocket = new Map<WebSocket, Set<string>>()

  claim(
    gameId: string,
    ws: WebSocket,
    force = false,
    scope = 'local',
  ): { status: 'granted' | 'readonly'; leaseToken?: string } {
    const key = this.key(scope, gameId)
    const current = this.leases.get(key)
    if (current?.ws === ws) return { status: 'granted', leaseToken: current.token }
    if (current && !force) return { status: 'readonly' }
    if (current) {
      this.detach(key, current.ws)
      if (current.ws.readyState === WebSocket.OPEN) {
        current.ws.send(JSON.stringify({ type: 'game-lease-lost', gameId }))
      }
    }
    const token = randomUUID()
    this.leases.set(key, { ws, token })
    const games = this.gamesBySocket.get(ws) || new Set<string>()
    games.add(key)
    this.gamesBySocket.set(ws, games)
    return { status: 'granted', leaseToken: token }
  }

  release(gameId: string, ws: WebSocket, scope = 'local'): void {
    const key = this.key(scope, gameId)
    if (this.leases.get(key)?.ws !== ws) return
    this.leases.delete(key)
    this.detach(key, ws)
  }

  releaseSocket(ws: WebSocket): void {
    for (const key of this.gamesBySocket.get(ws) || []) {
      if (this.leases.get(key)?.ws === ws) this.leases.delete(key)
    }
    this.gamesBySocket.delete(ws)
  }

  hasLease(gameId: string, scope = 'local'): boolean {
    return this.leases.has(this.key(scope, gameId))
  }

  validates(gameId: string, token: string | undefined, scope = 'local'): boolean {
    return Boolean(token) && this.leases.get(this.key(scope, gameId))?.token === token
  }

  private detach(gameId: string, ws: WebSocket): void {
    const games = this.gamesBySocket.get(ws)
    games?.delete(gameId)
    if (games?.size === 0) this.gamesBySocket.delete(ws)
  }

  private key(scope: string, gameId: string): string {
    return `${scope}:${gameId}`
  }
}
