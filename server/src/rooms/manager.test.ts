import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { WebSocket } from 'ws'
import { RoomManager } from './manager.js'
import { RoomRepository } from './repository.js'
import { RoomSnapshot } from './types.js'

function socket(messages: unknown[]): WebSocket {
  return { readyState: WebSocket.OPEN, send: (value: string) => messages.push(JSON.parse(value)) } as unknown as WebSocket
}
function snapshot(messages: unknown[]): RoomSnapshot {
  const item = [...messages].reverse().find(value => (value as { type?: string }).type === 'room-snapshot') as { room: RoomSnapshot } | undefined
  assert.ok(item)
  return item.room
}

test('room manager authorizes two seats and redacts hidden captures per recipient', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-rooms-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new RoomRepository(directory)
  await repository.init()
  const manager = new RoomManager(repository, async () => 'a3a4')
  const created = await manager.createRoom('隐私测试', 'jieqi')
  const redMessages: unknown[] = [], blackMessages: unknown[] = [], spectatorMessages: unknown[] = []
  const red = socket(redMessages), black = socket(blackMessages), spectator = socket(spectatorMessages)
  await manager.handle(red, { type: 'room-subscribe', roomId: created.room.id, token: created.ownerToken, nickname: '红' })
  await manager.handle(red, { type: 'room-claim-seat', roomId: created.room.id, side: 'red', nickname: '红', expectedRevision: snapshot(redMessages).revision, commandId: 'seat-red' })
  await manager.handle(black, { type: 'room-subscribe', roomId: created.room.id, nickname: '黑' })
  await manager.handle(black, { type: 'room-invite-seat', roomId: created.room.id, inviteToken: created.inviteToken, side: 'black', nickname: '黑', expectedRevision: snapshot(blackMessages).revision, commandId: 'seat-black' })
  await manager.handle(red, { type: 'room-ready', roomId: created.room.id, ready: true, expectedRevision: snapshot(redMessages).revision, commandId: 'ready-red' })
  await manager.handle(black, { type: 'room-ready', roomId: created.room.id, ready: true, expectedRevision: snapshot(blackMessages).revision, commandId: 'ready-black' })

  // Keep the moving covered pawns as pawns after reveal so this deterministic
  // line reaches a still-covered black pawn on a6.
  const stored = repository.get(created.room.id)!
  const layout = [...stored.initialLayout!]
  const forcePawn = (target: number, start: number, end: number) => {
    const source = layout.findIndex((type, index) => type === 'p' && index >= start && index < end && index !== target)
    ;[layout[target], layout[source]] = [layout[source], layout[target]]
  }
  forcePawn(15, 15, 30)
  forcePawn(11, 0, 15)
  stored.initialLayout = layout.join('')
  await repository.save(stored)

  const play = async (ws: WebSocket, messages: unknown[], uci: string, id: string) => {
    try { await manager.handle(ws, { type: 'room-move', roomId: created.room.id, uci, expectedRevision: snapshot(messages).revision, commandId: id }) }
    catch (error) { throw new Error(`${id} ${uci}: ${error instanceof Error ? error.message : error}`) }
  }
  await play(red, redMessages, 'a3a4', 'm1')
  await play(black, blackMessages, 'c6c5', 'm2')
  await play(red, redMessages, 'a4a5', 'm3')
  await play(black, blackMessages, 'c5c4', 'm4')
  await play(red, redMessages, 'a5a6', 'm5')
  await manager.handle(spectator, { type: 'room-subscribe', roomId: created.room.id, nickname: '观众' })

  const redCapture = snapshot(redMessages).moves[4]
  const blackCapture = snapshot(blackMessages).moves[4]
  const spectatorCapture = snapshot(spectatorMessages).moves[4]
  assert.equal(redCapture.capturedHidden, true)
  assert.ok(redCapture.captured)
  assert.equal(blackCapture.captured, null)
  assert.equal(spectatorCapture.captured, null)
  assert.equal(JSON.stringify(snapshot(spectatorMessages)).includes(created.room.initialLayout || 'never'), false)

  manager.disconnect(red)
  manager.disconnect(black)
  manager.disconnect(spectator)
})

