import type { WebSocket } from 'ws'
import type { UserActor } from '../auth/types.js'
import { OnlineMatchError, OnlineMatchService } from './service.js'
import type { OnlineActor, OnlineMatchRecord } from './types.js'

type Connection = {
  actor: OnlineActor
  matchId?: string
  player: boolean
}

function send(socket: WebSocket, message: unknown) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message))
}

export class OnlineMatchManager {
  private readonly connections = new Map<WebSocket, Connection>()
  private readonly socketsByMatch = new Map<string, Set<WebSocket>>()
  private readonly playerSockets = new Map<string, WebSocket>()
  private readonly disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    readonly service: OnlineMatchService,
    private readonly disconnectGraceMs = 60_000,
  ) {}

  bind(socket: WebSocket, actor: UserActor) {
    this.connections.set(socket, { actor, player: false })
  }

  async restore() {
    const records = await this.service.repository.recoverActiveMatches()
    for (const record of records) {
      if (record.match.phase !== 'playing') continue
      const restartDeadline = new Date(Date.now() + this.disconnectGraceMs)
      for (const participant of record.participants) {
        if (!participant.userId || !participant.side) continue
        const deadline = participant.disconnectDeadline ?? restartDeadline
        if (!participant.disconnectDeadline) {
          await this.service.repository.setPresence(record.match.id, participant.userId, false, deadline)
        }
        this.scheduleDisconnect(record.match.id, participant.userId, deadline)
      }
    }
  }

  async handle(socket: WebSocket, message: Record<string, unknown>) {
    const connection = this.connections.get(socket)
    if (!connection) throw new OnlineMatchError('authentication_required', 401)
    if (message.type === 'match-subscribe') {
      await this.subscribe(socket, connection, String(message.matchId || ''))
      return
    }
    const matchId = String(message.matchId || '')
    if (!connection.matchId || connection.matchId !== matchId) {
      throw new OnlineMatchError('match_not_subscribed', 403, '请先订阅当前对局')
    }
    const actor = connection.actor
    switch (message.type) {
      case 'match-ready':
        await this.broadcastResult(await this.service.safe(() => this.service.ready(actor, message)))
        break
      case 'match-move':
        await this.broadcastResult(await this.service.safe(() => this.service.move(actor, message)))
        break
      case 'match-resign':
        await this.broadcastResult(await this.service.safe(() => this.service.resign(actor, message)))
        break
      case 'match-propose':
        await this.broadcastResult(await this.service.safe(() => this.service.propose(actor, message)))
        break
      case 'match-proposal-respond':
        await this.broadcastResult(
          await this.service.safe(() => this.service.respondProposal(actor, message)),
        )
        break
      case 'match-proposal-withdraw':
        await this.broadcastResult(
          await this.service.safe(() => this.service.withdrawProposal(actor, message)),
        )
        break
      case 'match-chat-send': {
        const chat = await this.service.safe(() =>
          this.service.chat(actor, matchId, message.commandId, message.content),
        )
        for (const target of this.socketsByMatch.get(matchId) ?? []) {
          send(target, { type: 'match-chat-message', matchId, message: chat })
        }
        send(socket, { type: 'match-command-ack', matchId, commandId: message.commandId })
        break
      }
      case 'match-chat-delete':
        await this.service.safe(() =>
          this.service.deleteChat(actor, matchId, String(message.messageId || '')),
        )
        for (const target of this.socketsByMatch.get(matchId) ?? []) {
          send(target, {
            type: 'match-chat-delete',
            matchId,
            messageId: String(message.messageId || ''),
          })
        }
        break
      case 'match-chat-mute':
        await this.service.safe(() =>
          this.service.setMute(
            actor,
            matchId,
            String(message.targetUserId || ''),
            message.muted !== false,
          ),
        )
        send(socket, { type: 'match-command-ack', matchId, commandId: message.commandId })
        break
      default:
        throw new OnlineMatchError('unknown_match_command', 400, '无法识别的公网对局操作')
    }
  }

  disconnect(socket: WebSocket) {
    const connection = this.connections.get(socket)
    if (!connection) return
    this.connections.delete(socket)
    if (!connection.matchId) return
    const sockets = this.socketsByMatch.get(connection.matchId)
    sockets?.delete(socket)
    if (!sockets?.size) this.socketsByMatch.delete(connection.matchId)
    if (!connection.player) return
    const key = this.playerKey(connection.matchId, connection.actor.userId)
    if (this.playerSockets.get(key) !== socket) return
    this.playerSockets.delete(key)
    const deadline = new Date(Date.now() + this.disconnectGraceMs)
    void this.service.repository
      .setPresence(connection.matchId, connection.actor.userId, false, deadline)
      .then((updated) => {
        if (!updated) return
        this.scheduleDisconnect(connection.matchId!, connection.actor.userId, deadline)
        return this.refresh(connection.matchId!)
      })
      .catch(() => undefined)
  }

  dispose() {
    for (const timer of this.disconnectTimers.values()) clearTimeout(timer)
    this.disconnectTimers.clear()
    this.connections.clear()
    this.socketsByMatch.clear()
    this.playerSockets.clear()
  }

  private async subscribe(socket: WebSocket, connection: Connection, matchId: string) {
    const record = await this.service.safe(() => this.service.get(connection.actor, matchId))
    if (connection.matchId && connection.matchId !== matchId) await this.leave(socket, connection)
    const participant = record.participants.find((item) => item.userId === connection.actor.userId)
    connection.matchId = matchId
    connection.player = Boolean(participant?.side)
    const sockets = this.socketsByMatch.get(matchId) ?? new Set<WebSocket>()
    sockets.add(socket)
    this.socketsByMatch.set(matchId, sockets)
    if (connection.player) {
      const key = this.playerKey(matchId, connection.actor.userId)
      const old = this.playerSockets.get(key)
      this.playerSockets.set(key, socket)
      if (old && old !== socket) old.close(4001, 'Seat taken over by a newer connection')
      clearTimeout(this.disconnectTimers.get(key))
      this.disconnectTimers.delete(key)
      await this.service.repository.setPresence(matchId, connection.actor.userId, true)
    }
    send(socket, {
      type: 'match-chat-history',
      matchId,
      messages: await this.service.chatHistory(connection.actor, matchId),
    })
    await this.refresh(matchId)
  }

  private async leave(socket: WebSocket, connection: Connection) {
    if (!connection.matchId) return
    const previousMatchId = connection.matchId
    this.socketsByMatch.get(previousMatchId)?.delete(socket)
    if (!this.socketsByMatch.get(previousMatchId)?.size) this.socketsByMatch.delete(previousMatchId)
    if (connection.player) {
      const key = this.playerKey(previousMatchId, connection.actor.userId)
      if (this.playerSockets.get(key) === socket) {
        this.playerSockets.delete(key)
        const deadline = new Date(Date.now() + this.disconnectGraceMs)
        const updated = await this.service.repository.setPresence(
          previousMatchId,
          connection.actor.userId,
          false,
          deadline,
        )
        if (updated) this.scheduleDisconnect(previousMatchId, connection.actor.userId, deadline)
        await this.refresh(previousMatchId)
      }
    }
    connection.matchId = undefined
    connection.player = false
  }

  private async broadcastResult(result: { record: OnlineMatchRecord; duplicate: boolean }) {
    await this.broadcast(result.record)
  }

  private async refresh(matchId: string) {
    const sockets = this.socketsByMatch.get(matchId)
    const first = sockets?.values().next().value as WebSocket | undefined
    const actor = first ? this.connections.get(first)?.actor : undefined
    if (!actor) return
    const record = await this.service.get(actor, matchId)
    await this.broadcast(record)
  }

  private async broadcast(record: OnlineMatchRecord) {
    const sockets = this.socketsByMatch.get(record.match.id) ?? new Set<WebSocket>()
    const onlineUsers = new Set(
      [...sockets]
        .map((socket) => this.connections.get(socket))
        .filter((connection) => connection?.player)
        .map((connection) => connection!.actor.userId),
    )
    for (const socket of sockets) {
      const connection = this.connections.get(socket)
      if (!connection) continue
      send(socket, {
        type: 'match-snapshot',
        match: this.service.snapshot(record, connection.actor.userId, onlineUsers),
      })
    }
  }

  private scheduleDisconnect(matchId: string, userId: string, deadline: Date) {
    const key = this.playerKey(matchId, userId)
    clearTimeout(this.disconnectTimers.get(key))
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(key)
      void this.service.repository
        .adjudicateDisconnect(matchId, userId, deadline)
        .then((record) => (record ? this.broadcast(record) : undefined))
        .catch(() => undefined)
    }, Math.max(0, deadline.getTime() - Date.now()))
    timer.unref()
    this.disconnectTimers.set(key, timer)
  }

  private playerKey(matchId: string, userId: string) {
    return `${matchId}:${userId}`
  }
}
