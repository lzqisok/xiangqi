import { DatabaseUnavailableError } from '../db/errors.js'
import type { WebSocket } from 'ws'
import type { UserActor } from '../auth/types.js'
import { OnlineMatchError, OnlineMatchService } from './service.js'
import type { OnlineActor, OnlineMatchRecord } from './types.js'
import { metrics, structuredLog } from '../platform/observability.js'
import { authoritativeClockNow } from './clock.js'
import { RecoveryTasks } from './recovery.js'

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
  private readonly clockTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly matchPhases = new Map<string, OnlineMatchRecord['match']['phase']>()

  private readonly failedVerdicts = new Set<string>()
  private readonly recovery: RecoveryTasks
  private scanTimer?: ReturnType<typeof setTimeout>
  private disposed = false

  constructor(
    readonly service: OnlineMatchService,
    private readonly disconnectGraceMs = 60_000,
    private readonly maxSpectatorsPerMatch = 50,
    private readonly maxPlayerConnectionsPerUser = 2,
    private readonly scanMs = 30_000,
    retryMs = 1_000,
  ) {
    this.recovery = new RecoveryTasks(retryMs)
  }

  isSubscribed(socket: WebSocket): boolean {
    return Boolean(this.connections.get(socket)?.matchId)
  }

  bind(socket: WebSocket, actor: UserActor) {
    this.connections.set(socket, { actor, player: false })
    metrics.gauge('xiangqi_online_connections', this.connections.size)
  }

  async restore() {
    await this.recovery.submit('scan', async () => {
      try {
        const records = await this.service.repository.recoverActiveMatches()
        const activeIds = new Set(records.map((record) => record.match.id))
        for (const [id, phase] of this.matchPhases) {
          if (phase === 'playing' && !activeIds.has(id)) await this.refresh(id)
        }
        const restartDeadline = new Date(Date.now() + this.disconnectGraceMs)
        for (const record of records) {
          if (this.disposed) return
          this.scheduleClock(record)
          if (record.match.phase !== 'playing') continue
          for (const participant of record.participants) {
            if (!participant.userId || !participant.side) continue
            const key = this.playerKey(record.match.id, participant.userId)
            if (this.playerSockets.has(key)) continue
            if (participant.disconnectDeadline) {
              this.scheduleDisconnect(
                record.match.id,
                participant.userId,
                participant.disconnectDeadline,
              )
            } else if (!this.recovery.has(`presence:${key}`)) {
              await this.presence(record.match.id, participant.userId, false, restartDeadline)
            }
          }
        }
      } finally {
        if (!this.disposed) {
          clearTimeout(this.scanTimer)
          this.scanTimer = setTimeout(() => void this.restore(), this.scanMs)
          this.scanTimer.unref()
        }
      }
    })
  }

  private presence(matchId: string, userId: string, connected: boolean, deadline?: Date) {
    return this.recovery.submit(`presence:${this.playerKey(matchId, userId)}`, async () => {
      if (this.playerSockets.has(this.playerKey(matchId, userId)) !== connected) return
      const updated = await this.service.repository.setPresence(
        matchId,
        userId,
        connected,
        deadline,
      )
      if (this.disposed) return
      if (updated && !connected && deadline) this.scheduleDisconnect(matchId, userId, deadline)
      await this.refresh(matchId)
    })
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
    if (this.failedVerdicts.has(matchId)) {
      const interrupted = await this.automaticVerdict(matchId, async () => null)
      if (interrupted) {
        await this.broadcast(interrupted)
        return
      }
    }
    const actor = connection.actor
    switch (message.type) {
      case 'match-ready':
        await this.broadcastResult(
          await this.service.safe(() => this.service.ready(actor, message)),
        )
        break
      case 'match-move':
        await this.broadcastResult(await this.service.safe(() => this.service.move(actor, message)))
        break
      case 'match-resign':
        await this.broadcastResult(
          await this.service.safe(() => this.service.resign(actor, message)),
        )
        break
      case 'match-propose':
        await this.broadcastResult(
          await this.service.safe(() => this.service.propose(actor, message)),
        )
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
    metrics.gauge('xiangqi_online_connections', this.connections.size)
    if (!connection.matchId) return
    const sockets = this.socketsByMatch.get(connection.matchId)
    sockets?.delete(socket)
    if (!sockets?.size) this.socketsByMatch.delete(connection.matchId)
    if (!connection.player) return
    const key = this.playerKey(connection.matchId, connection.actor.userId)
    if (this.playerSockets.get(key) !== socket) return
    this.playerSockets.delete(key)
    const deadline = new Date(Date.now() + this.disconnectGraceMs)
    void this.presence(connection.matchId, connection.actor.userId, false, deadline)
  }

  dispose() {
    this.disposed = true
    clearTimeout(this.scanTimer)
    this.recovery.dispose()
    for (const timer of this.disconnectTimers.values()) clearTimeout(timer)
    for (const timer of this.clockTimers.values()) clearTimeout(timer)
    this.disconnectTimers.clear()
    this.clockTimers.clear()
    this.connections.clear()
    this.socketsByMatch.clear()
    this.playerSockets.clear()
    this.matchPhases.clear()
    metrics.gauge('xiangqi_online_connections', 0)
    metrics.gauge('xiangqi_online_active_matches', 0)
  }

  async publish(records: readonly OnlineMatchRecord[]): Promise<void> {
    for (const record of records) await this.broadcast(record)
  }

  private async subscribe(socket: WebSocket, connection: Connection, matchId: string) {
    const record = await this.service.safe(() => this.service.get(connection.actor, matchId))
    if (connection.matchId && connection.matchId !== matchId) await this.leave(socket, connection)
    const participant = record.participants.find((item) => item.userId === connection.actor.userId)
    if (participant?.side && !connection.player) {
      const playerConnections = [...this.connections.entries()].filter(
        ([target, candidate]) =>
          target !== socket &&
          candidate.player &&
          candidate.actor.userId === connection.actor.userId &&
          candidate.matchId !== matchId,
      ).length
      if (playerConnections >= this.maxPlayerConnectionsPerUser) {
        throw new OnlineMatchError(
          'player_connection_quota_exceeded',
          429,
          '当前账号的公网棋手连接已达上限',
          30,
        )
      }
    }
    if (!participant?.side) {
      const spectators = [...(this.socketsByMatch.get(matchId) ?? [])].filter(
        (target) => target !== socket && !this.connections.get(target)?.player,
      ).length
      if (spectators >= this.maxSpectatorsPerMatch) {
        throw new OnlineMatchError('spectator_quota_exceeded', 429, '本局观战人数已达上限', 30)
      }
    }
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
      await this.presence(matchId, connection.actor.userId, true)
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
        await this.presence(previousMatchId, connection.actor.userId, false, deadline)
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
    if (this.disposed) return
    this.scheduleClock(record)
    const previousPhase = this.matchPhases.get(record.match.id)
    this.matchPhases.set(record.match.id, record.match.phase)
    if (record.match.phase === 'finished' && previousPhase !== 'finished') {
      metrics.increment('xiangqi_online_matches_completed', {
        variant: record.match.variant,
        reason: record.match.statusReason || 'board_result',
      })
      structuredLog('info', 'online_match_finished', {
        matchId: record.match.id,
        variant: record.match.variant,
        reason: record.match.statusReason || 'board_result',
      })
    }
    metrics.gauge(
      'xiangqi_online_active_matches',
      [...this.matchPhases.values()].filter((phase) => phase !== 'finished').length,
    )
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

  private async automaticVerdict(matchId: string, action: () => Promise<OnlineMatchRecord | null>) {
    try {
      if (this.failedVerdicts.has(matchId)) {
        const interrupted = await this.service.repository.interruptMatch(
          matchId,
          'service_failure',
          'automatic-recovery',
          '数据库不可用导致裁决失败，排位中止且不计分',
        )
        this.failedVerdicts.delete(matchId)
        if (interrupted) return interrupted
      }
      return await action()
    } catch (error) {
      if (error instanceof DatabaseUnavailableError) this.failedVerdicts.add(matchId)
      throw error
    }
  }

  private scheduleDisconnect(matchId: string, userId: string, deadline: Date) {
    const key = this.playerKey(matchId, userId)
    if (this.disposed) return
    clearTimeout(this.disconnectTimers.get(key))
    const timer = setTimeout(
      () => {
        this.disconnectTimers.delete(key)
        void this.recovery.submit(`disconnect:${key}`, async () => {
          if (this.playerSockets.has(key)) return
          const record = await this.automaticVerdict(matchId, () =>
            this.service.repository.adjudicateDisconnect(matchId, userId, deadline),
          )
          if (record) await this.broadcast(record)
        })
      },
      Math.max(0, deadline.getTime() - Date.now()),
    )
    timer.unref()
    this.disconnectTimers.set(key, timer)
  }

  private scheduleClock(record: OnlineMatchRecord) {
    if (this.disposed) return
    clearTimeout(this.clockTimers.get(record.match.id))
    this.clockTimers.delete(record.match.id)
    const deadlineAt = record.state.clock?.deadlineAt
    if (record.match.phase !== 'playing' || !deadlineAt) return
    const timer = setTimeout(
      () => {
        this.clockTimers.delete(record.match.id)
        void this.recovery.submit(`clock:${record.match.id}`, async () => {
          const finished = await this.automaticVerdict(record.match.id, () =>
            this.service.repository.adjudicateClock(record.match.id, deadlineAt),
          )
          if (finished) {
            if (finished.match.statusReason === 'timeout')
              metrics.increment('xiangqi_online_clock_timeouts', {
                variant: finished.match.variant,
              })
            await this.broadcast(finished)
          }
        })
      },
      Math.max(0, new Date(deadlineAt).getTime() - authoritativeClockNow().getTime()),
    )
    timer.unref()
    this.clockTimers.set(record.match.id, timer)
  }

  private playerKey(matchId: string, userId: string) {
    return `${matchId}:${userId}`
  }
}