test('room actions enforce hint quota, negotiated undo, draw, and disconnect loss', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-room-actions-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new RoomRepository(directory)
  await repository.init()
  let hintCalls = 0
  const manager = new RoomManager(repository, async () => { hintCalls++; return 'h2e2' }, 60)
  const created = await manager.createRoom('规则测试', 'xiangqi')
  const redMessages: unknown[] = [], blackMessages: unknown[] = []
  const red = socket(redMessages), black = socket(blackMessages)
  await manager.handle(red, { type: 'room-subscribe', roomId: created.room.id, token: created.ownerToken, nickname: '红' })
  await manager.handle(red, { type: 'room-claim-seat', roomId: created.room.id, side: 'red', nickname: '红', expectedRevision: snapshot(redMessages).revision, commandId: 'r-seat' })
  await manager.handle(black, { type: 'room-subscribe', roomId: created.room.id, nickname: '黑' })
  await manager.handle(black, { type: 'room-invite-seat', roomId: created.room.id, inviteToken: created.inviteToken, side: 'black', nickname: '黑', expectedRevision: snapshot(blackMessages).revision, commandId: 'b-seat' })
  await manager.handle(red, { type: 'room-ready', roomId: created.room.id, ready: true, expectedRevision: snapshot(redMessages).revision, commandId: 'r-ready' })
  await manager.handle(black, { type: 'room-ready', roomId: created.room.id, ready: true, expectedRevision: snapshot(blackMessages).revision, commandId: 'b-ready' })

  for (let index = 0; index < 3; index++) await manager.handle(red, { type: 'room-hint', roomId: created.room.id, expectedRevision: snapshot(redMessages).revision, commandId: `hint-${index}` })
  await assert.rejects(() => manager.handle(red, { type: 'room-hint', roomId: created.room.id, expectedRevision: snapshot(redMessages).revision, commandId: 'hint-4' }), /提示次数/)
  assert.equal(hintCalls, 3)

  await manager.handle(red, { type: 'room-move', roomId: created.room.id, uci: 'h2e2', expectedRevision: snapshot(redMessages).revision, commandId: 'move' })
  await manager.handle(red, { type: 'room-move', roomId: created.room.id, uci: 'h2e2', expectedRevision: snapshot(redMessages).revision, commandId: 'move' })
  assert.equal(snapshot(redMessages).moves.length, 1)
  await manager.handle(red, { type: 'room-undo-request', roomId: created.room.id, expectedRevision: snapshot(redMessages).revision, commandId: 'undo-request' })
  await manager.handle(black, { type: 'room-undo-response', roomId: created.room.id, accept: true, expectedRevision: snapshot(blackMessages).revision, commandId: 'undo-accept' })
  assert.equal(snapshot(redMessages).moves.length, 0)
  assert.equal(snapshot(redMessages).seats.red?.hintsRemaining, 0)

  await manager.handle(red, { type: 'room-draw-offer', roomId: created.room.id, expectedRevision: snapshot(redMessages).revision, commandId: 'draw-request' })
  await manager.handle(black, { type: 'room-draw-response', roomId: created.room.id, accept: true, expectedRevision: snapshot(blackMessages).revision, commandId: 'draw-accept' })
  assert.equal(snapshot(redMessages).status, 'draw')
  assert.equal(manager.lobby().some(room => room.id === created.room.id), false)

  const disconnected = await manager.createRoom('掉线测试', 'xiangqi')
  const oneMessages: unknown[] = [], twoMessages: unknown[] = []
  const one = socket(oneMessages), two = socket(twoMessages)
  await manager.handle(one, { type: 'room-subscribe', roomId: disconnected.room.id, token: disconnected.ownerToken, nickname: '甲' })
  await manager.handle(one, { type: 'room-claim-seat', roomId: disconnected.room.id, side: 'red', nickname: '甲', expectedRevision: snapshot(oneMessages).revision, commandId: 'd-seat-1' })
  await manager.handle(two, { type: 'room-subscribe', roomId: disconnected.room.id, nickname: '乙' })
  await manager.handle(two, { type: 'room-invite-seat', roomId: disconnected.room.id, inviteToken: disconnected.inviteToken, side: 'black', nickname: '乙', expectedRevision: snapshot(twoMessages).revision, commandId: 'd-seat-2' })
  await manager.handle(one, { type: 'room-ready', roomId: disconnected.room.id, ready: true, expectedRevision: snapshot(oneMessages).revision, commandId: 'd-ready-1' })
  await manager.handle(two, { type: 'room-ready', roomId: disconnected.room.id, ready: true, expectedRevision: snapshot(twoMessages).revision, commandId: 'd-ready-2' })
  manager.disconnect(one)
  const originalDeadline = snapshot(twoMessages).disconnect?.deadline
  assert.ok(originalDeadline)
  const spectatorMessages: unknown[] = [], spectator = socket(spectatorMessages)
  await manager.handle(spectator, { type: 'room-subscribe', roomId: disconnected.room.id, nickname: '观众' })
  assert.equal(snapshot(twoMessages).disconnect?.deadline, originalDeadline)
  manager.disconnect(spectator)
  assert.equal(snapshot(twoMessages).disconnect?.deadline, originalDeadline)
  await new Promise(resolve => setTimeout(resolve, 80))
  await manager.flush()
  assert.equal(snapshot(twoMessages).status, 'black-wins')
  assert.equal(snapshot(twoMessages).statusReason, 'disconnect')
  manager.disconnect(two)
})

