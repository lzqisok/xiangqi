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
  return {
    readyState: WebSocket.OPEN,
    send: (value: string) => messages.push(JSON.parse(value)),
  } as unknown as WebSocket
}
function snapshot(messages: unknown[]): RoomSnapshot {
  const item = [...messages]
    .reverse()
    .find((value) => (value as { type?: string }).type === 'room-snapshot') as
    { room: RoomSnapshot } | undefined
  assert.ok(item)
  return item.room
}
function message(messages: unknown[], type: string) {
  return [...messages].reverse().find((value) => (value as { type?: string }).type === type) as
    Record<string, unknown> | undefined
}
function chatMessages(messages: unknown[]) {
  return messages
    .filter((value) => (value as { type?: string }).type === 'room-chat-message')
    .map((value) => (value as { message: Record<string, unknown> }).message)
}

test('Gomoku rooms reuse seats and revisions while keeping lobby and move rules isolated', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gomoku-rooms-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new RoomRepository(directory)
  await repository.init()
  const manager = new RoomManager(repository, async () => null)
  const created = await manager.createRoom('五子棋联机', 'gomoku', 'renju')
  const blackMessages: unknown[] = [],
    whiteMessages: unknown[] = []
  const black = socket(blackMessages),
    white = socket(whiteMessages)
  await manager.handle(black, {
    type: 'room-subscribe',
    roomId: created.room.id,
    token: created.ownerToken,
    nickname: '先手',
  })
  await manager.handle(black, {
    type: 'room-claim-seat',
    roomId: created.room.id,
    side: 'red',
    nickname: '先手',
    expectedRevision: snapshot(blackMessages).revision,
    commandId: 'g-seat-black',
  })
  await manager.handle(white, { type: 'room-subscribe', roomId: created.room.id, nickname: '后手' })
  await manager.handle(white, {
    type: 'room-invite-seat',
    roomId: created.room.id,
    inviteToken: created.inviteToken,
    side: 'black',
    nickname: '后手',
    expectedRevision: snapshot(whiteMessages).revision,
    commandId: 'g-seat-white',
  })
  await manager.handle(black, {
    type: 'room-ready',
    roomId: created.room.id,
    ready: true,
    expectedRevision: snapshot(blackMessages).revision,
    commandId: 'g-ready-black',
  })
  await manager.handle(white, {
    type: 'room-ready',
    roomId: created.room.id,
    ready: true,
    expectedRevision: snapshot(whiteMessages).revision,
    commandId: 'g-ready-white',
  })
  assert.equal(snapshot(blackMessages).variant, 'gomoku')
  assert.equal(snapshot(blackMessages).gomokuRule, 'renju')
  assert.equal(snapshot(blackMessages).board.length, 15)
  assert.equal(
    manager.lobby('xiangqi').some((room) => room.id === created.room.id),
    false,
  )
  assert.equal(
    manager.lobby('gomoku').some((room) => room.id === created.room.id),
    true,
  )

  const sequence: Array<[WebSocket, unknown[], number, number]> = [
    [black, blackMessages, 7, 3],
    [white, whiteMessages, 0, 0],
    [black, blackMessages, 7, 4],
    [white, whiteMessages, 0, 1],
    [black, blackMessages, 7, 5],
    [white, whiteMessages, 0, 2],
    [black, blackMessages, 7, 6],
    [white, whiteMessages, 0, 3],
    [black, blackMessages, 7, 7],
  ]
  for (const [index, [ws, messages, row, col]] of sequence.entries()) {
    await manager.handle(ws, {
      type: 'room-move',
      roomId: created.room.id,
      row,
      col,
      expectedRevision: snapshot(messages).revision,
      commandId: `g-move-${row}-${col}`,
    })
    if (index === 0) {
      const revision = snapshot(whiteMessages).revision
      await assert.rejects(
        () =>
          manager.handle(white, {
            type: 'room-move',
            roomId: created.room.id,
            row,
            col,
            expectedRevision: revision,
            commandId: 'g-occupied',
          }),
        /已有棋子/,
      )
      assert.equal(snapshot(whiteMessages).revision, revision)
      assert.equal(snapshot(whiteMessages).moves.length, 1)
    }
  }
  assert.equal(snapshot(blackMessages).status, 'red-wins')
  assert.equal(snapshot(blackMessages).statusReason, 'five')
  assert.equal(snapshot(blackMessages).moves[8].notation, 'H8')
  assert.equal(manager.history(20, 'gomoku')[0].id, created.room.id)
  await manager.flush()
  manager.dispose()
})

test('quick match pairs compatible online players and starts only after both subscribe', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'quick-match-rooms-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new RoomRepository(directory)
  await repository.init()
  const manager = new RoomManager(repository, async () => null)

  const first = await manager.quickMatch('甲', 'xiangqi')
  assert.equal(first.created, true)
  assert.ok(first.role === 'red' || first.role === 'black')
  assert.equal(first.room.matchmaking, true)
  assert.equal(
    manager.lobby('xiangqi').some((room) => room.id === first.room.id),
    false,
  )

  const firstMessages: unknown[] = []
  const firstSocket = socket(firstMessages)
  await manager.handle(firstSocket, {
    type: 'room-subscribe',
    roomId: first.room.id,
    token: first.token,
    nickname: '甲',
  })
  assert.equal(snapshot(firstMessages).phase, 'waiting')
  assert.equal(snapshot(firstMessages).seats[first.role]?.ready, true)

  const second = await manager.quickMatch('乙', 'xiangqi')
  assert.equal(second.created, false)
  assert.equal(second.room.id, first.room.id)
  assert.notEqual(second.role, first.role)
  assert.equal(second.room.phase, 'waiting')

  const secondMessages: unknown[] = []
  const secondSocket = socket(secondMessages)
  await manager.handle(secondSocket, {
    type: 'room-subscribe',
    roomId: second.room.id,
    token: second.token,
    nickname: '乙',
  })
  assert.equal(snapshot(firstMessages).phase, 'playing')
  assert.equal(snapshot(secondMessages).phase, 'playing')
  assert.equal(snapshot(secondMessages).role, second.role)
  assert.equal(snapshot(secondMessages).matchmaking, true)
  await assert.rejects(
    () =>
      manager.handle(firstSocket, {
        type: 'room-chat-settings-update',
        roomId: first.room.id,
        commandId: 'quick-match-moderation',
        everyoneMuted: true,
        roomSensitiveWords: [],
      }),
    /只有对局发起人可以修改聊天设置/,
  )
  assert.equal(
    manager.lobby('xiangqi').some((room) => room.id === first.room.id),
    true,
  )

  await manager.flush()
  manager.dispose()
})

test('quick match serializes competing requests and isolates every ruleset', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'quick-match-rules-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new RoomRepository(directory)
  await repository.init()
  const manager = new RoomManager(repository, async () => null)

  const waiting = await manager.quickMatch('先到者', 'gomoku', 'freestyle')
  const waitingMessages: unknown[] = []
  await manager.handle(socket(waitingMessages), {
    type: 'room-subscribe',
    roomId: waiting.room.id,
    token: waiting.token,
    nickname: '先到者',
  })

  const [matched, overflow] = await Promise.all([
    manager.quickMatch('匹配者', 'gomoku', 'freestyle'),
    manager.quickMatch('排队者', 'gomoku', 'freestyle'),
  ])
  assert.equal(matched.room.id, waiting.room.id)
  assert.equal(matched.created, false)
  assert.equal(overflow.created, true)
  assert.notEqual(overflow.room.id, waiting.room.id)

  const renju = await manager.quickMatch('禁手玩家', 'gomoku', 'renju')
  const jieqi = await manager.quickMatch('揭棋玩家', 'jieqi')
  assert.equal(renju.created, true)
  assert.equal(renju.room.gomokuRule, 'renju')
  assert.notEqual(renju.room.id, overflow.room.id)
  assert.equal(jieqi.created, true)
  assert.equal(jieqi.room.variant, 'jieqi')

  await manager.flush()
  manager.dispose()
})

