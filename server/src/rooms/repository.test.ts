import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { RoomRepository } from './repository.js'
import { StoredRoom } from './types.js'

function hash(value: string) { return createHash('sha256').update(value).digest('hex') }
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

test('room repository reloads the latest valid snapshot and falls back to its backup', async t => {
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

test('room repository rejects malformed persisted move data', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-room-invalid-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const stored = room()
  stored.moves = [{ uci: 'z0z1', color: 'red' }]
  await writeFile(path.join(directory, `${stored.id}.json`), JSON.stringify(stored), 'utf8')

  const repository = new RoomRepository(directory)
  await repository.init()
  assert.equal(repository.get(stored.id), null)
})

test('room repository removes primary and backup snapshots', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-room-delete-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const stored = room()
  const repository = new RoomRepository(directory)
  await repository.init()
  await repository.create(stored)
  stored.revision++
  await repository.save(stored)
  await repository.delete(stored.id)
  assert.equal(repository.get(stored.id), null)
  await assert.rejects(() => access(path.join(directory, `${stored.id}.json`)))
  await assert.rejects(() => access(path.join(directory, `${stored.id}.json.bak`)))
})