test('owner can approve a spectator seat request and players can swap before start', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-room-seats-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new RoomRepository(directory)
  await repository.init()
  const manager = new RoomManager(repository, async () => null)
  const created = await manager.createRoom('席位测试', 'xiangqi')
  const ownerMessages: unknown[] = [], applicantMessages: unknown[] = []
  const owner = socket(ownerMessages), applicant = socket(applicantMessages)

  await manager.handle(owner, { type: 'room-subscribe', roomId: created.room.id, token: created.ownerToken, nickname: '房主' })
  await manager.handle(owner, { type: 'room-claim-seat', roomId: created.room.id, side: 'red', nickname: '房主', expectedRevision: snapshot(ownerMessages).revision, commandId: 'owner-seat' })
  await assert.rejects(() => manager.handle(owner, { type: 'room-claim-seat', roomId: created.room.id, side: 'black', nickname: '房主', expectedRevision: snapshot(ownerMessages).revision, commandId: 'owner-seat-again' }), /已经占用一个席位/)
  await manager.handle(applicant, { type: 'room-subscribe', roomId: created.room.id, nickname: '申请者' })
  await manager.handle(applicant, { type: 'room-seat-request', roomId: created.room.id, side: 'black', nickname: '申请者', expectedRevision: snapshot(applicantMessages).revision, commandId: 'apply' })
  const application = snapshot(ownerMessages).applications?.[0]
  assert.ok(application)
  await manager.handle(owner, { type: 'room-seat-approve', roomId: created.room.id, applicationId: application.id, accept: true, expectedRevision: snapshot(ownerMessages).revision, commandId: 'approve' })
  assert.equal(snapshot(applicantMessages).role, 'black')

  await manager.handle(owner, { type: 'room-swap-request', roomId: created.room.id, expectedRevision: snapshot(ownerMessages).revision, commandId: 'swap-request' })
  await manager.handle(applicant, { type: 'room-swap-response', roomId: created.room.id, accept: true, expectedRevision: snapshot(applicantMessages).revision, commandId: 'swap-accept' })
  assert.equal(snapshot(ownerMessages).role, 'black')
  assert.equal(snapshot(applicantMessages).role, 'red')
  assert.equal(snapshot(ownerMessages).seats.red?.nickname, '申请者')
  assert.equal(snapshot(ownerMessages).seats.black?.nickname, '房主')

  manager.disconnect(owner)
  manager.disconnect(applicant)
})