test('room chat supports every role without changing the gameplay revision', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-room-chat-manager-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new RoomRepository(directory)
  await repository.init()
  const manager = new RoomManager(repository, async () => null)
  const created = await manager.createRoom('聊天测试', 'xiangqi')
  const ownerMessages: unknown[] = [],
    redMessages: unknown[] = [],
    blackMessages: unknown[] = [],
    spectatorMessages: unknown[] = []
  const owner = socket(ownerMessages),
    red = socket(redMessages),
    black = socket(blackMessages),
    spectator = socket(spectatorMessages)
  await manager.handle(owner, {
    type: 'room-subscribe',
    roomId: created.room.id,
    token: created.ownerToken,
    nickname: '房主',
  })
  await manager.handle(red, { type: 'room-subscribe', roomId: created.room.id, nickname: '红方' })
  await manager.handle(red, {
    type: 'room-invite-seat',
    roomId: created.room.id,
    inviteToken: created.inviteToken,
    side: 'red',
    nickname: '红\n方',
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'chat-seat-red',
  })
  await manager.handle(black, { type: 'room-subscribe', roomId: created.room.id, nickname: '黑方' })
  await manager.handle(black, {
    type: 'room-seat-request',
    roomId: created.room.id,
    side: 'black',
    nickname: '黑方',
    expectedRevision: snapshot(blackMessages).revision,
    commandId: 'chat-apply-black',
  })
  const application = snapshot(ownerMessages).applications?.[0]
  assert.ok(application)
  await manager.handle(owner, {
    type: 'room-seat-approve',
    roomId: created.room.id,
    applicationId: application.id,
    accept: true,
    expectedRevision: snapshot(ownerMessages).revision,
    commandId: 'chat-approve-black',
  })
  await manager.handle(spectator, {
    type: 'room-subscribe',
    roomId: created.room.id,
    nickname: '观众',
  })
  const gameplayRevision = snapshot(redMessages).revision

  await manager.handle(owner, {
    type: 'room-chat-send',
    roomId: created.room.id,
    commandId: 'chat-owner',
    content: '房主消息',
    role: 'red',
    nickname: '新\n房主昵称',
  })
  await manager.handle(red, {
    type: 'room-chat-send',
    roomId: created.room.id,
    commandId: 'chat-red',
    content: '红方消息',
    nickname: '伪造棋手昵称',
  })
  await manager.handle(black, {
    type: 'room-chat-send',
    roomId: created.room.id,
    commandId: 'chat-black',
    content: '黑方消息',
  })
  await manager.handle(spectator, {
    type: 'room-chat-send',
    roomId: created.room.id,
    commandId: 'chat-spectator',
    content: '观众消息',
    nickname: '新\n观众昵称',
  })

  assert.equal(snapshot(redMessages).revision, gameplayRevision)
  assert.equal(chatMessages(redMessages).length, 4)
  assert.deepEqual(
    chatMessages(redMessages).map((item) => item.role),
    ['owner', 'red', 'black', 'spectator'],
  )
  assert.equal(chatMessages(redMessages)[0].nickname, '新房主昵称')
  assert.equal(chatMessages(redMessages)[0].isOwner, true)
  assert.equal(chatMessages(redMessages)[1].nickname, '红方')
  assert.equal(chatMessages(redMessages)[3].nickname, '新观众昵称')
  assert.deepEqual(
    chatMessages(spectatorMessages).map((item) => item.sequence),
    [1, 2, 3, 4],
  )
  await assert.rejects(
    () =>
      manager.handle(spectator, {
        type: 'room-chat-send',
        roomId: created.room.id,
        commandId: 'chat-empty',
        content: '   ',
      }),
    /不能为空/,
  )
  await assert.rejects(
    () =>
      manager.handle(spectator, {
        type: 'room-chat-send',
        roomId: created.room.id,
        commandId: 'chat-long',
        content: '字'.repeat(201),
      }),
    /不能超过/,
  )

  const isolated = await manager.createRoom('隔离房间', 'xiangqi')
  const isolatedMessages: unknown[] = [],
    isolatedSocket = socket(isolatedMessages)
  await manager.handle(isolatedSocket, {
    type: 'room-subscribe',
    roomId: isolated.room.id,
    nickname: '另一房间观众',
  })
  assert.equal(chatMessages(isolatedMessages).length, 0)

  await manager.handle(red, {
    type: 'room-chat-send',
    roomId: created.room.id,
    commandId: 'chat-red',
    content: '不应重复',
  })
  assert.equal(chatMessages(spectatorMessages).length, 4)
  await manager.handle(red, {
    type: 'room-ready',
    roomId: created.room.id,
    ready: true,
    expectedRevision: gameplayRevision,
    commandId: 'chat-ready-after-message',
  })

  const targetId = String(chatMessages(ownerMessages)[3].id)
  await assert.rejects(
    () =>
      manager.handle(spectator, {
        type: 'room-chat-delete',
        roomId: created.room.id,
        commandId: 'chat-delete-denied',
        messageId: targetId,
      }),
    /只有对局发起人/,
  )
  await manager.handle(owner, {
    type: 'room-chat-delete',
    roomId: created.room.id,
    commandId: 'chat-delete-owner',
    messageId: targetId,
  })
  assert.equal(message(redMessages, 'room-chat-delete')?.messageId, targetId)
  assert.equal(repository.chat.list(created.room.id).length, 3)

  for (let index = 0; index < 4; index++)
    await manager.handle(black, {
      type: 'room-chat-send',
      roomId: created.room.id,
      commandId: `chat-rate-${index}`,
      content: `限流 ${index}`,
    })
  await assert.rejects(
    () =>
      manager.handle(black, {
        type: 'room-chat-send',
        roomId: created.room.id,
        commandId: 'chat-rate-reject',
        content: '过量',
      }),
    /发言过于频繁/,
  )

  const reconnectMessages: unknown[] = [],
    reconnect = socket(reconnectMessages)
  await manager.handle(reconnect, {
    type: 'room-subscribe',
    roomId: created.room.id,
    nickname: '重连观众',
  })
  const history = message(reconnectMessages, 'room-chat-history')?.messages as unknown[]
  assert.equal(history.length, 7)
  manager.disconnect(isolatedSocket)
  await manager.flush()
  manager.dispose()
})

