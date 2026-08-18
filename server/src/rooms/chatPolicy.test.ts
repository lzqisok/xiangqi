import assert from 'node:assert/strict'
import test from 'node:test'
import { containsSensitiveWord, normalizeRoomSensitiveWords } from './chatPolicy.js'

test('chat sensitive words normalize separators, case, and full-width text', () => {
  assert.equal(containsSensitiveWord('请看坏_词', ['坏词']), true)
  assert.equal(containsSensitiveWord('ＡＤＶＥＲＴ', ['advert']), true)
  assert.equal(containsSensitiveWord('这是正常交流', ['坏词']), false)
  assert.equal(containsSensitiveWord('赌 博 平台', []), true)
})

test('room sensitive words are trimmed, deduplicated, and bounded', () => {
  assert.deepEqual(normalizeRoomSensitiveWords([' 坏词 ', '坏词', 'Advert', 'advert']), [
    '坏词',
    'Advert',
  ])
  assert.throws(
    () => normalizeRoomSensitiveWords(Array.from({ length: 21 }, (_, index) => `词${index}`)),
    /最多设置/,
  )
  assert.throws(() => normalizeRoomSensitiveWords(['字'.repeat(21)]), /单个敏感词/)
})
