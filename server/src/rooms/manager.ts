import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { WebSocket } from 'ws'
import { createRoomInitialState, executeRoomMove, projectBoard, rebuildRoomBoard } from './core.js'
import { RoomRepository } from './repository.js'
import { RoomColor, RoomRole, RoomSnapshot, RoomSummary, StoredRoom } from './types.js'

type Connection = { roomId: string; role: RoomRole; isOwner: boolean; token?: string; nickname: string }
type Application = { id: string; ws: WebSocket; nickname: string; side: RoomColor }
type Runtime = {
  sockets: Set<WebSocket>
  applications: Map<string, Application>
  pendingDrawBy?: RoomColor
  pendingUndoBy?: RoomColor
  pendingSwapBy?: RoomColor
  disconnect?: { color: RoomColor; deadline: number; timer: NodeJS.Timeout }
  commands: Map<string, { revision: number }>
  queue: Promise<void>
}

export type RoomHintProvider = (room: StoredRoom, color: RoomColor) => Promise<string | null>

function hash(value: string) { return createHash('sha256').update(value).digest('hex') }
function matches(value: string | undefined, expected: string | undefined) {
  if (!value || !expected) return false
  const left = Buffer.from(hash(value)), right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}
function send(ws: WebSocket, message: unknown) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)) }

export class RoomManager {
  private readonly connections = new Map<WebSocket, Connection>()
  private readonly runtime = new Map<string, Runtime>()
  private readonly rates = new WeakMap<WebSocket, { startedAt: number; count: number }>()

  constructor(
    private readonly repository: RoomRepository,
    private readonly hintProvider: RoomHintProvider,
    private readonly disconnectTimeoutMs = 60_000,
  ) {}

  createRoom(name: string, variant: 'xiangqi' | 'jieqi') {
    if (this.repository.list().filter(room => room.phase !== 'finished').length >= 100) return Promise.reject(new Error('活跃房间数量已达到上限'))
    const ownerToken = randomUUID(), inviteToken = randomUUID(), now = Date.now()
    const room: StoredRoom = {
      schemaVersion: 1, id: randomUUID(), name: name.trim().slice(0, 60) || (variant === 'jieqi' ? '揭棋房间' : '象棋房间'),
      variant, phase: 'waiting', revision: 0, ownerHash: hash(ownerToken), inviteHash: hash(inviteToken), seats: {}, moves: [], status: 'playing', createdAt: now, updatedAt: now,
    }
    return this.repository.create(room).then(saved => ({ room: saved, ownerToken, inviteToken }))
  }

  lobby(): RoomSummary[] {
    return this.repository.list().filter(room => room.phase !== 'finished').sort((a, b) => b.createdAt - a.createdAt).map(room => this.summary(room))
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
    if (type === 'room-subscribe') return this.subscribe(ws, message)
    const connection = this.connections.get(ws)
    if (!connection) throw new Error('请先加入房间')
    const runtime = this.getRuntime(connection.roomId)
    const operation = runtime.queue.then(() => this.handleLocked(ws, message))
    runtime.queue = operation.catch(() => undefined)
    return operation
  }

  private async handleLocked(ws: WebSocket, message: Record<string, unknown>) {
    const type = String(message.type || '')
    const connection = this.connections.get(ws)
    if (!connection) throw new Error('请先加入房间')
    const room = this.requireRoom(connection.roomId)
    if (message.roomId !== room.id) throw new Error('房间不匹配')
    const commandId = typeof message.commandId === 'string' ? message.commandId : undefined
    if (commandId && this.getRuntime(room.id).commands.has(commandId)) return this.sendSnapshot(ws, room)
    if (message.expectedRevision !== undefined && message.expectedRevision !== room.revision) return this.sendSnapshot(ws, room, '状态已更新，请重试')

    switch (type) {
      case 'room-claim-seat': await this.claimSeat(ws, room, message); break
      case 'room-invite-seat': await this.inviteSeat(ws, room, message); break
      case 'room-seat-request': this.requestSeat(ws, room, message); break
      case 'room-seat-approve': await this.approveSeat(ws, room, message); break
      case 'room-ready': await this.ready(ws, room, Boolean(message.ready)); break
      case 'room-swap-request': await this.propose(room, connection, 'swap'); break
      case 'room-swap-response': await this.respondSwap(room, connection, Boolean(message.accept)); break
      case 'room-move': await this.move(room, connection, String(message.uci || '')); break
      case 'room-hint': await this.hint(ws, room, connection); break
      case 'room-undo-request': await this.propose(room, connection, 'undo'); break
      case 'room-undo-response': await this.respondUndo(room, connection, Boolean(message.accept)); break
      case 'room-draw-offer': await this.propose(room, connection, 'draw'); break
      case 'room-draw-response': await this.respondDraw(room, connection, Boolean(message.accept)); break
      case 'room-resign': await this.resign(room, connection); break
      default: throw new Error('不支持的房间操作')
    }
    if (commandId) this.rememberCommand(room.id, commandId, room.revision)
  }

