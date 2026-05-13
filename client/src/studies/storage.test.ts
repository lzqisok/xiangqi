import assert from 'node:assert/strict'
import test from 'node:test'
import { importStudyPositionsJson } from './storage'

const MOVE = {
  move: {
    from: { row: 9, col: 7 },
    to: { row: 7, col: 7 },
    piece: { type: 'c', color: 'red' },
  },
  notation: '炮二进二',
  fen: 'rnbakabnr/9/1c5C1/p1p1p1p1p/9/9/P1P1P1P1P/9/9/RNBAKABNR b - - 1 1',
}

test('importStudyPositionsJson imports wrapped studies and filters invalid entries', () => {
  const result = importStudyPositionsJson(JSON.stringify({
    studies: [
      {
        id: 'study-new',
        name: '研究一',
        initialFen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',
        moves: [MOVE],
        currentMoveIndex: 0,
        analysisPoints: [],
        createdAt: 1,
        updatedAt: 2,
      },
      { id: 'bad' },
      {
        id: 'bad-moves',
        name: '坏走法',
        initialFen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',
        moves: [{}],
        currentMoveIndex: 0,
        analysisPoints: [],
        createdAt: 1,
        updatedAt: 3,
      },
    ],
  }))

  assert.equal(result.length, 1)
  assert.equal(result[0].id, 'study-new')
  assert.equal(result[0].moves.length, 1)
})
