import assert from 'node:assert/strict'
import test from 'node:test'
import { getLanChatContentLength, getLanChatLineCount, getLanChatRole, mergeLanChatMessage, parseLanRoomSensitiveWords } from './chat.js'
import { LanChatMessage } from './types.js'

function message(sequence: number, id = String(sequence)): LanChatMessage {
  return { id, sequence, authorId: 'a'.repeat(64), nickname: '棋友', role: 'spectator', isOwner: false, content: `消息 ${sequence}`, createdAt: sequence }
}

test('LAN chat messages are ordered, deduplicated, and bounded', () => {
  let messages: LanChatMessage[] = []
  for (let sequence = 105; sequence >= 1; sequence--) messages = mergeLanChatMessage(messages, message(sequence))
  assert.equal(messages.length, 100)
  assert.equal(messages[0].sequence, 6)
  assert.equal(messages[99].sequence, 105)
  assert.equal(mergeLanChatMessage(messages, message(105)), messages)
})

test('LAN chat role labels preserve owner and seat identity', () => {
  assert.equal(getLanChatRole({ ...message(1), role: 'owner', isOwner: true }), '房主')
  assert.equal(getLanChatRole({ ...message(1), role: 'red', isOwner: true }), '房主·红方')
  assert.equal(getLanChatRole({ ...message(1), role: 'black' }), '黑方')
})

test('LAN chat character counting treats emoji as one character', () => {
  assert.equal(getLanChatContentLength('你好🙂'), 3)
})

test('LAN chat line counting matches the server limit across newline formats', () => {
  assert.equal(getLanChatLineCount('第一行\n第二行\n第三行\n第四行'), 4)
  assert.equal(getLanChatLineCount('一\r\n二\r三\n四\n五'), 5)
})

test('room sensitive words support common separators and deduplication', () => {
  assert.deepEqual(parseLanRoomSensitiveWords('广告，诈骗\n广告、 恶意词 '), ['广告', '诈骗', '恶意词'])
})