test('room owner can mute members, mute everyone, and filter sensitive messages', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-room-chat-moderation-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new RoomRepository(directory)
  await repository.init()
  const manager = new RoomManager(repository, async () => null)
  const created = await manager.createRoom('治理测试', 'xiangqi')
  const ownerMessages: unknown[] = [],
    spectatorMessages: unknown[] = []
  const owner = socket(ownerMessages),
    spectator = socket(spectatorMessages)
  await manager.handle(owner, {
    type: 'room-subscribe',
    roomId: created.room.id,
    token: created.ownerToken,
    nickname: '房主',
    clientId: '00000000-0000-4000-8000-000000000001',
  })
  await manager.handle(spectator, {
    type: 'room-subscribe',
    roomId: created.room.id,
    nickname: '观众',
    clientId: '00000000-0000-4000-8000-000000000002',
  })
  const initialRevision = created.room.revision
  await manager.handle(spectator, {
    type: 'room-chat-send',
    roomId: created.room.id,
    commandId: 'moderation-intro',
    content: '大家好',
    nickname: '观众',
  })
  const authorId = String(chatMessages(ownerMessages)[0].authorId)

  await assert.rejects(
    () =>
      manager.handle(spectator, {
        type: 'room-chat-mute',
        roomId: created.room.id,
        commandId: 'moderation-denied',
        authorId,
        muted: true,
      }),
    /只有对局发起人/,
  )
  await manager.handle(owner, {
    type: 'room-chat-mute',
    roomId: created.room.id,
    commandId: 'moderation-mute',
    authorId,
    muted: true,
  })
  assert.equal(
    (message(spectatorMessages, 'room-chat-settings')?.settings as { muted: boolean }).muted,
    true,
  )
  assert.deepEqual(
    (message(ownerMessages, 'room-chat-settings')?.settings as { mutedAuthorIds: string[] })
      .mutedAuthorIds,
    [authorId],
  )
  const reconnectMessages: unknown[] = [],
    reconnect = socket(reconnectMessages)
  await manager.handle(reconnect, {
    type: 'room-subscribe',
    roomId: created.room.id,
    nickname: '观众',
    clientId: '00000000-0000-4000-8000-000000000002',
  })
  assert.equal(
    (message(reconnectMessages, 'room-chat-settings')?.settings as { muted: boolean }).muted,
    true,
  )
  await assert.rejects(
    () =>
      manager.handle(spectator, {
        type: 'room-chat-send',
        roomId: created.room.id,
        commandId: 'moderation-muted-send',
        content: '发不出去',
      }),
    /已被对局发起人禁言/,
  )

  const introMessageId = String(chatMessages(ownerMessages)[0].id)
  await manager.handle(owner, {
    type: 'room-chat-delete',
    roomId: created.room.id,
    commandId: 'moderation-delete-muted',
    messageId: introMessageId,
  })
  await manager.handle(owner, {
    type: 'room-chat-mute',
    roomId: created.room.id,
    commandId: 'moderation-unmute',
    authorId,
    muted: false,
  })
  await manager.handle(owner, {
    type: 'room-chat-settings-update',
    roomId: created.room.id,
    commandId: 'moderation-everyone',
    everyoneMuted: true,
    roomSensitiveWords: ['坏词'],
  })
  assert.equal(
    (message(spectatorMessages, 'room-chat-settings')?.settings as { everyoneMuted: boolean })
      .everyoneMuted,
    true,
  )
  await assert.rejects(
    () =>
      manager.handle(spectator, {
        type: 'room-chat-send',
        roomId: created.room.id,
        commandId: 'moderation-all-muted',
        content: '仍然发不出去',
      }),
    /全面禁言/,
  )
  await manager.handle(owner, {
    type: 'room-chat-send',
    roomId: created.room.id,
    commandId: 'moderation-owner-send',
    content: '房主仍可发言',
  })

  await manager.handle(owner, {
    type: 'room-chat-settings-update',
    roomId: created.room.id,
    commandId: 'moderation-filter',
    everyoneMuted: false,
    roomSensitiveWords: ['坏词'],
  })
  const beforeFiltered = chatMessages(ownerMessages).length
  await manager.handle(spectator, {
    type: 'room-chat-send',
    roomId: created.room.id,
    commandId: 'moderation-room-word',
    content: '这是坏_词',
  })
  assert.equal(message(spectatorMessages, 'room-chat-ack')?.filtered, true)
  await manager.handle(spectator, {
    type: 'room-chat-send',
    roomId: created.room.id,
    commandId: 'moderation-system-word',
    content: '赌 博 平台',
  })
  assert.equal(chatMessages(ownerMessages).length, beforeFiltered)
  assert.equal(repository.chat.list(created.room.id).length, 1)
  assert.equal(repository.get(created.room.id)?.revision, initialRevision)

  await manager.flush()
  manager.dispose()
})

test('room manager authorizes two seats and redacts hidden captures per recipient', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-rooms-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new RoomRepository(directory)
  await repository.init()
  const manager = new RoomManager(repository, async () => 'a3a4')
  const created = await manager.createRoom('隐私测试', 'jieqi')
  const redMessages: unknown[] = [],
    blackMessages: unknown[] = [],
    spectatorMessages: unknown[] = []
  const red = socket(redMessages),
    black = socket(blackMessages),
    spectator = socket(spectatorMessages)
  await manager.handle(red, {
    type: 'room-subscribe',
    roomId: created.room.id,
    token: created.ownerToken,
    nickname: '红',
  })
  await manager.handle(red, {
    type: 'room-claim-seat',
    roomId: created.room.id,
    side: 'red',
    nickname: '红',
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'seat-red',
  })
  await manager.handle(black, { type: 'room-subscribe', roomId: created.room.id, nickname: '黑' })
  await manager.handle(black, {
    type: 'room-invite-seat',
    roomId: created.room.id,
    inviteToken: created.inviteToken,
    side: 'black',
    nickname: '黑',
    expectedRevision: snapshot(blackMessages).revision,
    commandId: 'seat-black',
  })
  const blackSeatToken = String(message(blackMessages, 'room-seat-token')?.token)
  assert.ok(blackSeatToken)
  await manager.handle(red, {
    type: 'room-ready',
    roomId: created.room.id,
    ready: true,
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'ready-red',
  })
  await manager.handle(black, {
    type: 'room-ready',
    roomId: created.room.id,
    ready: true,
    expectedRevision: snapshot(blackMessages).revision,
    commandId: 'ready-black',
  })

  // Keep the moving covered pawns as pawns after reveal so this deterministic
  // line reaches a still-covered black pawn on a6.
  const stored = repository.get(created.room.id)!
  const layout = [...stored.initialLayout!]
  const forcePawn = (target: number, start: number, end: number) => {
    const source = layout.findIndex(
      (type, index) => type === 'p' && index >= start && index < end && index !== target,
    )
    ;[layout[target], layout[source]] = [layout[source], layout[target]]
  }
  forcePawn(15, 15, 30)
  forcePawn(11, 0, 15)
  stored.initialLayout = layout.join('')
  await repository.save(stored)

  const play = async (ws: WebSocket, messages: unknown[], uci: string, id: string) => {
    try {
      await manager.handle(ws, {
        type: 'room-move',
        roomId: created.room.id,
        uci,
        expectedRevision: snapshot(messages).revision,
        commandId: id,
      })
    } catch (error) {
      throw new Error(`${id} ${uci}: ${error instanceof Error ? error.message : error}`)
    }
  }
  await play(red, redMessages, 'a3a4', 'm1')
  await play(black, blackMessages, 'c6c5', 'm2')
  await play(red, redMessages, 'a4a5', 'm3')
  await play(black, blackMessages, 'c5c4', 'm4')
  await play(red, redMessages, 'a5a6', 'm5')
  await play(black, blackMessages, 'c4c3', 'm6')
  await manager.handle(spectator, {
    type: 'room-subscribe',
    roomId: created.room.id,
    nickname: '观众',
  })

  const redCapture = snapshot(redMessages).moves[4]
  const blackCapture = snapshot(blackMessages).moves[4]
  const spectatorCapture = snapshot(spectatorMessages).moves[4]
  assert.equal(redCapture.capturedHidden, true)
  assert.ok(redCapture.captured)
  assert.equal(blackCapture.captured, null)
  assert.equal(spectatorCapture.captured, null)
  assert.equal(
    JSON.stringify(snapshot(spectatorMessages)).includes(created.room.initialLayout || 'never'),
    false,
  )

  await manager.handle(red, {
    type: 'room-draw-offer',
    roomId: created.room.id,
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'finish-draw-offer',
  })
  await manager.handle(black, {
    type: 'room-draw-response',
    roomId: created.room.id,
    accept: true,
    expectedRevision: snapshot(blackMessages).revision,
    commandId: 'finish-draw-accept',
  })

  const redRecord = snapshot(redMessages).jieqiRecord
  const blackRecord = snapshot(blackMessages).jieqiRecord
  const publicRecord = snapshot(spectatorMessages).jieqiRecord
  assert.equal(redRecord?.audience, 'red')
  assert.equal(blackRecord?.audience, 'black')
  assert.equal(publicRecord?.audience, 'public')
  assert.equal(redRecord?.audience === 'red' ? redRecord.privateEvents[0]?.ply : null, 5)
  assert.equal(blackRecord?.audience === 'black' ? blackRecord.privateEvents[0]?.ply : null, 6)
  assert.equal(JSON.stringify(publicRecord).includes('privateEvents'), false)
  assert.equal(JSON.stringify(publicRecord).includes(stored.initialLayout!), false)

  await manager.flush()
  manager.dispose()

  const restoredRepository = new RoomRepository(directory)
  await restoredRepository.init()
  const restoredManager = new RoomManager(restoredRepository, async () => null)
  const restoredRedMessages: unknown[] = [],
    restoredBlackMessages: unknown[] = [],
    restoredSpectatorMessages: unknown[] = []
  const restoredRed = socket(restoredRedMessages),
    restoredBlack = socket(restoredBlackMessages),
    restoredSpectator = socket(restoredSpectatorMessages)
  await restoredManager.handle(restoredRed, {
    type: 'room-subscribe',
    roomId: created.room.id,
    token: created.ownerToken,
  })
  await restoredManager.handle(restoredBlack, {
    type: 'room-subscribe',
    roomId: created.room.id,
    token: blackSeatToken,
  })
  await restoredManager.handle(restoredSpectator, {
    type: 'room-subscribe',
    roomId: created.room.id,
    token: 'invalid-token',
  })
  assert.deepEqual(snapshot(restoredRedMessages).jieqiRecord, redRecord)
  assert.deepEqual(snapshot(restoredBlackMessages).jieqiRecord, blackRecord)
  assert.deepEqual(snapshot(restoredSpectatorMessages).jieqiRecord, publicRecord)
  assert.equal(snapshot(restoredSpectatorMessages).role, 'spectator')
  restoredManager.dispose()
})

