import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeSolution, normalizeTags, parseTags } from './storage'

test('normalizeTags trims, deduplicates, and caps tags', () => {
  assert.deepEqual(
    normalizeTags([' 杀法 ', '守和', '杀法', '', '车', '炮', '兵', '马', '相', '仕']),
    ['杀法', '守和', '车', '炮', '兵', '马', '相', '仕'],
  )
})

test('parseTags supports Chinese and ASCII separators', () => {
  assert.deepEqual(parseTags('杀法，守和, 车炮兵、三步杀'), ['杀法', '守和', '车炮兵', '三步杀'])
})

test('normalizeSolution keeps only UCI moves', () => {
  assert.deepEqual(normalizeSolution([' h2e2 ', 'bad', 'h9g7', 'a10a9']), ['h2e2', 'h9g7'])
})
