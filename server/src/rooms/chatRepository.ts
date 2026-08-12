import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { normalizeRoomSensitiveWords } from './chatPolicy.js'
import { RoomChatMessage, StoredRoomChat } from './types.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ROLES = new Set(['owner', 'red', 'black', 'spectator'])
const AUTHOR_ID = /^[0-9a-f]{64}$/
export const MAX_ROOM_CHAT_MESSAGES = 100
export const MAX_ROOM_CHAT_CONTENT_LENGTH = 200

function validMessage(value: unknown): value is RoomChatMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as RoomChatMessage
  return UUID.test(message.id) && Number.isInteger(message.sequence) && message.sequence > 0 &&
    AUTHOR_ID.test(message.authorId) &&
    typeof message.nickname === 'string' && message.nickname.length > 0 && message.nickname.length <= 20 &&
    ROLES.has(message.role) && typeof message.isOwner === 'boolean' &&
    typeof message.content === 'string' && message.content.trim().length > 0 &&
    Array.from(message.content).length <= MAX_ROOM_CHAT_CONTENT_LENGTH && Number.isFinite(message.createdAt)
}

function validChat(value: unknown, roomId: string): value is StoredRoomChat {
  if (!value || typeof value !== 'object') return false
  const chat = value as StoredRoomChat
  if (chat.schemaVersion !== 1 || chat.roomId !== roomId || !Number.isInteger(chat.sequence) || chat.sequence < 0) return false
  if (!Array.isArray(chat.messages) || chat.messages.length > MAX_ROOM_CHAT_MESSAGES || !chat.messages.every(validMessage)) return false
  if (typeof chat.everyoneMuted !== 'boolean' || !Array.isArray(chat.mutedAuthorIds) || chat.mutedAuthorIds.length > 100 || !chat.mutedAuthorIds.every(id => AUTHOR_ID.test(id))) return false
  try { if (JSON.stringify(normalizeRoomSensitiveWords(chat.roomSensitiveWords)) !== JSON.stringify(chat.roomSensitiveWords)) return false } catch { return false }
  return chat.messages.every((message, index) => index === 0 || message.sequence > chat.messages[index - 1].sequence) &&
    (chat.messages.at(-1)?.sequence ?? 0) <= chat.sequence
}

export class RoomChatRepository {
  private chats = new Map<string, StoredRoomChat>()
  private queues = new Map<string, Promise<void>>()

  constructor(private readonly directory: string) {}

  async init(roomIds: Set<string>) {
    await mkdir(this.directory, { recursive: true })
    for (const file of await readdir(this.directory)) {
      const match = /^([0-9a-f-]{36})\.chat\.json$/i.exec(file)
      if (!match || !roomIds.has(match[1])) continue
      const target = path.join(this.directory, file)
      const chat = await this.read(target, match[1]) || await this.read(`${target}.bak`, match[1])
      if (chat) this.chats.set(chat.roomId, chat)
    }
  }

  list(roomId: string) { return structuredClone(this.chats.get(roomId)?.messages || []) }

  settings(roomId: string) {
    const chat = this.chats.get(roomId)
    return structuredClone({ everyoneMuted: chat?.everyoneMuted || false, mutedAuthorIds: chat?.mutedAuthorIds || [], roomSensitiveWords: chat?.roomSensitiveWords || [] })
  }

  async append(roomId: string, message: Omit<RoomChatMessage, 'sequence'>) {
    let appended!: RoomChatMessage
    await this.mutate(roomId, async () => {
      const current = this.chats.get(roomId) || this.empty(roomId)
      appended = { ...message, sequence: current.sequence + 1 }
      const next: StoredRoomChat = { ...current, sequence: appended.sequence, messages: [...current.messages, appended].slice(-MAX_ROOM_CHAT_MESSAGES) }
      await this.write(next)
      this.chats.set(roomId, structuredClone(next))
    })
    return structuredClone(appended)
  }

  async updateSettings(roomId: string, settings: { everyoneMuted?: boolean; mutedAuthorIds?: string[]; roomSensitiveWords?: string[] }) {
    await this.mutate(roomId, async () => {
      const current = this.chats.get(roomId) || this.empty(roomId)
      const next: StoredRoomChat = {
        ...current,
        everyoneMuted: settings.everyoneMuted ?? current.everyoneMuted,
        mutedAuthorIds: settings.mutedAuthorIds ? [...new Set(settings.mutedAuthorIds)].slice(0, 100) : current.mutedAuthorIds,
        roomSensitiveWords: settings.roomSensitiveWords ? normalizeRoomSensitiveWords(settings.roomSensitiveWords) : current.roomSensitiveWords,
      }
      if (!next.mutedAuthorIds.every(id => AUTHOR_ID.test(id))) throw new Error('禁言成员标识无效')
      await this.write(next)
      this.chats.set(roomId, structuredClone(next))
    })
    return this.settings(roomId)
  }

  async deleteMessage(roomId: string, messageId: string) {
    let deleted = false
    await this.mutate(roomId, async () => {
      const current = this.chats.get(roomId)
      if (!current || !current.messages.some(message => message.id === messageId)) return
      const next = { ...current, messages: current.messages.filter(message => message.id !== messageId) }
      await this.write(next)
      this.chats.set(roomId, structuredClone(next))
      deleted = true
    })
    return deleted
  }

  async delete(roomId: string) {
    await this.mutate(roomId, async () => {
      const target = this.target(roomId)
      await Promise.all([unlink(target).catch(() => undefined), unlink(`${target}.bak`).catch(() => undefined)])
      this.chats.delete(roomId)
    })
  }

  async flush() { await Promise.all([...this.queues.values()]) }

  private async mutate(roomId: string, action: () => Promise<void>) {
    const previous = this.queues.get(roomId) || Promise.resolve()
    const result = previous.then(action, action)
    const settled = result.catch(() => undefined)
    this.queues.set(roomId, settled)
    void settled.finally(() => { if (this.queues.get(roomId) === settled) this.queues.delete(roomId) })
    return result
  }

  private target(roomId: string) { return path.join(this.directory, `${roomId}.chat.json`) }
  private empty(roomId: string): StoredRoomChat { return { schemaVersion: 1, roomId, sequence: 0, messages: [], everyoneMuted: false, mutedAuthorIds: [], roomSensitiveWords: [] } }

  private async write(chat: StoredRoomChat) {
    const target = this.target(chat.roomId)
    const temporary = `${target}.${randomUUID()}.tmp`
    await mkdir(this.directory, { recursive: true })
    await copyFile(target, `${target}.bak`).catch(() => undefined)
    try {
      const handle = await open(temporary, 'w', 0o600)
      try { await handle.writeFile(JSON.stringify(chat), 'utf8'); await handle.sync() } finally { await handle.close() }
      await rename(temporary, target)
    } catch (error) { await unlink(temporary).catch(() => undefined); throw error }
  }

  private async read(file: string, roomId: string) {
    try {
      const chat = JSON.parse(await readFile(file, 'utf8')) as unknown
      return validChat(chat, roomId) ? chat : null
    } catch { return null }
  }
}