test('room actions enforce hint quota, negotiated undo, draw, and disconnect loss', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-room-actions-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new RoomRepository(directory)
  await repository.init()
  let hintCalls = 0
  const manager = new RoomManager(
    repository,
    async () => {
      hintCalls++
      return 'h2e2'
    },
    60,
  )
  const created = await manager.createRoom('规则测试', 'xiangqi')
  const redMessages: unknown[] = [],
    blackMessages: unknown[] = []
  const red = socket(redMessages),
    black = socket(blackMessages)
  await manager.handle(red, {
    type: 'room-subscribe',
    roomId: created.room.id,
    token: created.ownerToken,
    nickname: '红',
  })
  await manager.handle(red, {
    type: 'room-claim-seat',
    roomId: created.room.id,
    side: 'red',
    nickname: '红',
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'r-seat',
  })
  await manager.handle(black, { type: 'room-subscribe', roomId: created.room.id, nickname: '黑' })
  await manager.handle(black, {
    type: 'room-invite-seat',
    roomId: created.room.id,
    inviteToken: created.inviteToken,
    side: 'black',
    nickname: '黑',
    expectedRevision: snapshot(blackMessages).revision,
    commandId: 'b-seat',
  })
  await manager.handle(red, {
    type: 'room-ready',
    roomId: created.room.id,
    ready: true,
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'r-ready',
  })
  await manager.handle(black, {
    type: 'room-ready',
    roomId: created.room.id,
    ready: true,
    expectedRevision: snapshot(blackMessages).revision,
    commandId: 'b-ready',
  })

  for (let index = 0; index < 3; index++)
    await manager.handle(red, {
      type: 'room-hint',
      roomId: created.room.id,
      expectedRevision: snapshot(redMessages).revision,
      commandId: `hint-${index}`,
    })
  await assert.rejects(
    () =>
      manager.handle(red, {
        type: 'room-hint',
        roomId: created.room.id,
        expectedRevision: snapshot(redMessages).revision,
        commandId: 'hint-4',
      }),
    /提示次数/,
  )
  assert.equal(hintCalls, 3)

  await manager.handle(red, {
    type: 'room-move',
    roomId: created.room.id,
    uci: 'h2e2',
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'move',
  })
  await manager.handle(red, {
    type: 'room-move',
    roomId: created.room.id,
    uci: 'h2e2',
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'move',
  })
  assert.equal(snapshot(redMessages).moves.length, 1)
  await manager.handle(red, {
    type: 'room-undo-request',
    roomId: created.room.id,
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'undo-request',
  })
  await manager.handle(black, {
    type: 'room-undo-response',
    roomId: created.room.id,
    accept: true,
    expectedRevision: snapshot(blackMessages).revision,
    commandId: 'undo-accept',
  })
  assert.equal(snapshot(redMessages).moves.length, 0)
  assert.equal(snapshot(redMessages).seats.red?.hintsRemaining, 0)

  await manager.handle(red, {
    type: 'room-draw-offer',
    roomId: created.room.id,
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'draw-request',
  })
  await manager.handle(black, {
    type: 'room-draw-response',
    roomId: created.room.id,
    accept: true,
    expectedRevision: snapshot(blackMessages).revision,
    commandId: 'draw-accept',
  })
  assert.equal(snapshot(redMessages).status, 'draw')
  assert.equal(snapshot(redMessages).inviteAvailable, false)
  assert.equal(
    manager.lobby().some((room) => room.id === created.room.id),
    false,
  )
  assert.equal(
    manager.history().some((room) => room.id === created.room.id),
    true,
  )

  const historyMessages: unknown[] = []
  const historyViewer = socket(historyMessages)
  await manager.handle(historyViewer, {
    type: 'room-subscribe',
    roomId: created.room.id,
    nickname: '历史记录访客',
  })
  assert.equal(snapshot(historyMessages).phase, 'finished')
  await assert.rejects(
    () =>
      manager.handle(historyViewer, {
        type: 'room-chat-send',
        roomId: created.room.id,
        commandId: 'history-chat-rejected',
        content: '已结束后不能发言',
      }),
    /历史聊天仅供查看/,
  )
  for (const [type, payload] of [
    ['room-chat-delete', { messageId: created.room.id }],
    ['room-chat-mute', { authorId: '0'.repeat(64), muted: true }],
    ['room-chat-settings-update', { everyoneMuted: true, roomSensitiveWords: [] }],
  ] as const)
    await assert.rejects(
      () =>
        manager.handle(red, {
          type,
          roomId: created.room.id,
          commandId: `history-${type}`,
          ...payload,
        }),
      /历史聊天仅供查看/,
    )
  manager.disconnect(historyViewer)

  const disconnected = await manager.createRoom('掉线测试', 'xiangqi')
  const oneMessages: unknown[] = [],
    twoMessages: unknown[] = []
  const one = socket(oneMessages),
    two = socket(twoMessages)
  await manager.handle(one, {
    type: 'room-subscribe',
    roomId: disconnected.room.id,
    token: disconnected.ownerToken,
    nickname: '甲',
  })
  await manager.handle(one, {
    type: 'room-claim-seat',
    roomId: disconnected.room.id,
    side: 'red',
    nickname: '甲',
    expectedRevision: snapshot(oneMessages).revision,
    commandId: 'd-seat-1',
  })
  await manager.handle(two, {
    type: 'room-subscribe',
    roomId: disconnected.room.id,
    nickname: '乙',
  })
  await manager.handle(two, {
    type: 'room-invite-seat',
    roomId: disconnected.room.id,
    inviteToken: disconnected.inviteToken,
    side: 'black',
    nickname: '乙',
    expectedRevision: snapshot(twoMessages).revision,
    commandId: 'd-seat-2',
  })
  await manager.handle(one, {
    type: 'room-ready',
    roomId: disconnected.room.id,
    ready: true,
    expectedRevision: snapshot(oneMessages).revision,
    commandId: 'd-ready-1',
  })
  await manager.handle(two, {
    type: 'room-ready',
    roomId: disconnected.room.id,
    ready: true,
    expectedRevision: snapshot(twoMessages).revision,
    commandId: 'd-ready-2',
  })
  manager.disconnect(one)
  const originalDeadline = snapshot(twoMessages).disconnect?.deadline
  assert.ok(originalDeadline)
  const spectatorMessages: unknown[] = [],
    spectator = socket(spectatorMessages)
  await manager.handle(spectator, {
    type: 'room-subscribe',
    roomId: disconnected.room.id,
    nickname: '观众',
  })
  assert.equal(snapshot(twoMessages).disconnect?.deadline, originalDeadline)
  manager.disconnect(spectator)
  assert.equal(snapshot(twoMessages).disconnect?.deadline, originalDeadline)
  await new Promise((resolve) => setTimeout(resolve, 80))
  await manager.flush()
  assert.equal(snapshot(twoMessages).status, 'black-wins')
  assert.equal(snapshot(twoMessages).statusReason, 'disconnect')
  manager.disconnect(two)
})