  disconnect(ws: WebSocket) {
    const connection = this.connections.get(ws)
    if (!connection) return
    this.connections.delete(ws)
    const runtime = this.getRuntime(connection.roomId)
    runtime.sockets.delete(ws)
    for (const [id, application] of runtime.applications) if (application.ws === ws) runtime.applications.delete(id)
    const room = this.repository.get(connection.roomId)
    if (!room) return
    this.updateDisconnect(room)
    this.broadcast(room)
  }

  async flush() {
    await Promise.all([...this.runtime.values()].map(runtime => runtime.queue))
    await this.repository.flush()
  }

  private subscribe(ws: WebSocket, message: Record<string, unknown>) {
    const room = this.requireRoom(String(message.roomId || ''))
    const token = typeof message.token === 'string' ? message.token : undefined
    let role: RoomRole = 'spectator', isOwner = matches(token, room.ownerHash)
    for (const color of ['red', 'black'] as const) if (matches(token, room.seats[color]?.credentialHash)) role = color
    const runtime = this.getRuntime(room.id)
    if (role === 'spectator' && !this.connections.has(ws) && [...runtime.sockets].filter(socket => this.connections.get(socket)?.role === 'spectator').length >= 50) throw new Error('观众人数已满')
    const previous = this.connections.get(ws)
    if (previous) this.getRuntime(previous.roomId).sockets.delete(ws)
    this.connections.set(ws, { roomId: room.id, role, isOwner, token, nickname: String(message.nickname || '访客').slice(0, 20) })
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
    this.updateDisconnect(room)
    this.broadcast(room)
  }

  private async claimSeat(ws: WebSocket, room: StoredRoom, message: Record<string, unknown>) {
    const connection = this.connections.get(ws)!
    if (!connection.isOwner || room.phase !== 'waiting') throw new Error('无权直接占用席位')
    await this.assignSeat(ws, room, message.side, String(message.nickname || connection.nickname), connection.token)
  }

  private async inviteSeat(ws: WebSocket, room: StoredRoom, message: Record<string, unknown>) {
    if (!matches(String(message.inviteToken || ''), room.inviteHash) || room.phase !== 'waiting') throw new Error('邀请链接无效或已使用')
    room.inviteHash = undefined
    await this.assignSeat(ws, room, message.side, String(message.nickname || '受邀棋手'))
  }

  private requestSeat(ws: WebSocket, room: StoredRoom, message: Record<string, unknown>) {
    if (room.phase !== 'waiting') throw new Error('对局已经开始')
    const side = message.side
    if (side !== 'red' && side !== 'black' || room.seats[side]) throw new Error('该席位不可用')
    const runtime = this.getRuntime(room.id)
    const application: Application = { id: randomUUID(), ws, nickname: String(message.nickname || '申请者').slice(0, 20), side }
    runtime.applications.set(application.id, application)
    this.broadcast(room)
  }

  private async approveSeat(ws: WebSocket, room: StoredRoom, message: Record<string, unknown>) {
    const connection = this.connections.get(ws)!
    if (!connection.isOwner) throw new Error('只有房主可以审批')
    const runtime = this.getRuntime(room.id), application = runtime.applications.get(String(message.applicationId || ''))
    if (!application) throw new Error('申请已经失效')
    runtime.applications.delete(application.id)
    if (!message.accept) return this.broadcast(room)
    await this.assignSeat(application.ws, room, application.side, application.nickname)
  }

