import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { WebSocket } from 'ws'
import { containsSensitiveWord, normalizeRoomSensitiveWords } from './chatPolicy.js'
import { MAX_ROOM_CHAT_CONTENT_LENGTH } from './chatRepository.js'
import {
  createRoomInitialState,
  executeRoomMoveFromState,
  projectBoard,
  rebuildRoomBoard,
} from './core.js'
import { executeGomokuMove, rebuildGomokuRoom, RebuiltGomokuRoom } from './gomokuCore.js'
import { RoomRepository } from './repository.js'
import { RoomColor, RoomRole, RoomSnapshot, RoomSummary, StoredRoom } from './types.js'

type Connection = {
  roomId: string
  role: RoomRole
  isOwner: boolean
  token?: string
  nickname: string
  authorId: string
}
type Application = { id: string; ws: WebSocket; nickname: string; side: RoomColor }
type Proposal = { by: RoomColor; deadline: number; timer: NodeJS.Timeout }
type PresenceTimer = { deadline: number; timer: NodeJS.Timeout }
type Runtime = {
  sockets: Set<WebSocket>
  applications: Map<string, Application>
  pendingDraw?: Proposal
  pendingUndo?: Proposal
  pendingSwap?: Proposal
  ownerDisconnect?: PresenceTimer
  seatDisconnects: Partial<Record<RoomColor, PresenceTimer>>
  disconnect?: { color: RoomColor | 'both'; deadline: number; timer: NodeJS.Timeout }
  cached?: {
    revision: number
    layout?: string
    moveCount: number
    lastMove?: string
    rebuilt: ReturnType<typeof rebuildRoomBoard> | RebuiltGomokuRoom
  }
  commands: Map<string, { revision: number }>
  chatCommands: Map<string, { messageId?: string }>
  queue: Promise<void>
}

export type RoomHintProvider = (room: StoredRoom, color: RoomColor) => Promise<string | null>
export type RoomManagerOptions = {
  proposalTimeoutMs?: number
  waitingDisconnectTimeoutMs?: number
  startupRecoveryTimeoutMs?: number
  waitingTtlMs?: number
  abandonedTtlMs?: number
  finishedTtlMs?: number
}

const DAY = 24 * 60 * 60 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}
function matches(value: string | undefined, expected: string | undefined) {
  if (!value || !expected) return false
  const left = Buffer.from(hash(value)),
    right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}
function send(ws: WebSocket, message: unknown) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
}
function normalizeChatContent(value: unknown) {
  const content = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
  if (!content) throw new Error('消息不能为空')
  if (Array.from(content).length > MAX_ROOM_CHAT_CONTENT_LENGTH)
    throw new Error(`消息不能超过 ${MAX_ROOM_CHAT_CONTENT_LENGTH} 个字符`)
  if (content.split('\n').length > 4) throw new Error('消息最多允许四行')
  return content
}
function normalizeNickname(value: unknown, fallback: string) {
  return (
    String(value ?? '')
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 20) || fallback
  )
}

export class RoomManager {
  private readonly connections = new Map<WebSocket, Connection>()
  private readonly runtime = new Map<string, Runtime>()
  private readonly rates = new WeakMap<WebSocket, { startedAt: number; count: number }>()
  private readonly chatRates = new WeakMap<WebSocket, { startedAt: number; count: number }>()

  constructor(
    private readonly repository: RoomRepository,
    private readonly hintProvider: RoomHintProvider,
    private readonly disconnectTimeoutMs = 60_000,
    private readonly options: RoomManagerOptions = {},
  ) {}

  async createRoom(
    name: string,
    variant: 'xiangqi' | 'jieqi' | 'gomoku',
    gomokuRule: 'freestyle' | 'renju' = 'freestyle',
  ) {
    if (this.repository.list().filter((room) => room.phase !== 'finished').length >= 100) {
      await this.cleanup()
      if (this.repository.list().filter((room) => room.phase !== 'finished').length >= 100)
        throw new Error('活跃对局数量已达到上限')
    }
    const ownerToken = randomUUID(),
      inviteToken = randomUUID(),
      now = Date.now()
    const room: StoredRoom = {
      schemaVersion: 1,
      id: randomUUID(),
      name:
        name.trim().slice(0, 60) ||
        (variant === 'jieqi' ? '揭棋对局' : variant === 'gomoku' ? '五子棋对局' : '象棋对局'),
      variant,
      gomokuRule: variant === 'gomoku' ? gomokuRule : undefined,
      phase: 'waiting',
      revision: 0,
      ownerHash: hash(ownerToken),
      inviteHash: hash(inviteToken),
      seats: {},
      moves: [],
      status: 'playing',
      createdAt: now,
      updatedAt: now,
    }
    const saved = await this.repository.create(room)
    this.updatePresence(saved)
    return { room: saved, ownerToken, inviteToken }
  }

  startPresenceRecovery() {
    for (const room of this.repository.list()) this.updatePresence(room, true)
  }