test('owner can approve a spectator seat request and players can swap before start', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-room-seats-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new RoomRepository(directory)
  await repository.init()
  const manager = new RoomManager(repository, async () => null)
  const created = await manager.createRoom('席位测试', 'xiangqi')
  const ownerMessages: unknown[] = [],
    applicantMessages: unknown[] = []
  const owner = socket(ownerMessages),
    applicant = socket(applicantMessages)

  await manager.handle(owner, {
    type: 'room-subscribe',
    roomId: created.room.id,
    token: created.ownerToken,
    nickname: '房主',
  })
  await assert.rejects(
    () =>
      manager.handle(owner, {
        type: 'room-claim-seat',
        roomId: created.room.id,
        side: 'red',
        expectedRevision: snapshot(ownerMessages).revision,
      }),
    /操作标识无效/,
  )
  await manager.handle(owner, {
    type: 'room-claim-seat',
    roomId: created.room.id,
    side: 'red',
    nickname: '房主',
    expectedRevision: snapshot(ownerMessages).revision,
    commandId: 'owner-seat',
  })
  await manager.handle(owner, {
    type: 'room-ready',
    roomId: created.room.id,
    ready: true,
    expectedRevision: snapshot(ownerMessages).revision,
    commandId: 'owner-ready-before-switch',
  })
  await manager.handle(owner, {
    type: 'room-switch-seat',
    roomId: created.room.id,
    side: 'black',
    expectedRevision: snapshot(ownerMessages).revision,
    commandId: 'owner-switch-black',
  })
  assert.equal(snapshot(ownerMessages).role, 'black')
  assert.equal(snapshot(ownerMessages).seats.red, undefined)
  assert.equal(snapshot(ownerMessages).seats.black?.nickname, '房主')
  assert.equal(snapshot(ownerMessages).seats.black?.ready, false)
  await manager.handle(owner, {
    type: 'room-switch-seat',
    roomId: created.room.id,
    side: 'red',
    expectedRevision: snapshot(ownerMessages).revision,
    commandId: 'owner-switch-red',
  })
  await assert.rejects(
    () =>
      manager.handle(owner, {
        type: 'room-claim-seat',
        roomId: created.room.id,
        side: 'black',
        nickname: '房主',
        expectedRevision: snapshot(ownerMessages).revision,
        commandId: 'owner-seat-again',
      }),
    /已经占用一个席位/,
  )
  await manager.handle(applicant, {
    type: 'room-subscribe',
    roomId: created.room.id,
    nickname: '申请者',
  })
  await manager.handle(applicant, {
    type: 'room-seat-request',
    roomId: created.room.id,
    side: 'black',
    nickname: '申请者',
    expectedRevision: snapshot(applicantMessages).revision,
    commandId: 'apply',
  })
  const application = snapshot(ownerMessages).applications?.[0]
  assert.ok(application)
  await manager.handle(owner, {
    type: 'room-seat-approve',
    roomId: created.room.id,
    applicationId: application.id,
    accept: true,
    expectedRevision: snapshot(ownerMessages).revision,
    commandId: 'approve',
  })
  assert.equal(snapshot(applicantMessages).role, 'black')
  await assert.rejects(
    () =>
      manager.handle(owner, {
        type: 'room-switch-seat',
        roomId: created.room.id,
        side: 'black',
        expectedRevision: snapshot(ownerMessages).revision,
        commandId: 'switch-occupied',
      }),
    /已有棋手/,
  )

  await manager.handle(owner, {
    type: 'room-swap-request',
    roomId: created.room.id,
    expectedRevision: snapshot(ownerMessages).revision,
    commandId: 'swap-request',
  })
  await manager.handle(applicant, {
    type: 'room-swap-response',
    roomId: created.room.id,
    accept: true,
    expectedRevision: snapshot(applicantMessages).revision,
    commandId: 'swap-accept',
  })
  assert.equal(snapshot(ownerMessages).role, 'black')
  assert.equal(snapshot(applicantMessages).role, 'red')
  assert.equal(snapshot(ownerMessages).seats.red?.nickname, '申请者')
  assert.equal(snapshot(ownerMessages).seats.black?.nickname, '房主')

  manager.disconnect(owner)
  manager.disconnect(applicant)
})

test('disconnect adjudication waits behind an active command and cannot be overwritten by it', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-room-disconnect-queue-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new RoomRepository(directory)
  await repository.init()
  let resolveHint!: (move: string | null) => void
  let markHintStarted!: () => void
  const hintStarted = new Promise<void>((resolve) => {
    markHintStarted = resolve
  })
  const manager = new RoomManager(
    repository,
    async () => {
      markHintStarted()
      return new Promise<string | null>((resolve) => {
        resolveHint = resolve
      })
    },
    15,
  )
  const created = await manager.createRoom('串行掉线测试', 'xiangqi')
  const redMessages: unknown[] = [],
    blackMessages: unknown[] = []
  const red = socket(redMessages),
    black = socket(blackMessages)
  await manager.handle(red, {
    type: 'room-subscribe',
    roomId: created.room.id,
    token: created.ownerToken,
    nickname: '红',
  })
  await manager.handle(red, {
    type: 'room-claim-seat',
    roomId: created.room.id,
    side: 'red',
    nickname: '红',
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'queue-seat-red',
  })
  await manager.handle(black, { type: 'room-subscribe', roomId: created.room.id, nickname: '黑' })
  await manager.handle(black, {
    type: 'room-invite-seat',
    roomId: created.room.id,
    inviteToken: created.inviteToken,
    side: 'black',
    nickname: '黑',
    expectedRevision: snapshot(blackMessages).revision,
    commandId: 'queue-seat-black',
  })
  await manager.handle(red, {
    type: 'room-ready',
    roomId: created.room.id,
    ready: true,
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'queue-ready-red',
  })
  await manager.handle(black, {
    type: 'room-ready',
    roomId: created.room.id,
    ready: true,
    expectedRevision: snapshot(blackMessages).revision,
    commandId: 'queue-ready-black',
  })

  const hint = manager.handle(red, {
    type: 'room-hint',
    roomId: created.room.id,
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'slow-hint',
  })
  await hintStarted
  manager.disconnect(red)
  await new Promise((resolve) => setTimeout(resolve, 25))
  resolveHint('h2e2')
  await hint
  await manager.flush()

  assert.equal(repository.get(created.room.id)?.phase, 'finished')
  assert.equal(repository.get(created.room.id)?.statusReason, 'disconnect')
  assert.equal(snapshot(blackMessages).status, 'black-wins')
  manager.disconnect(black)
})