  private async assignSeat(ws: WebSocket, room: StoredRoom, rawSide: unknown, nickname: string, existingToken?: string) {
    const side = rawSide === 'red' || rawSide === 'black' ? rawSide : null
    if (!side || room.seats[side]) throw new Error('该席位不可用')
    const connection = this.connections.get(ws)
    if (connection?.role === 'red' || connection?.role === 'black') throw new Error('当前已经占用一个席位')
    const seatToken = existingToken || randomUUID()
    room.seats[side] = { nickname: nickname.trim().slice(0, 20) || (side === 'red' ? '红方' : '黑方'), credentialHash: hash(seatToken), ready: false, hintsUsed: 0 }
    this.touch(room)
    await this.repository.save(room)
    if (connection) { connection.role = side; connection.token = seatToken }
    send(ws, { type: 'room-seat-token', roomId: room.id, token: seatToken, role: side })
    this.updateDisconnect(room)
    this.broadcast(room)
  }

  private async ready(_ws: WebSocket, room: StoredRoom, ready: boolean) {
    const connection = this.connections.get(_ws)!
    const color = this.color(connection)
    if (room.phase !== 'waiting') throw new Error('对局已经开始')
    room.seats[color]!.ready = ready
    if (room.seats.red?.ready && room.seats.black?.ready) {
      const initial = createRoomInitialState(room.variant)
      room.initialLayout = initial.layout
      room.phase = 'playing'; room.startedAt = Date.now(); room.moves = []; room.status = 'playing'
    }
    this.touch(room); await this.repository.save(room); this.updateDisconnect(room); this.broadcast(room)
  }

  private async propose(room: StoredRoom, connection: Connection, kind: 'swap' | 'undo' | 'draw') {
    const color = this.color(connection), runtime = this.getRuntime(room.id)
    if (kind === 'swap') { if (room.phase !== 'waiting' || !room.seats.red || !room.seats.black) throw new Error('当前不能换边'); runtime.pendingSwapBy = color }
    if (kind === 'undo') { if (room.variant === 'jieqi' || room.phase !== 'playing' || room.moves.length === 0) throw new Error('当前不能悔棋'); runtime.pendingUndoBy = color }
    if (kind === 'draw') { if (room.phase !== 'playing') throw new Error('当前不能提议和棋'); runtime.pendingDrawBy = color }
    this.broadcast(room)
  }

  private async respondSwap(room: StoredRoom, connection: Connection, accept: boolean) {
    const runtime = this.getRuntime(room.id), color = this.color(connection)
    if (!runtime.pendingSwapBy || runtime.pendingSwapBy === color) throw new Error('没有待处理的换边申请')
    runtime.pendingSwapBy = undefined
    if (accept) { const red = room.seats.red!, black = room.seats.black!; room.seats.red = { ...black, ready: false }; room.seats.black = { ...red, ready: false }; this.touch(room); await this.repository.save(room); this.refreshRoles(room) }
    this.broadcast(room)
  }

  private async move(room: StoredRoom, connection: Connection, uci: string) {
    const color = this.color(connection)
    if (room.phase !== 'playing' || room.status !== 'playing') throw new Error('对局未在进行')
    const result = executeRoomMove(room.variant, room.initialLayout, room.moves, uci, color)
    room.moves.push(result.move); room.status = result.detail.status; room.statusReason = result.detail.reason
    const runtime = this.getRuntime(room.id); runtime.pendingDrawBy = undefined; runtime.pendingUndoBy = undefined
    if (room.status !== 'playing') { room.phase = 'finished'; room.finishedAt = Date.now(); this.clearDisconnect(room.id) }
    this.touch(room); await this.repository.save(room); this.broadcast(room)
  }

  private async hint(ws: WebSocket, room: StoredRoom, connection: Connection) {
    const color = this.color(connection), seat = room.seats[color]!
    if (room.phase !== 'playing' || room.status !== 'playing' || seat.hintsUsed >= 3) throw new Error('提示次数已用完或对局未进行')
    if (rebuildRoomBoard(room.variant, room.initialLayout, room.moves).turn !== color) throw new Error('只能在自己的回合请求提示')
    const move = await this.hintProvider(room, color)
    if (!move) throw new Error('引擎暂时无法给出提示')
    seat.hintsUsed++; this.touch(room); await this.repository.save(room)
    send(ws, { type: 'room-private-hint', roomId: room.id, move, remaining: 3 - seat.hintsUsed })
    this.broadcast(room)
  }