  lobby(game?: 'xiangqi' | 'gomoku'): RoomSummary[] {
    return this.repository
      .list()
      .filter(
        (room) =>
          room.phase !== 'finished' &&
          (room.phase !== 'waiting' || this.ownerOnline(room.id)) &&
          (!game || (game === 'gomoku') === (room.variant === 'gomoku')),
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((room) => this.summary(room))
  }

  history(limit = 20, game?: 'xiangqi' | 'gomoku'): RoomSummary[] {
    return this.repository
      .list()
      .filter(
        (room) =>
          room.phase === 'finished' &&
          (!game || (game === 'gomoku') === (room.variant === 'gomoku')),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, Math.max(1, Math.min(limit, 100)))
      .map((room) => this.summary(room))
  }

  publicRoom(id: string) {
    const room = this.repository.get(id)
    return room ? this.summary(room) : null
  }

  async handle(ws: WebSocket, message: Record<string, unknown>) {
    const now = Date.now()
    const rate = this.rates.get(ws)
    if (!rate || now - rate.startedAt >= 5_000) this.rates.set(ws, { startedAt: now, count: 1 })
    else if (++rate.count > 40) throw new Error('操作过于频繁，请稍后再试')
    const type = String(message.type || '')
    if (type === 'room-subscribe') {
      const roomId = String(message.roomId || '')
      if (!this.repository.get(roomId)) throw new Error('对局不存在')
      const target = this.getRuntime(roomId)
      const previous = this.connections.get(ws)
      const involved =
        previous && previous.roomId !== roomId
          ? [this.getRuntime(previous.roomId), target]
          : [target]
      const operation = Promise.all(involved.map((runtime) => runtime.queue)).then(() =>
        this.subscribe(ws, message),
      )
      for (const runtime of involved) runtime.queue = operation.catch(() => undefined)
      return operation
    }
    const connection = this.connections.get(ws)
    if (!connection) throw new Error('请先进入对局')
    const runtime = this.getRuntime(connection.roomId)
    const operation = runtime.queue.then(() => this.handleLocked(ws, message))
    runtime.queue = operation.catch(() => undefined)
    return operation
  }

  private async handleLocked(ws: WebSocket, message: Record<string, unknown>) {
    const type = String(message.type || '')
    const connection = this.connections.get(ws)
    if (!connection) throw new Error('请先进入对局')
    const commandId =
      typeof message.commandId === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(message.commandId)
        ? message.commandId
        : undefined
    if (!commandId) throw new Error('操作标识无效')
    const room = this.requireRoom(connection.roomId)
    if (message.roomId !== room.id) throw new Error('对局不匹配')
    if (type === 'room-chat-send')
      return this.sendChat(ws, room, connection, commandId, message.content, message.nickname)
    if (type === 'room-chat-delete')
      return this.deleteChatMessage(ws, room, connection, commandId, message.messageId)
    if (type === 'room-chat-mute')
      return this.muteChatMember(ws, room, connection, commandId, message.authorId, message.muted)
    if (type === 'room-chat-settings-update')
      return this.updateChatSettings(ws, room, connection, commandId, message)
    if (!Number.isInteger(message.expectedRevision) || Number(message.expectedRevision) < 0)
      throw new Error('对局版本无效')
    if (this.getRuntime(room.id).commands.has(commandId)) return this.sendSnapshot(ws, room)
    if (message.expectedRevision !== undefined && message.expectedRevision !== room.revision)
      return this.sendSnapshot(ws, room, '状态已更新，请重试')

    switch (type) {
      case 'room-claim-seat':
        await this.claimSeat(ws, room, message)
        break
      case 'room-invite-seat':
        await this.inviteSeat(ws, room, message)
        break
      case 'room-seat-request':
        this.requestSeat(ws, room, message)
        break
      case 'room-seat-approve':
        await this.approveSeat(ws, room, message)
        break
      case 'room-leave-seat':
        await this.leaveSeat(ws, room)
        break
      case 'room-switch-seat':
        await this.switchSeat(room, connection, message.side)
        break
      case 'room-remove-seat':
        await this.removeSeat(room, connection, message.side)
        break
      case 'room-renew-invite':
        await this.renewInvite(ws, room, connection)
        break
      case 'room-dissolve':
        await this.dissolve(room, connection)
        break
      case 'room-ready':
        await this.ready(ws, room, Boolean(message.ready))
        break
      case 'room-swap-request':
        await this.propose(room, connection, 'swap')
        break
      case 'room-swap-response':
        await this.respondSwap(room, connection, Boolean(message.accept))
        break
      case 'room-move':
        await this.move(
          room,
          connection,
          String(message.uci || ''),
          Number(message.row),
          Number(message.col),
        )
        break
      case 'room-hint':
        await this.hint(ws, room, connection)
        break
      case 'room-undo-request':
        await this.propose(room, connection, 'undo')
        break
      case 'room-undo-response':
        await this.respondUndo(room, connection, Boolean(message.accept))
        break
      case 'room-draw-offer':
        await this.propose(room, connection, 'draw')
        break
      case 'room-draw-response':
        await this.respondDraw(room, connection, Boolean(message.accept))
        break
      case 'room-proposal-cancel':
        this.cancelProposal(room, connection, String(message.kind || ''))
        break
      case 'room-resign':
        await this.resign(room, connection)
        break
      default:
        throw new Error('不支持的对局操作')
    }
    if (this.repository.get(room.id)) this.rememberCommand(room.id, commandId, room.revision)
  }

  disconnect(ws: WebSocket) {
    const connection = this.connections.get(ws)
    if (!connection) return
    this.connections.delete(ws)
    const runtime = this.getRuntime(connection.roomId)
    runtime.sockets.delete(ws)
    for (const [id, application] of runtime.applications)
      if (application.ws === ws) runtime.applications.delete(id)
    const room = this.repository.get(connection.roomId)
    if (!room) return
    this.updatePresence(room)
    this.broadcast(room)
  }

  async flush() {
    await Promise.all([...this.runtime.values()].map((runtime) => runtime.queue))
    await this.repository.flush()
  }

  async cleanup(now = Date.now()) {
    await Promise.all(
      this.repository.list().map((room) => {
        const runtime = this.getRuntime(room.id)
        const operation = runtime.queue.then(() => this.cleanupLocked(room.id, now))
        runtime.queue = operation.catch((error) => console.error('Room cleanup failed:', error))
        return operation
      }),
    )
  }

  private async cleanupLocked(roomId: string, now: number) {
    const waitingTtl = this.options.waitingTtlMs ?? DAY
    const abandonedTtl = this.options.abandonedTtlMs ?? DAY
    const finishedTtl = this.options.finishedTtlMs ?? 30 * DAY
    const room = this.repository.get(roomId)
    if (!room) return
    const runtime = this.getRuntime(room.id)
    const hasSockets = runtime.sockets.size > 0
    const hasPlayers = [...runtime.sockets].some((socket) => {
      const role = this.connections.get(socket)?.role
      return role === 'red' || role === 'black'
    })
    if (room.phase === 'waiting' && !hasSockets && now - room.updatedAt >= waitingTtl) {
      await this.deleteRoom(room.id)
    } else if (room.phase === 'playing' && !hasPlayers && now - room.updatedAt >= abandonedTtl) {
      await this.finishAbandoned(room, now)
    } else if (
      room.phase === 'finished' &&
      !hasSockets &&
      now - (room.finishedAt ?? room.updatedAt) >= finishedTtl
    ) {
      await this.deleteRoom(room.id)
    }
  }

  dispose() {
    for (const [id] of this.runtime) {
      this.clearPresence(id)
      this.clearProposals(id)
    }
  }

  private async deleteRoom(id: string) {
    const runtime = this.runtime.get(id)
    if (runtime) {
      this.clearPresence(id)
      this.clearProposals(id)
    }
    await this.repository.delete(id)
    this.runtime.delete(id)
  }

  private subscribe(ws: WebSocket, message: Record<string, unknown>) {
    if (ws.readyState !== WebSocket.OPEN) return
    const room = this.requireRoom(String(message.roomId || ''))
    const token =
      typeof message.token === 'string' && message.token.length <= 200 ? message.token : undefined
    let role: RoomRole = 'spectator',
      isOwner = matches(token, room.ownerHash)
    for (const color of ['red', 'black'] as const)
      if (matches(token, room.seats[color]?.credentialHash)) role = color
    const previous = this.connections.get(ws)
    const runtime = this.getRuntime(room.id)
    if (
      role === 'spectator' &&
      (!previous || previous.roomId !== room.id) &&
      [...runtime.sockets].filter((socket) => this.connections.get(socket)?.role === 'spectator')
        .length >= 50
    )
      throw new Error('观众人数已满')
    if (previous && previous.roomId !== room.id) this.leaveSubscribedRoom(ws, previous.roomId)
    const clientId =
      typeof message.clientId === 'string' && UUID.test(message.clientId)
        ? message.clientId
        : randomUUID()
    const identity = isOwner ? `owner:${room.ownerHash}` : `client:${clientId}`
    this.connections.set(ws, {
      roomId: room.id,
      role,
      isOwner,
      token,
      nickname: normalizeNickname(message.nickname, '访客'),
      authorId: hash(`chat:${room.id}:${identity}`),
    })
    runtime.sockets.add(ws)
    if (role === 'red' || role === 'black') {
      for (const socket of runtime.sockets) {
        if (socket === ws) continue
        const existing = this.connections.get(socket)
        if (existing?.role === role) {
          existing.role = 'spectator'
          send(socket, { type: 'room-seat-lost', roomId: room.id })
        }
      }
    }
    this.updatePresence(room)
    this.broadcast(room)
    this.sendChatHistory(ws, room.id)
    this.sendChatSettings(ws, room.id)
  }

  private leaveSubscribedRoom(ws: WebSocket, roomId: string) {
    const runtime = this.getRuntime(roomId)
    runtime.sockets.delete(ws)
    for (const [id, application] of runtime.applications)
      if (application.ws === ws) runtime.applications.delete(id)
    const previousRoom = this.repository.get(roomId)
    if (!previousRoom) return
    this.updatePresence(previousRoom)
    this.broadcast(previousRoom)
  }

  private async claimSeat(ws: WebSocket, room: StoredRoom, message: Record<string, unknown>) {
    const connection = this.connections.get(ws)!
    if (!connection.isOwner || room.phase !== 'waiting') throw new Error('无权直接占用席位')
    await this.assignSeat(
      ws,
      room,
      message.side,
      String(message.nickname || connection.nickname),
      connection.token,
    )
  }

  private async inviteSeat(ws: WebSocket, room: StoredRoom, message: Record<string, unknown>) {
    this.requireWaitingOwnerOnline(room)
    if (!matches(String(message.inviteToken || ''), room.inviteHash) || room.phase !== 'waiting')
      throw new Error('邀请链接无效或已使用')
    room.inviteHash = undefined
    await this.assignSeat(ws, room, message.side, String(message.nickname || '受邀棋手'))
  }

  private requestSeat(ws: WebSocket, room: StoredRoom, message: Record<string, unknown>) {
    if (room.phase !== 'waiting') throw new Error('对局已经开始')
    this.requireWaitingOwnerOnline(room)
    const side = message.side
    if ((side !== 'red' && side !== 'black') || room.seats[side]) throw new Error('该席位不可用')
    const runtime = this.getRuntime(room.id)
    for (const [id, current] of runtime.applications)
      if (current.ws === ws) runtime.applications.delete(id)
    const application: Application = {
      id: randomUUID(),
      ws,
      nickname: normalizeNickname(message.nickname, '申请者'),
      side,
    }
    runtime.applications.set(application.id, application)
    this.broadcast(room)
  }

  private async approveSeat(ws: WebSocket, room: StoredRoom, message: Record<string, unknown>) {
    const connection = this.connections.get(ws)!
    if (!connection.isOwner) throw new Error('只有对局发起人可以审批')
    const runtime = this.getRuntime(room.id),
      application = runtime.applications.get(String(message.applicationId || ''))
    if (!application) throw new Error('申请已经失效')
    runtime.applications.delete(application.id)
    if (!message.accept) return this.broadcast(room)
    await this.assignSeat(application.ws, room, application.side, application.nickname)
  }

  private async assignSeat(
    ws: WebSocket,
    room: StoredRoom,
    rawSide: unknown,
    nickname: string,
    existingToken?: string,
  ) {
    const side = rawSide === 'red' || rawSide === 'black' ? rawSide : null
    if (!side || room.seats[side]) throw new Error('该席位不可用')
    const connection = this.connections.get(ws)
    if (connection?.role === 'red' || connection?.role === 'black')
      throw new Error('当前已经占用一个席位')
    const seatToken = existingToken || randomUUID()
    room.seats[side] = {
      nickname: normalizeNickname(nickname, side === 'red' ? '红方' : '黑方'),
      credentialHash: hash(seatToken),
      ready: false,
      hintsUsed: 0,
    }
    this.touch(room)
    await this.repository.save(room)
    if (connection) {
      connection.role = side
      connection.token = seatToken
    }
    send(ws, { type: 'room-seat-token', roomId: room.id, token: seatToken, role: side })
    this.updatePresence(room)
    this.broadcast(room)
  }

  private async leaveSeat(ws: WebSocket, room: StoredRoom) {
    if (room.phase !== 'waiting') throw new Error('对局开始后请使用认输结束对局')
    const connection = this.connections.get(ws)!
    const color = this.color(connection)
    delete room.seats[color]
    this.clearProposals(room.id)
    this.touch(room)
    await this.repository.save(room)
    connection.role = 'spectator'
    connection.token = connection.isOwner ? connection.token : undefined
    send(ws, { type: 'room-seat-lost', roomId: room.id })
    this.clearSeatDisconnect(room.id, color)
    this.updatePresence(room)
    this.broadcast(room)
  }

  private async switchSeat(room: StoredRoom, connection: Connection, rawSide: unknown) {
    if (room.phase !== 'waiting') throw new Error('只能在开局前切换席位')
    this.requireWaitingOwnerOnline(room)
    const current = this.color(connection)
    const target = rawSide === 'red' || rawSide === 'black' ? rawSide : null
    if (!target || target === current) throw new Error('目标席位无效')
    if (room.seats[target]) throw new Error('目标席位已有棋手，请申请交换红黑')
    room.seats[target] = { ...room.seats[current]!, ready: false }
    delete room.seats[current]
    const runtime = this.getRuntime(room.id)
    for (const [id, application] of runtime.applications)
      if (application.side === target) runtime.applications.delete(id)
    this.clearProposals(room.id)
    this.touch(room)
    await this.repository.save(room)
    this.refreshRoles(room)
    this.updatePresence(room)
    this.broadcast(room)
  }

  private async removeSeat(room: StoredRoom, connection: Connection, rawSide: unknown) {
    if (!connection.isOwner || room.phase !== 'waiting')
      throw new Error('只有对局发起人能在开局前移除棋手')
    const side = rawSide === 'red' || rawSide === 'black' ? rawSide : null
    if (!side || !room.seats[side]) throw new Error('该席位没有棋手')
    delete room.seats[side]
    this.clearSeatDisconnect(room.id, side)
    this.clearProposals(room.id)
    this.touch(room)
    await this.repository.save(room)
    for (const socket of this.getRuntime(room.id).sockets) {
      const target = this.connections.get(socket)
      if (target?.role !== side) continue
      target.role = 'spectator'
      if (!target.isOwner) target.token = undefined
      send(socket, { type: 'room-seat-lost', roomId: room.id })
    }
    this.updatePresence(room)
    this.broadcast(room)
  }

  private async renewInvite(ws: WebSocket, room: StoredRoom, connection: Connection) {
    if (!connection.isOwner || room.phase !== 'waiting')
      throw new Error('只有对局发起人能重新生成邀请链接')
    const inviteToken = randomUUID()
    room.inviteHash = hash(inviteToken)
    this.touch(room)
    await this.repository.save(room)
    send(ws, { type: 'room-invite-token', roomId: room.id, inviteToken })
    this.broadcast(room)
  }

  private async dissolve(room: StoredRoom, connection: Connection) {
    if (!connection.isOwner || room.phase !== 'waiting')
      throw new Error('只有对局发起人能取消等待中的对局')
    const runtime = this.getRuntime(room.id)
    this.clearProposals(room.id)
    this.clearPresence(room.id)
    await this.repository.delete(room.id)
    for (const socket of runtime.sockets)
      send(socket, { type: 'room-closed', roomId: room.id, reason: '对局已由发起人取消' })
    for (const socket of runtime.sockets) this.connections.delete(socket)
    runtime.sockets.clear()
    this.runtime.delete(room.id)
  }

  private async ready(_ws: WebSocket, room: StoredRoom, ready: boolean) {
    const connection = this.connections.get(_ws)!
    const color = this.color(connection)
    if (room.phase !== 'waiting') throw new Error('对局已经开始')
    this.requireWaitingOwnerOnline(room)
    const opponent: RoomColor = color === 'red' ? 'black' : 'red'
    if (ready && room.seats[opponent]?.ready && !this.seatOnline(room.id, opponent))
      throw new Error('对方已离线，暂时不能开始对局')
    room.seats[color]!.ready = ready
    if (room.seats.red?.ready && room.seats.black?.ready) {
      if (room.variant === 'gomoku') room.initialLayout = undefined
      else room.initialLayout = createRoomInitialState(room.variant).layout
      room.phase = 'playing'
      room.startedAt = Date.now()
      room.moves = []
      room.status = 'playing'
      room.inviteHash = undefined
      this.getRuntime(room.id).applications.clear()
      this.clearWaitingPresence(room.id)
    }
    this.touch(room)
    await this.repository.save(room)
    this.updatePresence(room)
    this.broadcast(room)
  }

  private async propose(room: StoredRoom, connection: Connection, kind: 'swap' | 'undo' | 'draw') {
    const color = this.color(connection),
      runtime = this.getRuntime(room.id)
    if (kind === 'swap') this.requireWaitingOwnerOnline(room)
    if (kind === 'swap' && (room.phase !== 'waiting' || !room.seats.red || !room.seats.black))
      throw new Error('当前不能换边')
    if (
      kind === 'undo' &&
      (room.variant === 'jieqi' || room.phase !== 'playing' || room.moves.length === 0)
    )
      throw new Error('当前不能悔棋')
    if (kind === 'draw' && room.phase !== 'playing') throw new Error('当前不能提议和棋')
    if (runtime.pendingSwap || runtime.pendingUndo || runtime.pendingDraw)
      throw new Error('已有待处理的协商申请')
    const key = kind === 'swap' ? 'pendingSwap' : kind === 'undo' ? 'pendingUndo' : 'pendingDraw'
    const deadline = Date.now() + (this.options.proposalTimeoutMs ?? 60_000)
    const timer = setTimeout(
      () => {
        const current = this.getRuntime(room.id)[key]
        if (!current || current.deadline !== deadline) return
        this.getRuntime(room.id)[key] = undefined
        const latest = this.repository.get(room.id)
        if (latest) this.broadcast(latest)
      },
      Math.max(0, deadline - Date.now()),
    )
    runtime[key] = { by: color, deadline, timer }
    this.broadcast(room)
  }

  private async respondSwap(room: StoredRoom, connection: Connection, accept: boolean) {
    const runtime = this.getRuntime(room.id),
      color = this.color(connection)
    if (!runtime.pendingSwap || runtime.pendingSwap.by === color)
      throw new Error('没有待处理的换边申请')
    this.clearProposal(room.id, 'swap')
    if (accept) {
      const red = room.seats.red!,
        black = room.seats.black!
      room.seats.red = { ...black, ready: false }
      room.seats.black = { ...red, ready: false }
      this.touch(room)
      await this.repository.save(room)
      this.refreshRoles(room)
    }
    this.broadcast(room)
  }

  private async move(
    room: StoredRoom,
    connection: Connection,
    uci: string,
    row: number,
    col: number,
  ) {
    const color = this.color(connection)
    if (room.phase !== 'playing' || room.status !== 'playing') throw new Error('对局未在进行')
    const result =
      room.variant === 'gomoku'
        ? executeGomokuMove(
            this.rebuilt(room) as RebuiltGomokuRoom,
            room.moves,
            row,
            col,
            color,
            room.gomokuRule || 'freestyle',
          )
        : executeRoomMoveFromState(
            room.variant,
            this.rebuilt(room) as ReturnType<typeof rebuildRoomBoard>,
            room.moves,
            uci,
            color,
          )
    room.moves.push(result.move)
    room.status = result.detail.status
    room.statusReason = result.detail.reason
    this.clearProposal(room.id, 'draw')
    this.clearProposal(room.id, 'undo')
    if (room.status !== 'playing') {
      room.phase = 'finished'
      room.finishedAt = Date.now()
      this.clearDisconnect(room.id)
    }
    this.touch(room)
    await this.repository.save(room)
    this.broadcast(room)
  }

  private async hint(ws: WebSocket, room: StoredRoom, connection: Connection) {
    const color = this.color(connection),
      seat = room.seats[color]!
    if (room.variant === 'gomoku') throw new Error('五子棋在线对局暂不提供提示')
    if (room.phase !== 'playing' || room.status !== 'playing' || seat.hintsUsed >= 3)
      throw new Error('提示次数已用完或对局未进行')
    if (this.rebuilt(room).turn !== color) throw new Error('只能在自己的回合请求提示')
    const move = await this.hintProvider(room, color)
    if (!move) throw new Error('引擎暂时无法给出提示')
    seat.hintsUsed++
    this.touch(room)
    await this.repository.save(room)
    send(ws, { type: 'room-private-hint', roomId: room.id, move, remaining: 3 - seat.hintsUsed })
    this.broadcast(room)
  }

  private async respondUndo(room: StoredRoom, connection: Connection, accept: boolean) {
    const runtime = this.getRuntime(room.id),
      color = this.color(connection)
    if (!runtime.pendingUndo || runtime.pendingUndo.by === color)
      throw new Error('没有待处理的悔棋申请')
    this.clearProposal(room.id, 'undo')
    if (accept) {
      this.clearProposal(room.id, 'draw')
      room.moves.pop()
      room.status = 'playing'
      room.statusReason = undefined
      this.touch(room)
      await this.repository.save(room)
    }
    this.broadcast(room)
  }

  private async respondDraw(room: StoredRoom, connection: Connection, accept: boolean) {
    const runtime = this.getRuntime(room.id),
      color = this.color(connection)
    if (!runtime.pendingDraw || runtime.pendingDraw.by === color)
      throw new Error('没有待处理的和棋申请')
    this.clearProposal(room.id, 'draw')
    if (accept) {
      this.clearProposal(room.id, 'undo')
      room.status = 'draw'
      room.statusReason = 'agreement'
      room.phase = 'finished'
      room.finishedAt = Date.now()
      this.touch(room)
      await this.repository.save(room)
      this.clearDisconnect(room.id)
    }
    this.broadcast(room)
  }

  private async resign(room: StoredRoom, connection: Connection) {
    const color = this.color(connection)
    if (room.phase !== 'playing') throw new Error('对局未在进行')
    room.status = color === 'red' ? 'black-wins' : 'red-wins'
    room.statusReason = 'resignation'
    room.phase = 'finished'
    room.finishedAt = Date.now()
    this.clearProposals(room.id)
    this.touch(room)
    await this.repository.save(room)
    this.clearDisconnect(room.id)
    this.broadcast(room)
  }

  private cancelProposal(room: StoredRoom, connection: Connection, kind: string) {
    if (kind !== 'swap' && kind !== 'undo' && kind !== 'draw') throw new Error('申请类型无效')
    const proposal =
      kind === 'swap'
        ? this.getRuntime(room.id).pendingSwap
        : kind === 'undo'
          ? this.getRuntime(room.id).pendingUndo
          : this.getRuntime(room.id).pendingDraw
    if (!proposal || proposal.by !== this.color(connection)) throw new Error('没有可撤回的申请')
    this.clearProposal(room.id, kind)
    this.broadcast(room)
  }

  private async sendChat(
    ws: WebSocket,
    room: StoredRoom,
    connection: Connection,
    commandId: string,
    rawContent: unknown,
    rawNickname: unknown,
  ) {
    const runtime = this.getRuntime(room.id)
    const previous = runtime.chatCommands.get(commandId)
    if (previous)
      return send(ws, {
        type: 'room-chat-ack',
        roomId: room.id,
        commandId,
        messageId: previous.messageId,
      })
    this.requireWritableConversation(room)
    const now = Date.now(),
      rate = this.chatRates.get(ws)
    if (!rate || now - rate.startedAt >= 10_000)
      this.chatRates.set(ws, { startedAt: now, count: 1 })
    else if (++rate.count > 5) throw new Error('发言过于频繁，请稍后再试')
    const content = normalizeChatContent(rawContent)
    const settings = this.repository.chat.settings(room.id)
    if (!connection.isOwner && settings.everyoneMuted) throw new Error('对局当前已开启全面禁言')
    if (!connection.isOwner && settings.mutedAuthorIds.includes(connection.authorId))
      throw new Error('你已被对局发起人禁言')
    const role: RoomRole =
      connection.isOwner && connection.role === 'spectator' ? 'owner' : connection.role
    const seat =
      connection.role === 'red' || connection.role === 'black'
        ? room.seats[connection.role]
        : undefined
    if (!seat)
      connection.nickname = normalizeNickname(
        rawNickname,
        connection.nickname || (connection.isOwner ? '发起人' : '访客'),
      )
    const nickname = normalizeNickname(
      seat?.nickname,
      connection.nickname || (connection.isOwner ? '发起人' : '访客'),
    )
    if (containsSensitiveWord(content, settings.roomSensitiveWords)) {
      this.rememberChatCommand(room.id, commandId)
      return send(ws, { type: 'room-chat-ack', roomId: room.id, commandId, filtered: true })
    }
    const chatMessage = await this.repository.chat.append(room.id, {
      id: randomUUID(),
      authorId: connection.authorId,
      nickname,
      role,
      isOwner: connection.isOwner,
      content,
      createdAt: now,
    })
    this.rememberChatCommand(room.id, commandId, chatMessage.id)
    for (const socket of runtime.sockets)
      send(socket, { type: 'room-chat-message', roomId: room.id, message: chatMessage })
    send(ws, { type: 'room-chat-ack', roomId: room.id, commandId, messageId: chatMessage.id })
  }

  private async deleteChatMessage(
    ws: WebSocket,
    room: StoredRoom,
    connection: Connection,
    commandId: string,
    rawMessageId: unknown,
  ) {
    const runtime = this.getRuntime(room.id)
    const previous = runtime.chatCommands.get(commandId)
    if (previous)
      return send(ws, {
        type: 'room-chat-ack',
        roomId: room.id,
        commandId,
        messageId: previous.messageId,
      })
    this.requireWritableConversation(room)
    if (!connection.isOwner) throw new Error('只有对局发起人可以删除聊天消息')
    const messageId = String(rawMessageId || '')
    if (!UUID.test(messageId) || !(await this.repository.chat.deleteMessage(room.id, messageId)))
      throw new Error('聊天消息不存在')
    this.rememberChatCommand(room.id, commandId, messageId)
    for (const socket of runtime.sockets)
      send(socket, { type: 'room-chat-delete', roomId: room.id, messageId })
    send(ws, { type: 'room-chat-ack', roomId: room.id, commandId, messageId })
  }

  private async muteChatMember(
    ws: WebSocket,
    room: StoredRoom,
    connection: Connection,
    commandId: string,
    rawAuthorId: unknown,
    rawMuted: unknown,
  ) {
    const runtime = this.getRuntime(room.id),
      previous = runtime.chatCommands.get(commandId)
    if (previous) return send(ws, { type: 'room-chat-ack', roomId: room.id, commandId })
    this.requireWritableConversation(room)
    if (!connection.isOwner) throw new Error('只有对局发起人可以禁言成员')
    if (typeof rawMuted !== 'boolean') throw new Error('禁言设置无效')
    const authorId = String(rawAuthorId || ''),
      muted = rawMuted
    if (!/^[0-9a-f]{64}$/.test(authorId)) throw new Error('成员标识无效')
    const settings = this.repository.chat.settings(room.id)
    const target = this.repository.chat
      .list(room.id)
      .find((message) => message.authorId === authorId)
    if (muted && !target) throw new Error('成员不存在')
    if (muted && (target!.isOwner || authorId === connection.authorId))
      throw new Error('不能禁言对局发起人')
    if (!muted && !settings.mutedAuthorIds.includes(authorId)) throw new Error('成员未被禁言')
    if (
      muted &&
      !settings.mutedAuthorIds.includes(authorId) &&
      settings.mutedAuthorIds.length >= 100
    )
      throw new Error('禁言名单已满')
    const mutedAuthorIds = muted
      ? [...new Set([...settings.mutedAuthorIds, authorId])]
      : settings.mutedAuthorIds.filter((id) => id !== authorId)
    await this.repository.chat.updateSettings(room.id, { mutedAuthorIds })
    this.rememberChatCommand(room.id, commandId)
    this.broadcastChatSettings(room.id)
    send(ws, { type: 'room-chat-ack', roomId: room.id, commandId })
  }

  private async updateChatSettings(
    ws: WebSocket,
    room: StoredRoom,
    connection: Connection,
    commandId: string,
    message: Record<string, unknown>,
  ) {
    const runtime = this.getRuntime(room.id),
      previous = runtime.chatCommands.get(commandId)
    if (previous) return send(ws, { type: 'room-chat-ack', roomId: room.id, commandId })
    this.requireWritableConversation(room)
    if (!connection.isOwner) throw new Error('只有对局发起人可以修改聊天设置')
    if (typeof message.everyoneMuted !== 'boolean') throw new Error('全面禁言设置无效')
    const roomSensitiveWords = normalizeRoomSensitiveWords(message.roomSensitiveWords)
    await this.repository.chat.updateSettings(room.id, {
      everyoneMuted: message.everyoneMuted,
      roomSensitiveWords,
    })
    this.rememberChatCommand(room.id, commandId)
    this.broadcastChatSettings(room.id)
    send(ws, { type: 'room-chat-ack', roomId: room.id, commandId })
  }

  private sendChatHistory(ws: WebSocket, roomId: string) {
    send(ws, { type: 'room-chat-history', roomId, messages: this.repository.chat.list(roomId) })
  }

  private sendChatSettings(ws: WebSocket, roomId: string) {
    const connection = this.connections.get(ws)
    if (!connection) return
    const settings = this.repository.chat.settings(roomId)
    send(ws, {
      type: 'room-chat-settings',
      roomId,
      settings: {
        everyoneMuted: settings.everyoneMuted,
        muted: !connection.isOwner && settings.mutedAuthorIds.includes(connection.authorId),
        mutedAuthorIds: connection.isOwner ? settings.mutedAuthorIds : undefined,
        roomSensitiveWords: connection.isOwner ? settings.roomSensitiveWords : undefined,
      },
    })
  }
  private broadcastChatSettings(roomId: string) {
    for (const socket of this.getRuntime(roomId).sockets) this.sendChatSettings(socket, roomId)
  }

  private snapshot(room: StoredRoom, ws: WebSocket): RoomSnapshot {
    const connection = this.connections.get(ws) || { role: 'spectator' as const, isOwner: false }
    const rebuilt = this.rebuilt(room)
    const runtime = this.getRuntime(room.id)
    const online = (color: RoomColor) =>
      [...runtime.sockets].some((socket) => this.connections.get(socket)?.role === color)
    const roleColor =
      connection.role === 'red' || connection.role === 'black' ? connection.role : null
    return {
      id: room.id,
      name: room.name,
      variant: room.variant,
      gomokuRule: room.gomokuRule,
      phase: room.phase,
      revision: room.revision,
      role: connection.role,
      isOwner: connection.isOwner,
      inviteAvailable: room.phase === 'waiting' && Boolean(room.inviteHash),
      seats: Object.fromEntries(
        (['red', 'black'] as const).flatMap((color) =>
          room.seats[color]
            ? [
                [
                  color,
                  {
                    nickname: room.seats[color]!.nickname,
                    ready: room.seats[color]!.ready,
                    online: online(color),
                    hintsRemaining: roleColor === color ? 3 - room.seats[color]!.hintsUsed : 0,
                  },
                ],
              ]
            : [],
        ),
      ),
      board:
        room.variant === 'gomoku'
          ? rebuilt.board
          : projectBoard(rebuilt.board as ReturnType<typeof rebuildRoomBoard>['board']),
      turn: rebuilt.turn,
      moves: room.moves.map((move) => ({
        uci: move.uci,
        color: move.color,
        row: move.row,
        col: move.col,
        notation: move.notation,
        revealed: move.revealed,
        captured: !move.capturedHidden || roleColor === move.color ? move.captured : null,
        capturedHidden: move.capturedHidden,
      })),
      captured: room.moves.flatMap((move) =>
        move.capturedColor
          ? [
              {
                color: move.capturedColor,
                type:
                  !move.capturedHidden || roleColor === move.color ? move.captured || null : null,
                hidden: Boolean(move.capturedHidden),
                capturedBy: move.color,
              },
            ]
          : [],
      ),
      status: room.status,
      statusReason: room.statusReason,
      spectatorCount: [...runtime.sockets].filter(
        (socket) => this.connections.get(socket)?.role === 'spectator',
      ).length,
      pendingDrawBy: runtime.pendingDraw?.by,
      pendingDrawDeadline: runtime.pendingDraw?.deadline,
      pendingUndoBy: runtime.pendingUndo?.by,
      pendingUndoDeadline: runtime.pendingUndo?.deadline,
      pendingSwapBy: runtime.pendingSwap?.by,
      pendingSwapDeadline: runtime.pendingSwap?.deadline,
      applications: connection.isOwner
        ? [...runtime.applications.values()].map((item) => ({
            id: item.id,
            nickname: item.nickname,
            side: item.side,
          }))
        : undefined,
      ownerDisconnectDeadline: runtime.ownerDisconnect?.deadline,
      seatDisconnectDeadlines: Object.fromEntries(
        (['red', 'black'] as const).flatMap((color) =>
          runtime.seatDisconnects[color] ? [[color, runtime.seatDisconnects[color]!.deadline]] : [],
        ),
      ),
      disconnect: runtime.disconnect
        ? { color: runtime.disconnect.color, deadline: runtime.disconnect.deadline }
        : undefined,
    }
  }

  private broadcast(room: StoredRoom) {
    for (const ws of this.getRuntime(room.id).sockets) this.sendSnapshot(ws, room)
  }
  private sendSnapshot(ws: WebSocket, room: StoredRoom, warning?: string) {
    send(ws, { type: 'room-snapshot', room: this.snapshot(room, ws), warning })
  }
  private summary(room: StoredRoom): RoomSummary {
    const runtime = this.runtime.get(room.id)
    return {
      id: room.id,
      name: room.name,
      variant: room.variant,
      gomokuRule: room.gomokuRule,
      phase: room.phase,
      red: room.seats.red?.nickname || null,
      black: room.seats.black?.nickname || null,
      spectatorCount: runtime
        ? [...runtime.sockets].filter((ws) => this.connections.get(ws)?.role === 'spectator').length
        : 0,
      moveCount: room.moves.length,
      status: room.status,
      statusReason: room.statusReason,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
    }
  }
  private requireRoom(id: string) {
    const room = this.repository.get(id)
    if (!room) throw new Error('对局不存在')
    return room
  }
  private requireWaitingOwnerOnline(room: StoredRoom) {
    if (room.phase === 'waiting' && !this.ownerOnline(room.id))
      throw new Error('发起人已离线，当前对局即将取消')
  }
  private requireWritableConversation(room: StoredRoom) {
    if (room.phase === 'finished') throw new Error('对局已结束，历史聊天仅供查看')
  }
  private color(connection: Connection): RoomColor {
    if (connection.role !== 'red' && connection.role !== 'black') throw new Error('当前不是棋手')
    return connection.role
  }
  private touch(room: StoredRoom) {
    room.revision++
    room.updatedAt = Date.now()
    this.getRuntime(room.id).cached = undefined
  }
  private getRuntime(id: string) {
    let value = this.runtime.get(id)
    if (!value) {
      value = {
        sockets: new Set(),
        applications: new Map(),
        seatDisconnects: {},
        commands: new Map(),
        chatCommands: new Map(),
        queue: Promise.resolve(),
      }
      this.runtime.set(id, value)
    }
    return value
  }
  private rememberCommand(id: string, commandId: string, revision: number) {
    const commands = this.getRuntime(id).commands
    commands.set(commandId, { revision })
    while (commands.size > 200) commands.delete(commands.keys().next().value!)
  }
  private rememberChatCommand(id: string, commandId: string, messageId?: string) {
    const commands = this.getRuntime(id).chatCommands
    commands.set(commandId, { messageId })
    while (commands.size > 500) commands.delete(commands.keys().next().value!)
  }
  private rebuilt(room: StoredRoom) {
    const runtime = this.getRuntime(room.id)
    const lastMove = room.moves.at(-1)?.uci
    if (
      !runtime.cached ||
      runtime.cached.revision !== room.revision ||
      runtime.cached.layout !== room.initialLayout ||
      runtime.cached.moveCount !== room.moves.length ||
      runtime.cached.lastMove !== lastMove
    ) {
      runtime.cached = {
        revision: room.revision,
        layout: room.initialLayout,
        moveCount: room.moves.length,
        lastMove,
        rebuilt:
          room.variant === 'gomoku'
            ? rebuildGomokuRoom(room.moves)
            : rebuildRoomBoard(room.variant, room.initialLayout, room.moves),
      }
    }
    return runtime.cached.rebuilt
  }
  private refreshRoles(room: StoredRoom) {
    for (const ws of this.getRuntime(room.id).sockets) {
      const connection = this.connections.get(ws)
      if (!connection || connection.role === 'spectator' || connection.role === 'owner') continue
      connection.role = matches(connection.token, room.seats.red?.credentialHash)
        ? 'red'
        : matches(connection.token, room.seats.black?.credentialHash)
          ? 'black'
          : 'spectator'
    }
  }
  private ownerOnline(id: string) {
    const runtime = this.runtime.get(id)
    return Boolean(
      runtime &&
      [...runtime.sockets].some((socket) => this.connections.get(socket)?.isOwner === true),
    )
  }
  private seatOnline(id: string, color: RoomColor) {
    const runtime = this.runtime.get(id)
    return Boolean(
      runtime &&
      [...runtime.sockets].some((socket) => this.connections.get(socket)?.role === color),
    )
  }
  private clearOwnerDisconnect(id: string) {
    const runtime = this.runtime.get(id)
    if (!runtime) return
    if (runtime.ownerDisconnect) clearTimeout(runtime.ownerDisconnect.timer)
    runtime.ownerDisconnect = undefined
  }
  private clearSeatDisconnect(id: string, color: RoomColor) {
    const runtime = this.runtime.get(id)
    if (!runtime) return
    const current = runtime.seatDisconnects[color]
    if (current) clearTimeout(current.timer)
    delete runtime.seatDisconnects[color]
  }
  private clearWaitingPresence(id: string) {
    this.clearOwnerDisconnect(id)
    this.clearSeatDisconnect(id, 'red')
    this.clearSeatDisconnect(id, 'black')
  }
  private clearDisconnect(id: string) {
    const runtime = this.runtime.get(id)
    if (!runtime) return
    if (runtime.disconnect) clearTimeout(runtime.disconnect.timer)
    runtime.disconnect = undefined
  }
  private clearPresence(id: string) {
    this.clearWaitingPresence(id)
    this.clearDisconnect(id)
  }
  private clearProposal(id: string, kind: 'swap' | 'undo' | 'draw') {
    const runtime = this.getRuntime(id)
    const key = kind === 'swap' ? 'pendingSwap' : kind === 'undo' ? 'pendingUndo' : 'pendingDraw'
    const proposal = runtime[key]
    if (proposal) clearTimeout(proposal.timer)
    runtime[key] = undefined
  }
  private clearProposals(id: string) {
    this.clearProposal(id, 'swap')
    this.clearProposal(id, 'undo')
    this.clearProposal(id, 'draw')
  }
  private updatePresence(room: StoredRoom, startup = false) {
    if (room.phase === 'waiting') {
      this.clearDisconnect(room.id)
      this.updateWaitingPresence(room, startup)
      return
    }
    this.clearWaitingPresence(room.id)
    if (room.phase === 'playing') this.updatePlayingDisconnect(room, startup)
    else this.clearDisconnect(room.id)
  }

  private updateWaitingPresence(room: StoredRoom, startup: boolean) {
    const runtime = this.getRuntime(room.id)
    if (this.ownerOnline(room.id)) {
      this.clearOwnerDisconnect(room.id)
    } else if (!runtime.ownerDisconnect) {
      const timeout = startup
        ? (this.options.startupRecoveryTimeoutMs ?? 2 * this.disconnectTimeoutMs)
        : (this.options.waitingDisconnectTimeoutMs ?? this.disconnectTimeoutMs)
      const deadline = Date.now() + timeout
      const timer = setTimeout(
        () => this.enqueueWaitingOwnerExpiry(room.id, deadline),
        Math.max(0, timeout),
      )
      timer.unref()
      runtime.ownerDisconnect = { deadline, timer }
    }

    if (!this.ownerOnline(room.id)) {
      this.clearSeatDisconnect(room.id, 'red')
      this.clearSeatDisconnect(room.id, 'black')
      return
    }

    for (const color of ['red', 'black'] as const) {
      const seat = room.seats[color]
      if (!seat || this.seatOnline(room.id, color)) {
        this.clearSeatDisconnect(room.id, color)
        continue
      }
      if (runtime.seatDisconnects[color]) continue
      const timeout = this.options.waitingDisconnectTimeoutMs ?? this.disconnectTimeoutMs
      const deadline = Date.now() + timeout
      const timer = setTimeout(
        () => this.enqueueWaitingSeatExpiry(room.id, color, deadline),
        Math.max(0, timeout),
      )
      timer.unref()
      runtime.seatDisconnects[color] = { deadline, timer }
    }
  }

  private updatePlayingDisconnect(room: StoredRoom, startup: boolean) {
    const runtime = this.getRuntime(room.id)
    const redOnline = this.seatOnline(room.id, 'red')
    const blackOnline = this.seatOnline(room.id, 'black')
    const color: RoomColor | 'both' | undefined =
      redOnline && blackOnline ? undefined : redOnline ? 'black' : blackOnline ? 'red' : 'both'
    if (!color) {
      this.clearDisconnect(room.id)
      return
    }
    if (runtime.disconnect?.color === color) return
    this.clearDisconnect(room.id)
    const timeout = startup
      ? (this.options.startupRecoveryTimeoutMs ?? 2 * this.disconnectTimeoutMs)
      : this.disconnectTimeoutMs
    const deadline = Date.now() + timeout
    const timer = setTimeout(
      () => this.enqueueDisconnectAdjudication(room.id, color, deadline),
      Math.max(0, timeout),
    )
    timer.unref()
    runtime.disconnect = { color, deadline, timer }
  }

  private enqueueWaitingOwnerExpiry(roomId: string, deadline: number) {
    const runtime = this.getRuntime(roomId)
    const operation = runtime.queue.then(() => this.expireWaitingOwner(roomId, deadline))
    runtime.queue = operation.catch((error) => console.error('Waiting owner expiry failed:', error))
  }

  private async expireWaitingOwner(roomId: string, deadline: number) {
    const runtime = this.getRuntime(roomId)
    if (runtime.ownerDisconnect?.deadline !== deadline) return
    const room = this.repository.get(roomId)
    if (!room || room.phase !== 'waiting' || this.ownerOnline(roomId)) {
      this.clearOwnerDisconnect(roomId)
      return
    }
    await this.closeWaitingRoom(room, '发起人离线，对局已自动取消')
  }

  private enqueueWaitingSeatExpiry(roomId: string, color: RoomColor, deadline: number) {
    const runtime = this.getRuntime(roomId)
    const operation = runtime.queue.then(() => this.expireWaitingSeat(roomId, color, deadline))
    runtime.queue = operation.catch((error) => console.error('Waiting seat expiry failed:', error))
  }

  private async expireWaitingSeat(roomId: string, color: RoomColor, deadline: number) {
    const runtime = this.getRuntime(roomId)
    if (runtime.seatDisconnects[color]?.deadline !== deadline) return
    const room = this.repository.get(roomId)
    if (!room || room.phase !== 'waiting' || !room.seats[color] || this.seatOnline(roomId, color)) {
      this.clearSeatDisconnect(roomId, color)
      return
    }
    delete room.seats[color]
    this.clearSeatDisconnect(roomId, color)
    this.clearProposals(room.id)
    this.touch(room)
    await this.repository.save(room)
    this.refreshRoles(room)
    this.broadcast(room)
  }

  private async closeWaitingRoom(room: StoredRoom, reason: string) {
    const runtime = this.getRuntime(room.id)
    this.clearPresence(room.id)
    this.clearProposals(room.id)
    await this.repository.delete(room.id)
    for (const socket of runtime.sockets)
      send(socket, { type: 'room-closed', roomId: room.id, reason })
    for (const socket of runtime.sockets) this.connections.delete(socket)
    runtime.sockets.clear()
    this.runtime.delete(room.id)
  }

  private enqueueDisconnectAdjudication(
    roomId: string,
    color: RoomColor | 'both',
    deadline: number,
  ) {
    const runtime = this.getRuntime(roomId)
    const operation = runtime.queue.then(() => this.adjudicateDisconnect(roomId, color, deadline))
    runtime.queue = operation.catch((error) =>
      console.error('Disconnect adjudication failed:', error),
    )
  }

  private async adjudicateDisconnect(roomId: string, color: RoomColor | 'both', deadline: number) {
    const runtime = this.getRuntime(roomId)
    if (runtime.disconnect?.color !== color || runtime.disconnect.deadline !== deadline) return
    const room = this.repository.get(roomId)
    if (!room || room.phase !== 'playing') {
      this.clearDisconnect(roomId)
      return
    }
    const redOnline = this.seatOnline(roomId, 'red')
    const blackOnline = this.seatOnline(roomId, 'black')
    const current: RoomColor | 'both' | undefined =
      redOnline && blackOnline ? undefined : redOnline ? 'black' : blackOnline ? 'red' : 'both'
    if (current !== color) {
      this.updatePresence(room)
      this.broadcast(room)
      return
    }
    if (color === 'both') {
      await this.finishAbandoned(room, Date.now())
      return
    }
    room.status = color === 'red' ? 'black-wins' : 'red-wins'
    room.statusReason = 'disconnect'
    room.phase = 'finished'
    room.finishedAt = Date.now()
    this.clearProposals(room.id)
    this.touch(room)
    await this.repository.save(room)
    this.clearDisconnect(room.id)
    this.broadcast(room)
  }

  private async finishAbandoned(room: StoredRoom, finishedAt: number) {
    room.phase = 'finished'
    room.status = 'draw'
    room.statusReason = 'abandoned'
    room.finishedAt = finishedAt
    this.clearPresence(room.id)
    this.clearProposals(room.id)
    this.touch(room)
    await this.repository.save(room)
    this.broadcast(room)
  }
}