test('a waiting room closes when its owner disconnects before the game starts', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-room-start-disconnected-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new RoomRepository(directory)
  await repository.init()
  const manager = new RoomManager(repository, async () => null, 20)
  const created = await manager.createRoom('开局掉线测试', 'xiangqi')
  const redMessages: unknown[] = [],
    blackMessages: unknown[] = []
  const red = socket(redMessages),
    black = socket(blackMessages)
  await manager.handle(red, {
    type: 'room-subscribe',
    roomId: created.room.id,
    token: created.ownerToken,
    nickname: '红',
  })
  await manager.handle(red, {
    type: 'room-claim-seat',
    roomId: created.room.id,
    side: 'red',
    nickname: '红',
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'start-seat-red',
  })
  await manager.handle(black, { type: 'room-subscribe', roomId: created.room.id, nickname: '黑' })
  await manager.handle(black, {
    type: 'room-invite-seat',
    roomId: created.room.id,
    inviteToken: created.inviteToken,
    side: 'black',
    nickname: '黑',
    expectedRevision: snapshot(blackMessages).revision,
    commandId: 'start-seat-black',
  })
  await manager.handle(red, {
    type: 'room-ready',
    roomId: created.room.id,
    ready: true,
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'start-ready-red',
  })
  manager.disconnect(red)
  assert.ok(snapshot(blackMessages).ownerDisconnectDeadline)
  await assert.rejects(
    manager.handle(black, {
      type: 'room-ready',
      roomId: created.room.id,
      ready: true,
      expectedRevision: snapshot(blackMessages).revision,
      commandId: 'start-ready-black',
    }),
    /发起人已离线/,
  )
  assert.equal(
    manager.lobby().some((room) => room.id === created.room.id),
    false,
  )
  await new Promise((resolve) => setTimeout(resolve, 35))
  await manager.flush()
  assert.equal(repository.get(created.room.id), null)
  assert.equal(message(blackMessages, 'room-closed')?.reason, '发起人离线，对局已自动取消')
  manager.disconnect(black)
})

test('an owner token restores a waiting room before its disconnect deadline', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-room-owner-reconnect-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new RoomRepository(directory)
  await repository.init()
  const manager = new RoomManager(repository, async () => null, 30)
  const created = await manager.createRoom('发起人恢复测试', 'xiangqi')
  const firstMessages: unknown[] = [],
    reconnectMessages: unknown[] = []
  const first = socket(firstMessages),
    reconnect = socket(reconnectMessages)
  await manager.handle(first, {
    type: 'room-subscribe',
    roomId: created.room.id,
    token: created.ownerToken,
  })
  manager.disconnect(first)
  assert.equal(
    manager.lobby().some((room) => room.id === created.room.id),
    false,
  )
  await new Promise((resolve) => setTimeout(resolve, 10))
  await manager.handle(reconnect, {
    type: 'room-subscribe',
    roomId: created.room.id,
    token: created.ownerToken,
  })
  assert.equal(snapshot(reconnectMessages).ownerDisconnectDeadline, undefined)
  assert.equal(
    manager.lobby().some((room) => room.id === created.room.id),
    true,
  )
  await new Promise((resolve) => setTimeout(resolve, 35))
  await manager.flush()
  assert.ok(repository.get(created.room.id))
  manager.disconnect(reconnect)
  manager.dispose()
})

test('offline guest seats expire while an online owner keeps the waiting room alive', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-room-seat-expiry-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new RoomRepository(directory)
  await repository.init()
  const manager = new RoomManager(repository, async () => null, 20)
  const created = await manager.createRoom('席位释放测试', 'xiangqi')
  const ownerMessages: unknown[] = [],
    guestMessages: unknown[] = []
  const owner = socket(ownerMessages),
    guest = socket(guestMessages)
  await manager.handle(owner, {
    type: 'room-subscribe',
    roomId: created.room.id,
    token: created.ownerToken,
  })
  await manager.handle(owner, {
    type: 'room-claim-seat',
    roomId: created.room.id,
    side: 'red',
    expectedRevision: snapshot(ownerMessages).revision,
    commandId: 'seat-expiry-owner',
  })
  await manager.handle(guest, { type: 'room-subscribe', roomId: created.room.id })
  await manager.handle(guest, {
    type: 'room-invite-seat',
    roomId: created.room.id,
    inviteToken: created.inviteToken,
    side: 'black',
    expectedRevision: snapshot(guestMessages).revision,
    commandId: 'expiring-seat',
  })
  const guestToken = String(message(guestMessages, 'room-seat-token')?.token)
  await manager.handle(guest, {
    type: 'room-ready',
    roomId: created.room.id,
    ready: true,
    expectedRevision: snapshot(guestMessages).revision,
    commandId: 'seat-expiry-ready-guest',
  })
  manager.disconnect(guest)
  assert.ok(snapshot(ownerMessages).seatDisconnectDeadlines?.black)
  await assert.rejects(
    manager.handle(owner, {
      type: 'room-ready',
      roomId: created.room.id,
      ready: true,
      expectedRevision: snapshot(ownerMessages).revision,
      commandId: 'seat-expiry-ready-owner',
    }),
    /对方已离线/,
  )
  await new Promise((resolve) => setTimeout(resolve, 35))
  await manager.flush()
  assert.equal(repository.get(created.room.id)?.seats.black, undefined)
  assert.equal(
    manager.lobby().some((room) => room.id === created.room.id),
    true,
  )

  const staleMessages: unknown[] = [],
    stale = socket(staleMessages)
  await manager.handle(stale, {
    type: 'room-subscribe',
    roomId: created.room.id,
    token: guestToken,
  })
  assert.equal(snapshot(staleMessages).role, 'spectator')
  manager.disconnect(stale)
  manager.disconnect(owner)
  manager.dispose()
})

test('a playing room becomes an abandoned draw when both players remain offline', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-room-both-offline-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new RoomRepository(directory)
  await repository.init()
  const manager = new RoomManager(repository, async () => null, 20)
  const created = await manager.createRoom('双方掉线测试', 'xiangqi')
  const redMessages: unknown[] = [],
    blackMessages: unknown[] = [],
    spectatorMessages: unknown[] = []
  const red = socket(redMessages),
    black = socket(blackMessages),
    spectator = socket(spectatorMessages)
  await manager.handle(red, {
    type: 'room-subscribe',
    roomId: created.room.id,
    token: created.ownerToken,
  })
  await manager.handle(red, {
    type: 'room-claim-seat',
    roomId: created.room.id,
    side: 'red',
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'both-seat-red',
  })
  await manager.handle(black, { type: 'room-subscribe', roomId: created.room.id })
  await manager.handle(black, {
    type: 'room-invite-seat',
    roomId: created.room.id,
    inviteToken: created.inviteToken,
    side: 'black',
    expectedRevision: snapshot(blackMessages).revision,
    commandId: 'both-seat-black',
  })
  await manager.handle(red, {
    type: 'room-ready',
    roomId: created.room.id,
    ready: true,
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'both-ready-red',
  })
  await manager.handle(black, {
    type: 'room-ready',
    roomId: created.room.id,
    ready: true,
    expectedRevision: snapshot(blackMessages).revision,
    commandId: 'both-ready-black',
  })
  await manager.handle(spectator, { type: 'room-subscribe', roomId: created.room.id })
  manager.disconnect(red)
  manager.disconnect(black)
  assert.equal(snapshot(spectatorMessages).disconnect?.color, 'both')
  await new Promise((resolve) => setTimeout(resolve, 35))
  await manager.flush()
  assert.equal(snapshot(spectatorMessages).phase, 'finished')
  assert.equal(snapshot(spectatorMessages).status, 'draw')
  assert.equal(snapshot(spectatorMessages).statusReason, 'abandoned')
  manager.disconnect(spectator)
})

