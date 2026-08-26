import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeOnlineChat, onlineRoomUrl } from './model.js'
import type { OnlineChatMessage } from './types.js'

function message(id: string, sequence: number, content = id): OnlineChatMessage {
  return {
    id,
    sequence,
    authorUserId: 'user-id',
    nickname: '账号棋手',
    role: 'red',
    content,
    createdAt: '2026-08-25T00:00:00.000Z',
  }
}

test('online room URLs retain the game but discard one-time invitation capability', () => {
  const result = new URL(
    onlineRoomUrl(
      'https://chess.example.test/?online=1&game=xiangqi&invite=one-time-token',
      'match-id',
      'gomoku',
    ),
  )
  assert.equal(result.searchParams.get('online'), '1')
  assert.equal(result.searchParams.get('game'), 'gomoku')
  assert.equal(result.searchParams.get('match'), 'match-id')
  assert.equal(result.searchParams.has('invite'), false)
})

test('online chat acknowledgements are ordered, deduplicated and bounded', () => {
  const current = [message('second', 2), message('first', 1)]
  assert.deepEqual(
    mergeOnlineChat(current, message('second', 2, 'server-authoritative'), 2).map((item) => [
      item.id,
      item.content,
    ]),
    [
      ['first', 'first'],
      ['second', 'server-authoritative'],
    ],
  )
  assert.deepEqual(
    mergeOnlineChat(current, message('third', 3), 2).map((item) => item.id),
    ['second', 'third'],
  )
})
