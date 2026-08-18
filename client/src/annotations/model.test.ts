import assert from 'node:assert/strict'
import test from 'node:test'
import { createBoardAnnotation, formatAnnotation } from './model.js'

test('createBoardAnnotation validates arrow endpoints and normalizes circles', () => {
  assert.equal(createBoardAnnotation('arrow', 'red', { row: 0, col: 0 }, { row: 0, col: 0 }), null)
  assert.equal(createBoardAnnotation('arrow', 'red', { row: -1, col: 0 }, { row: 1, col: 0 }), null)
  assert.deepEqual(createBoardAnnotation('circle', 'blue', { row: 4, col: 5 }, { row: 8, col: 8 }, 'circle-1'), {
    id: 'circle-1',
    type: 'circle',
    color: 'blue',
    from: { row: 4, col: 5 },
  })
})

test('formatAnnotation exposes type, color, and coordinates without relying on canvas color', () => {
  const annotation = createBoardAnnotation('arrow', 'green', { row: 9, col: 7 }, { row: 7, col: 7 }, 'arrow-1')!
  assert.equal(formatAnnotation(annotation), '绿色箭头，10 行 8 列至 8 行 8 列')
})