test('startup recovery removes ownerless waiting rooms after a bounded grace period', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-room-startup-recovery-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new RoomRepository(directory)
  await repository.init()
  const previous = new RoomManager(repository, async () => null)
  const created = await previous.createRoom('重启恢复测试', 'xiangqi')
  previous.dispose()

  const recovered = new RoomManager(repository, async () => null, 60_000, {
    startupRecoveryTimeoutMs: 20,
  })
  recovered.startPresenceRecovery()
  assert.equal(
    recovered.lobby().some((room) => room.id === created.room.id),
    false,
  )
  await new Promise((resolve) => setTimeout(resolve, 35))
  await recovered.flush()
  assert.equal(repository.get(created.room.id), null)
  recovered.dispose()
})

test('startup recovery finishes a playing room when neither player returns', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-playing-startup-recovery-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new RoomRepository(directory)
  await repository.init()
  const previous = new RoomManager(repository, async () => null)
  const created = await previous.createRoom('进行中恢复测试', 'xiangqi')
  const redMessages: unknown[] = [],
    blackMessages: unknown[] = []
  const red = socket(redMessages),
    black = socket(blackMessages)
  await previous.handle(red, {
    type: 'room-subscribe',
    roomId: created.room.id,
    token: created.ownerToken,
  })
  await previous.handle(red, {
    type: 'room-claim-seat',
    roomId: created.room.id,
    side: 'red',
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'startup-seat-red',
  })
  await previous.handle(black, { type: 'room-subscribe', roomId: created.room.id })
  await previous.handle(black, {
    type: 'room-invite-seat',
    roomId: created.room.id,
    inviteToken: created.inviteToken,
    side: 'black',
    expectedRevision: snapshot(blackMessages).revision,
    commandId: 'startup-seat-black',
  })
  await previous.handle(red, {
    type: 'room-ready',
    roomId: created.room.id,
    ready: true,
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'startup-ready-red',
  })
  await previous.handle(black, {
    type: 'room-ready',
    roomId: created.room.id,
    ready: true,
    expectedRevision: snapshot(blackMessages).revision,
    commandId: 'startup-ready-black',
  })
  previous.dispose()

  const recovered = new RoomManager(repository, async () => null, 60_000, {
    startupRecoveryTimeoutMs: 20,
  })
  recovered.startPresenceRecovery()
  await new Promise((resolve) => setTimeout(resolve, 35))
  await recovered.flush()
  assert.equal(repository.get(created.room.id)?.phase, 'finished')
  assert.equal(repository.get(created.room.id)?.status, 'draw')
  assert.equal(repository.get(created.room.id)?.statusReason, 'abandoned')
  recovered.dispose()
})

test('seat credentials can move devices and owners can manage waiting rooms', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-room-manage-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new RoomRepository(directory)
  await repository.init()
  const manager = new RoomManager(repository, async () => null)
  const created = await manager.createRoom('管理测试', 'xiangqi')
  const ownerMessages: unknown[] = [],
    guestMessages: unknown[] = [],
    restoredMessages: unknown[] = []
  const owner = socket(ownerMessages),
    guest = socket(guestMessages),
    restored = socket(restoredMessages)
  await manager.handle(owner, {
    type: 'room-subscribe',
    roomId: created.room.id,
    token: created.ownerToken,
  })
  await manager.handle(owner, {
    type: 'room-claim-seat',
    roomId: created.room.id,
    side: 'red',
    expectedRevision: snapshot(ownerMessages).revision,
    commandId: 'manage-owner',
  })
  await manager.handle(guest, { type: 'room-subscribe', roomId: created.room.id })
  await manager.handle(guest, {
    type: 'room-invite-seat',
    roomId: created.room.id,
    inviteToken: created.inviteToken,
    side: 'black',
    expectedRevision: snapshot(guestMessages).revision,
    commandId: 'manage-guest',
  })
  const guestToken = String(message(guestMessages, 'room-seat-token')?.token)
  assert.ok(guestToken)

  await manager.handle(restored, {
    type: 'room-subscribe',
    roomId: created.room.id,
    token: guestToken,
  })
  assert.equal(snapshot(restoredMessages).role, 'black')
  assert.equal(snapshot(guestMessages).role, 'spectator')
  await manager.handle(owner, {
    type: 'room-swap-request',
    roomId: created.room.id,
    expectedRevision: snapshot(ownerMessages).revision,
    commandId: 'manage-swap-request',
  })
  await manager.handle(restored, {
    type: 'room-swap-response',
    roomId: created.room.id,
    accept: true,
    expectedRevision: snapshot(restoredMessages).revision,
    commandId: 'manage-swap-accept',
  })
  assert.equal(snapshot(restoredMessages).role, 'red')
  assert.equal(snapshot(guestMessages).role, 'spectator')
  await manager.handle(restored, {
    type: 'room-leave-seat',
    roomId: created.room.id,
    expectedRevision: snapshot(restoredMessages).revision,
    commandId: 'manage-leave',
  })
  assert.equal(snapshot(ownerMessages).seats.red, undefined)

  await manager.handle(owner, {
    type: 'room-renew-invite',
    roomId: created.room.id,
    expectedRevision: snapshot(ownerMessages).revision,
    commandId: 'manage-invite',
  })
  assert.ok(message(ownerMessages, 'room-invite-token')?.inviteToken)
  await manager.handle(owner, {
    type: 'room-dissolve',
    roomId: created.room.id,
    expectedRevision: snapshot(ownerMessages).revision,
    commandId: 'manage-dissolve',
  })
  assert.equal(repository.get(created.room.id), null)
  assert.ok(message(guestMessages, 'room-closed'))
  manager.dispose()
})

test('room proposals are exclusive, cancellable, and expire automatically', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-room-proposals-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new RoomRepository(directory)
  await repository.init()
  const manager = new RoomManager(repository, async () => null, 60_000, { proposalTimeoutMs: 15 })
  const created = await manager.createRoom('协商测试', 'xiangqi')
  const redMessages: unknown[] = [],
    blackMessages: unknown[] = []
  const red = socket(redMessages),
    black = socket(blackMessages)
  await manager.handle(red, {
    type: 'room-subscribe',
    roomId: created.room.id,
    token: created.ownerToken,
  })
  await manager.handle(red, {
    type: 'room-claim-seat',
    roomId: created.room.id,
    side: 'red',
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'proposal-red',
  })
  await manager.handle(black, { type: 'room-subscribe', roomId: created.room.id })
  await manager.handle(black, {
    type: 'room-invite-seat',
    roomId: created.room.id,
    inviteToken: created.inviteToken,
    side: 'black',
    expectedRevision: snapshot(blackMessages).revision,
    commandId: 'proposal-black',
  })
  await manager.handle(red, {
    type: 'room-ready',
    roomId: created.room.id,
    ready: true,
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'proposal-ready-red',
  })
  await manager.handle(black, {
    type: 'room-ready',
    roomId: created.room.id,
    ready: true,
    expectedRevision: snapshot(blackMessages).revision,
    commandId: 'proposal-ready-black',
  })
  await manager.handle(red, {
    type: 'room-move',
    roomId: created.room.id,
    uci: 'h2e2',
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'proposal-move',
  })
  await manager.handle(red, {
    type: 'room-draw-offer',
    roomId: created.room.id,
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'proposal-draw',
  })
  await assert.rejects(
    () =>
      manager.handle(black, {
        type: 'room-draw-offer',
        roomId: created.room.id,
        expectedRevision: snapshot(blackMessages).revision,
        commandId: 'proposal-duplicate',
      }),
    /已有待处理/,
  )
  await assert.rejects(
    () =>
      manager.handle(red, {
        type: 'room-undo-request',
        roomId: created.room.id,
        expectedRevision: snapshot(redMessages).revision,
        commandId: 'proposal-other-kind',
      }),
    /已有待处理/,
  )
  await manager.handle(red, {
    type: 'room-proposal-cancel',
    roomId: created.room.id,
    kind: 'draw',
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'proposal-cancel',
  })
  assert.equal(snapshot(blackMessages).pendingDrawBy, undefined)
  await manager.handle(red, {
    type: 'room-draw-offer',
    roomId: created.room.id,
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'proposal-expire',
  })
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(snapshot(blackMessages).pendingDrawBy, undefined)
  manager.disconnect(red)
  manager.disconnect(black)
  manager.dispose()
})