  private async respondUndo(room: StoredRoom, connection: Connection, accept: boolean) {
    const runtime = this.getRuntime(room.id), color = this.color(connection)
    if (!runtime.pendingUndoBy || runtime.pendingUndoBy === color) throw new Error('没有待处理的悔棋申请')
    runtime.pendingUndoBy = undefined
    if (accept) { runtime.pendingDrawBy = undefined; room.moves.pop(); room.status = 'playing'; room.statusReason = undefined; this.touch(room); await this.repository.save(room) }
    this.broadcast(room)
  }

  private async respondDraw(room: StoredRoom, connection: Connection, accept: boolean) {
    const runtime = this.getRuntime(room.id), color = this.color(connection)
    if (!runtime.pendingDrawBy || runtime.pendingDrawBy === color) throw new Error('没有待处理的和棋申请')
    runtime.pendingDrawBy = undefined
    if (accept) { runtime.pendingUndoBy = undefined; room.status = 'draw'; room.statusReason = 'agreement'; room.phase = 'finished'; room.finishedAt = Date.now(); this.touch(room); await this.repository.save(room); this.clearDisconnect(room.id) }
    this.broadcast(room)
  }

  private async resign(room: StoredRoom, connection: Connection) {
    const color = this.color(connection)
    if (room.phase !== 'playing') throw new Error('对局未在进行')
    room.status = color === 'red' ? 'black-wins' : 'red-wins'; room.statusReason = 'resignation'; room.phase = 'finished'; room.finishedAt = Date.now()
    const runtime = this.getRuntime(room.id); runtime.pendingDrawBy = undefined; runtime.pendingUndoBy = undefined
    this.touch(room); await this.repository.save(room); this.clearDisconnect(room.id); this.broadcast(room)
  }

  private snapshot(room: StoredRoom, ws: WebSocket): RoomSnapshot {
    const connection = this.connections.get(ws) || { role: 'spectator' as const, isOwner: false }
    const rebuilt = rebuildRoomBoard(room.variant, room.initialLayout, room.moves)
    const runtime = this.getRuntime(room.id)
    const online = (color: RoomColor) => [...runtime.sockets].some(socket => this.connections.get(socket)?.role === color)
    const roleColor = connection.role === 'red' || connection.role === 'black' ? connection.role : null
    return {
      id: room.id, name: room.name, variant: room.variant, phase: room.phase, revision: room.revision, role: connection.role, isOwner: connection.isOwner,
      seats: Object.fromEntries((['red', 'black'] as const).flatMap(color => room.seats[color] ? [[color, { nickname: room.seats[color]!.nickname, ready: room.seats[color]!.ready, online: online(color), hintsRemaining: roleColor === color ? 3 - room.seats[color]!.hintsUsed : 0 }]] : [])),
      board: projectBoard(rebuilt.board), turn: rebuilt.turn,
      moves: room.moves.map(move => ({ uci: move.uci, color: move.color, revealed: move.revealed, captured: !move.capturedHidden || roleColor === move.color ? move.captured : null, capturedHidden: move.capturedHidden })),
      captured: room.moves.flatMap(move => move.capturedColor ? [{ color: move.capturedColor, type: !move.capturedHidden || roleColor === move.color ? move.captured || null : null, hidden: Boolean(move.capturedHidden), capturedBy: move.color }] : []),
      status: room.status, statusReason: room.statusReason, spectatorCount: [...runtime.sockets].filter(socket => this.connections.get(socket)?.role === 'spectator').length,
      pendingDrawBy: runtime.pendingDrawBy, pendingUndoBy: runtime.pendingUndoBy, pendingSwapBy: runtime.pendingSwapBy,
      applications: connection.isOwner ? [...runtime.applications.values()].map(item => ({ id: item.id, nickname: item.nickname, side: item.side })) : undefined,
      disconnect: runtime.disconnect ? { color: runtime.disconnect.color, deadline: runtime.disconnect.deadline } : undefined,
    }
  }