test('disconnect adjudication waits behind an active command and cannot be overwritten by it', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-room-disconnect-queue-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new RoomRepository(directory)
  await repository.init()
  let resolveHint!: (move: string | null) => void
  let markHintStarted!: () => void
  const hintStarted = new Promise<void>(resolve => { markHintStarted = resolve })
  const manager = new RoomManager(repository, async () => {
    markHintStarted()
    return new Promise<string | null>(resolve => { resolveHint = resolve })
  }, 15)
  const created = await manager.createRoom('串行掉线测试', 'xiangqi')
  const redMessages: unknown[] = [], blackMessages: unknown[] = []
  const red = socket(redMessages), black = socket(blackMessages)
  await manager.handle(red, { type: 'room-subscribe', roomId: created.room.id, token: created.ownerToken, nickname: '红' })
  await manager.handle(red, { type: 'room-claim-seat', roomId: created.room.id, side: 'red', nickname: '红', expectedRevision: snapshot(redMessages).revision, commandId: 'queue-seat-red' })
  await manager.handle(black, { type: 'room-subscribe', roomId: created.room.id, nickname: '黑' })
  await manager.handle(black, { type: 'room-invite-seat', roomId: created.room.id, inviteToken: created.inviteToken, side: 'black', nickname: '黑', expectedRevision: snapshot(blackMessages).revision, commandId: 'queue-seat-black' })
  await manager.handle(red, { type: 'room-ready', roomId: created.room.id, ready: true, expectedRevision: snapshot(redMessages).revision, commandId: 'queue-ready-red' })
  await manager.handle(black, { type: 'room-ready', roomId: created.room.id, ready: true, expectedRevision: snapshot(blackMessages).revision, commandId: 'queue-ready-black' })

  const hint = manager.handle(red, { type: 'room-hint', roomId: created.room.id, expectedRevision: snapshot(redMessages).revision, commandId: 'slow-hint' })
  await hintStarted
  manager.disconnect(red)
  await new Promise(resolve => setTimeout(resolve, 25))
  resolveHint('h2e2')
  await hint
  await manager.flush()

  assert.equal(repository.get(created.room.id)?.phase, 'finished')
  assert.equal(repository.get(created.room.id)?.statusReason, 'disconnect')
  assert.equal(snapshot(blackMessages).status, 'black-wins')
  manager.disconnect(black)
})

test('starting with an already disconnected ready player begins the disconnect countdown', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-room-start-disconnected-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new RoomRepository(directory)
  await repository.init()
  const manager = new RoomManager(repository, async () => null, 20)
  const created = await manager.createRoom('开局掉线测试', 'xiangqi')
  const redMessages: unknown[] = [], blackMessages: unknown[] = []
  const red = socket(redMessages), black = socket(blackMessages)
  await manager.handle(red, { type: 'room-subscribe', roomId: created.room.id, token: created.ownerToken, nickname: '红' })
  await manager.handle(red, { type: 'room-claim-seat', roomId: created.room.id, side: 'red', nickname: '红', expectedRevision: snapshot(redMessages).revision, commandId: 'start-seat-red' })
  await manager.handle(black, { type: 'room-subscribe', roomId: created.room.id, nickname: '黑' })
  await manager.handle(black, { type: 'room-invite-seat', roomId: created.room.id, inviteToken: created.inviteToken, side: 'black', nickname: '黑', expectedRevision: snapshot(blackMessages).revision, commandId: 'start-seat-black' })
  await manager.handle(red, { type: 'room-ready', roomId: created.room.id, ready: true, expectedRevision: snapshot(redMessages).revision, commandId: 'start-ready-red' })
  manager.disconnect(red)
  await manager.handle(black, { type: 'room-ready', roomId: created.room.id, ready: true, expectedRevision: snapshot(blackMessages).revision, commandId: 'start-ready-black' })
  assert.equal(snapshot(blackMessages).disconnect?.color, 'red')
  await new Promise(resolve => setTimeout(resolve, 35))
  await manager.flush()
  assert.equal(snapshot(blackMessages).status, 'black-wins')
  assert.equal(snapshot(blackMessages).statusReason, 'disconnect')
  manager.disconnect(black)
})