test('cleanup expires idle rooms, abandons offline games, and later removes finished data', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-room-cleanup-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new RoomRepository(directory)
  await repository.init()
  const manager = new RoomManager(repository, async () => null, 60_000, {
    waitingTtlMs: 10,
    abandonedTtlMs: 10,
    finishedTtlMs: 10,
  })
  const waiting = await manager.createRoom('无人房间', 'xiangqi')
  await manager.cleanup(waiting.room.updatedAt + 11)
  assert.equal(repository.get(waiting.room.id), null)

  const playing = await manager.createRoom('离线对局', 'xiangqi')
  const redMessages: unknown[] = [],
    blackMessages: unknown[] = [],
    spectatorMessages: unknown[] = []
  const red = socket(redMessages),
    black = socket(blackMessages),
    spectator = socket(spectatorMessages)
  await manager.handle(red, {
    type: 'room-subscribe',
    roomId: playing.room.id,
    token: playing.ownerToken,
  })
  await manager.handle(red, {
    type: 'room-claim-seat',
    roomId: playing.room.id,
    side: 'red',
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'cleanup-red',
  })
  await manager.handle(black, { type: 'room-subscribe', roomId: playing.room.id })
  await manager.handle(black, {
    type: 'room-invite-seat',
    roomId: playing.room.id,
    inviteToken: playing.inviteToken,
    side: 'black',
    expectedRevision: snapshot(blackMessages).revision,
    commandId: 'cleanup-black',
  })
  await manager.handle(red, {
    type: 'room-ready',
    roomId: playing.room.id,
    ready: true,
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'cleanup-ready-red',
  })
  await manager.handle(black, {
    type: 'room-ready',
    roomId: playing.room.id,
    ready: true,
    expectedRevision: snapshot(blackMessages).revision,
    commandId: 'cleanup-ready-black',
  })
  await manager.handle(spectator, { type: 'room-subscribe', roomId: playing.room.id })
  manager.disconnect(red)
  manager.disconnect(black)
  await manager.cleanup(Date.now() + 20)
  assert.equal(repository.get(playing.room.id)?.statusReason, 'abandoned')
  assert.equal(snapshot(spectatorMessages).phase, 'finished')
  manager.disconnect(spectator)
  const finishedAt = repository.get(playing.room.id)!.finishedAt!
  await manager.cleanup(finishedAt + 11)
  assert.equal(repository.get(playing.room.id), null)
  manager.dispose()
})

test('resubscribing one socket updates connectivity in the previous room', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-room-resubscribe-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new RoomRepository(directory)
  await repository.init()
  const manager = new RoomManager(repository, async () => null, 60_000)
  const first = await manager.createRoom('原房间', 'xiangqi')
  const second = await manager.createRoom('新房间', 'xiangqi')
  const redMessages: unknown[] = [],
    blackMessages: unknown[] = []
  const red = socket(redMessages),
    black = socket(blackMessages)
  await manager.handle(red, {
    type: 'room-subscribe',
    roomId: first.room.id,
    token: first.ownerToken,
  })
  await manager.handle(red, {
    type: 'room-claim-seat',
    roomId: first.room.id,
    side: 'red',
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'resub-red',
  })
  await manager.handle(black, { type: 'room-subscribe', roomId: first.room.id })
  await manager.handle(black, {
    type: 'room-invite-seat',
    roomId: first.room.id,
    inviteToken: first.inviteToken,
    side: 'black',
    expectedRevision: snapshot(blackMessages).revision,
    commandId: 'resub-black',
  })
  await manager.handle(red, {
    type: 'room-ready',
    roomId: first.room.id,
    ready: true,
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'resub-ready-red',
  })
  await manager.handle(black, {
    type: 'room-ready',
    roomId: first.room.id,
    ready: true,
    expectedRevision: snapshot(blackMessages).revision,
    commandId: 'resub-ready-black',
  })
  await manager.handle(red, {
    type: 'room-subscribe',
    roomId: second.room.id,
    token: second.ownerToken,
  })
  assert.equal(snapshot(blackMessages).disconnect?.color, 'red')
  manager.disconnect(red)
  manager.disconnect(black)
  manager.dispose()
})

test('lifecycle cleanup is serialized behind active room commands', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-room-cleanup-queue-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new RoomRepository(directory)
  await repository.init()
  let releaseHint!: () => void
  let hintStarted!: () => void
  const started = new Promise<void>((resolve) => {
    hintStarted = resolve
  })
  const manager = new RoomManager(
    repository,
    async () => {
      hintStarted()
      await new Promise<void>((resolve) => {
        releaseHint = resolve
      })
      return 'h2e2'
    },
    60_000,
    { abandonedTtlMs: 1 },
  )
  const created = await manager.createRoom('清理串行测试', 'xiangqi')
  const redMessages: unknown[] = [],
    blackMessages: unknown[] = []
  const red = socket(redMessages),
    black = socket(blackMessages)
  await manager.handle(red, {
    type: 'room-subscribe',
    roomId: created.room.id,
    token: created.ownerToken,
  })
  await manager.handle(red, {
    type: 'room-claim-seat',
    roomId: created.room.id,
    side: 'red',
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'cleanup-queue-red',
  })
  await manager.handle(black, { type: 'room-subscribe', roomId: created.room.id })
  await manager.handle(black, {
    type: 'room-invite-seat',
    roomId: created.room.id,
    inviteToken: created.inviteToken,
    side: 'black',
    expectedRevision: snapshot(blackMessages).revision,
    commandId: 'cleanup-queue-black',
  })
  await manager.handle(red, {
    type: 'room-ready',
    roomId: created.room.id,
    ready: true,
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'cleanup-queue-ready-red',
  })
  await manager.handle(black, {
    type: 'room-ready',
    roomId: created.room.id,
    ready: true,
    expectedRevision: snapshot(blackMessages).revision,
    commandId: 'cleanup-queue-ready-black',
  })
  const hint = manager.handle(red, {
    type: 'room-hint',
    roomId: created.room.id,
    expectedRevision: snapshot(redMessages).revision,
    commandId: 'cleanup-queue-hint',
  })
  await started
  manager.disconnect(red)
  manager.disconnect(black)
  const cleanup = manager.cleanup(Date.now() + 10)
  releaseHint()
  await hint
  await cleanup
  await manager.flush()
  assert.equal(repository.get(created.room.id)?.statusReason, 'abandoned')
  assert.equal(repository.get(created.room.id)?.seats.red?.hintsUsed, 1)
  manager.dispose()
})
