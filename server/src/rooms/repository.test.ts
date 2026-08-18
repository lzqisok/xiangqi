import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { RoomRepository } from './repository.js'
import { StoredRoom } from './types.js'

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}
function room(): StoredRoom {
  const now = Date.now()
  return {
    schemaVersion: 1,
    id: randomUUID(),
    name: '持久化测试',
    variant: 'xiangqi',
    phase: 'waiting',
    revision: 0,
    ownerHash: hash('owner'),
    inviteHash: hash('invite'),
    seats: {},
    moves: [],
    status: 'playing',
    createdAt: now,
    updatedAt: now,
  }
}

test('room repository reloads the latest valid snapshot and falls back to its backup', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-room-repository-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const stored = room()
  const repository = new RoomRepository(directory)
  await repository.init()
  await repository.create(stored)
  stored.revision = 1
  stored.name = '最新名称'
  stored.updatedAt++
  await repository.save(stored)

  const reloaded = new RoomRepository(directory)
  await reloaded.init()
  assert.equal(reloaded.get(stored.id)?.revision, 1)
  assert.equal(reloaded.get(stored.id)?.name, '最新名称')

  await writeFile(path.join(directory, `${stored.id}.json`), '{broken', 'utf8')
  const recovered = new RoomRepository(directory)
  await recovered.init()
  assert.equal(recovered.get(stored.id)?.revision, 0)
  assert.equal(recovered.get(stored.id)?.name, '持久化测试')
})

test('room repository rejects malformed persisted move data', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-room-invalid-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const stored = room()
  stored.moves = [{ uci: 'z0z1', color: 'red' }]
  await writeFile(path.join(directory, `${stored.id}.json`), JSON.stringify(stored), 'utf8')

  const repository = new RoomRepository(directory)
  await repository.init()
  assert.equal(repository.get(stored.id), null)
})

test('room repository removes primary and backup snapshots', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-room-delete-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const stored = room()
  const repository = new RoomRepository(directory)
  await repository.init()
  await repository.create(stored)
  await repository.chat.append(stored.id, {
    id: randomUUID(),
    authorId: 'a'.repeat(64),
    nickname: '房主',
    role: 'owner',
    isOwner: true,
    content: '测试消息',
    createdAt: Date.now(),
  })
  await repository.chat.updateSettings(stored.id, {
    everyoneMuted: true,
    mutedAuthorIds: ['b'.repeat(64)],
    roomSensitiveWords: ['广告'],
  })
  stored.revision++
  await repository.save(stored)
  await repository.delete(stored.id)
  assert.equal(repository.get(stored.id), null)
  await assert.rejects(() => access(path.join(directory, `${stored.id}.json`)))
  await assert.rejects(() => access(path.join(directory, `${stored.id}.json.bak`)))
  await assert.rejects(() => access(path.join(directory, `${stored.id}.chat.json`)))
  await assert.rejects(() => access(path.join(directory, `${stored.id}.chat.json.bak`)))
})

test('room chat repository persists bounded ordered history independently', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-room-chat-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const stored = room()
  const repository = new RoomRepository(directory)
  await repository.init()
  await repository.create(stored)
  for (let index = 0; index < 105; index++) {
    await repository.chat.append(stored.id, {
      id: randomUUID(),
      authorId: 'b'.repeat(64),
      nickname: '观众',
      role: 'spectator',
      isOwner: false,
      content: `消息 ${index}`,
      createdAt: Date.now() + index,
    })
  }
  assert.equal(repository.chat.list(stored.id).length, 100)
  assert.equal(repository.chat.list(stored.id)[0].content, '消息 5')
  assert.equal(repository.chat.list(stored.id).at(-1)?.sequence, 105)
  await repository.chat.updateSettings(stored.id, {
    everyoneMuted: true,
    mutedAuthorIds: ['b'.repeat(64)],
    roomSensitiveWords: ['广告'],
  })

  const reloaded = new RoomRepository(directory)
  await reloaded.init()
  assert.equal(reloaded.chat.list(stored.id).length, 100)
  assert.equal(reloaded.chat.list(stored.id).at(-1)?.content, '消息 104')
  assert.deepEqual(reloaded.chat.settings(stored.id), {
    everyoneMuted: true,
    mutedAuthorIds: ['b'.repeat(64)],
    roomSensitiveWords: ['广告'],
  })
})