  private broadcast(room: StoredRoom) { for (const ws of this.getRuntime(room.id).sockets) this.sendSnapshot(ws, room) }
  private sendSnapshot(ws: WebSocket, room: StoredRoom, warning?: string) { send(ws, { type: 'room-snapshot', room: this.snapshot(room, ws), warning }) }
  private summary(room: StoredRoom): RoomSummary { return { id: room.id, name: room.name, variant: room.variant, phase: room.phase, red: room.seats.red?.nickname || null, black: room.seats.black?.nickname || null, spectatorCount: [...this.getRuntime(room.id).sockets].filter(ws => this.connections.get(ws)?.role === 'spectator').length, moveCount: room.moves.length, createdAt: room.createdAt } }
  private requireRoom(id: string) { const room = this.repository.get(id); if (!room) throw new Error('房间不存在'); return room }
  private color(connection: Connection): RoomColor { if (connection.role !== 'red' && connection.role !== 'black') throw new Error('当前不是棋手'); return connection.role }
  private touch(room: StoredRoom) { room.revision++; room.updatedAt = Date.now() }
  private getRuntime(id: string) { let value = this.runtime.get(id); if (!value) { value = { sockets: new Set(), applications: new Map(), commands: new Map(), queue: Promise.resolve() }; this.runtime.set(id, value) } return value }
  private rememberCommand(id: string, commandId: string, revision: number) { const commands = this.getRuntime(id).commands; commands.set(commandId, { revision }); while (commands.size > 200) commands.delete(commands.keys().next().value!) }
  private refreshRoles(room: StoredRoom) { for (const ws of this.getRuntime(room.id).sockets) { const connection = this.connections.get(ws); if (!connection) continue; connection.role = matches(connection.token, room.seats.red?.credentialHash) ? 'red' : matches(connection.token, room.seats.black?.credentialHash) ? 'black' : 'spectator' } }
  private clearDisconnect(id: string) { const runtime = this.getRuntime(id); if (runtime.disconnect) clearTimeout(runtime.disconnect.timer); runtime.disconnect = undefined }
  private updateDisconnect(room: StoredRoom) {
    const runtime = this.getRuntime(room.id)
    if (room.phase !== 'playing') { this.clearDisconnect(room.id); return }
    const online = (color: RoomColor) => [...runtime.sockets].some(ws => this.connections.get(ws)?.role === color)
    if (online('red') === online('black')) { this.clearDisconnect(room.id); return }
    const color: RoomColor = online('red') ? 'black' : 'red', deadline = Date.now() + this.disconnectTimeoutMs
    if (runtime.disconnect?.color === color) return
    this.clearDisconnect(room.id)
    const timer = setTimeout(() => this.enqueueDisconnectAdjudication(room.id, color, deadline), this.disconnectTimeoutMs)
    runtime.disconnect = { color, deadline, timer }
  }

  private enqueueDisconnectAdjudication(roomId: string, color: RoomColor, deadline: number) {
    const runtime = this.getRuntime(roomId)
    const operation = runtime.queue.then(() => this.adjudicateDisconnect(roomId, color, deadline))
    runtime.queue = operation.catch(error => console.error('Disconnect adjudication failed:', error))
  }

  private async adjudicateDisconnect(roomId: string, color: RoomColor, deadline: number) {
    const runtime = this.getRuntime(roomId)
    if (runtime.disconnect?.color !== color || runtime.disconnect.deadline !== deadline) return
    const room = this.repository.get(roomId)
    if (!room || room.phase !== 'playing') { this.clearDisconnect(roomId); return }
    const online = (side: RoomColor) => [...runtime.sockets].some(ws => this.connections.get(ws)?.role === side)
    const opponent: RoomColor = color === 'red' ? 'black' : 'red'
    if (online(color) || !online(opponent)) {
      this.updateDisconnect(room)
      this.broadcast(room)
      return
    }
    room.status = color === 'red' ? 'black-wins' : 'red-wins'
    room.statusReason = 'disconnect'
    room.phase = 'finished'
    room.finishedAt = Date.now()
    runtime.pendingDrawBy = undefined
    runtime.pendingUndoBy = undefined
    this.touch(room)
    await this.repository.save(room)
    this.clearDisconnect(room.id)
    this.broadcast(room)
  }
}
