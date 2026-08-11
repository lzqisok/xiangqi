import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { StoredRoom } from './types.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HASH = /^[0-9a-f]{64}$/
const UCI = /^[a-i][0-9][a-i][0-9]$/
const PIECES = new Set(['k', 'a', 'b', 'n', 'r', 'c', 'p'])
const STATUSES = new Set(['playing', 'red-wins', 'black-wins', 'draw'])
const REASONS = new Set(['checkmate', 'stalemate', 'resignation', 'agreement', 'repetition', 'natural-limit', 'move-limit', 'disconnect'])
function validLayout(layout: string) {
  if (!/^[rabncp]{30}$/.test(layout)) return false
  return [layout.slice(0, 15), layout.slice(15)].every(side => [...side].sort().join('') === [...'rraabbnnccppppp'].sort().join(''))
}
function validRoom(value: unknown): value is StoredRoom {
  if (!value || typeof value !== 'object') return false
  const room = value as StoredRoom
  if (room.schemaVersion !== 1 || !UUID.test(room.id) || typeof room.name !== 'string' || room.name.length > 60 || !['xiangqi', 'jieqi'].includes(room.variant) || !['waiting', 'playing', 'finished'].includes(room.phase)) return false
  if (!Number.isInteger(room.revision) || room.revision < 0 || !HASH.test(room.ownerHash) || room.inviteHash !== undefined && !HASH.test(room.inviteHash)) return false
  if (!Array.isArray(room.moves) || room.moves.length > 2000 || !room.moves.every(move => (
    move && UCI.test(move.uci) && (move.color === 'red' || move.color === 'black') &&
    (move.revealed === undefined || PIECES.has(move.revealed)) &&
    (move.captured === undefined || PIECES.has(move.captured)) &&
    (move.capturedColor === undefined || move.capturedColor === 'red' || move.capturedColor === 'black') &&
    (move.capturedHidden === undefined || typeof move.capturedHidden === 'boolean')
  ))) return false
  if (room.variant === 'jieqi' && room.phase !== 'waiting' && !validLayout(room.initialLayout || '')) return false
  if (room.variant === 'xiangqi' && room.initialLayout !== undefined) return false
  for (const seat of Object.values(room.seats || {})) {
    if (!seat || typeof seat.nickname !== 'string' || seat.nickname.length > 20 || !HASH.test(seat.credentialHash) || typeof seat.ready !== 'boolean' || !Number.isInteger(seat.hintsUsed) || seat.hintsUsed < 0 || seat.hintsUsed > 3) return false
  }
  if (!STATUSES.has(room.status) || room.statusReason !== undefined && !REASONS.has(room.statusReason)) return false
  if ((room.phase === 'finished') !== (room.status !== 'playing')) return false
  if (room.phase === 'playing' && (!room.seats.red || !room.seats.black)) return false
  return Number.isFinite(room.createdAt) && Number.isFinite(room.updatedAt) &&
    (room.startedAt === undefined || Number.isFinite(room.startedAt)) &&
    (room.finishedAt === undefined || Number.isFinite(room.finishedAt))
}

export class RoomRepository {
  private rooms = new Map<string, StoredRoom>()
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly directory: string) {}

  async init() {
    await mkdir(this.directory, { recursive: true })
    for (const file of await readdir(this.directory)) {
      const match = /^([0-9a-f-]{36})\.json$/i.exec(file)
      if (!match) continue
      const room = await this.read(path.join(this.directory, file)) || await this.read(path.join(this.directory, `${match[1]}.json.bak`))
      if (room) this.rooms.set(room.id, room)
    }
  }

  list() { return [...this.rooms.values()].map(room => structuredClone(room)) }
  get(id: string) { const room = this.rooms.get(id); return room ? structuredClone(room) : null }

  async create(room: StoredRoom) {
    if (this.rooms.has(room.id)) throw new Error('房间已存在')
    await this.mutate(async () => { await this.write(room); this.rooms.set(room.id, structuredClone(room)) })
    return structuredClone(room)
  }

  async save(room: StoredRoom) {
    await this.mutate(async () => { await this.write(room); this.rooms.set(room.id, structuredClone(room)) })
    return structuredClone(room)
  }

  async flush() { await this.queue }

  private async mutate(action: () => Promise<void>) {
    const result = this.queue.then(action, action)
    this.queue = result.catch(() => undefined)
    return result
  }

  private async write(room: StoredRoom) {
    const target = path.join(this.directory, `${room.id}.json`)
    const temporary = `${target}.${randomUUID()}.tmp`
    await mkdir(this.directory, { recursive: true })
    await copyFile(target, `${target}.bak`).catch(() => undefined)
    try {
      const handle = await open(temporary, 'w', 0o600)
      try { await handle.writeFile(JSON.stringify(room), 'utf8'); await handle.sync() } finally { await handle.close() }
      await rename(temporary, target)
    } catch (error) { await unlink(temporary).catch(() => undefined); throw error }
  }

  private async read(file: string): Promise<StoredRoom | null> {
    try {
      const room = JSON.parse(await readFile(file, 'utf8')) as StoredRoom
      return validRoom(room) ? room : null
    } catch { return null }
  }
}
