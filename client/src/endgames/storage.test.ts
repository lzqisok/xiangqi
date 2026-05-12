import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeTags, parseTags } from './storage'

test('normalizeTags trims, deduplicates, and caps tags', () => {
  assert.deepEqual(
    normalizeTags([' 杀法 ', '守和', '杀法', '', '车', '炮', '兵', '马', '相', '仕']),
    ['杀法', '守和', '车', '炮', '兵', '马', '相', '仕'],
  )
})

test('parseTags supports Chinese and ASCII separators', () => {
  assert.deepEqual(parseTags('杀法，守和, 车炮兵、三步杀'), ['杀法', '守和', '车炮兵', '三步杀'])
})
