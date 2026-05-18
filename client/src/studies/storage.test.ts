import assert from 'node:assert/strict'
import test from 'node:test'
import { deleteStudyPositions, duplicateStudyPosition, importStudyPositionsJson, renameStudyPosition } from './storage'

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

test('deleteStudyPositions removes multiple selected studies', () => {
  mockStudies([
    makeStudy('study-a', 1),
    makeStudy('study-b', 2),
    makeStudy('study-c', 3),
  ])

  const result = deleteStudyPositions(['study-a', 'study-c'])

  assert.deepEqual(result.map(study => study.id), ['study-b'])
})

test('renameStudyPosition trims names and preserves blank names', () => {
  mockStudies([makeStudy('study-a', 1)])

  const renamed = renameStudyPosition('study-a', '  新名称  ')
  assert.equal(renamed[0].name, '新名称')

  const unchanged = renameStudyPosition('study-a', '   ')
  assert.equal(unchanged[0].name, '新名称')
})

test('duplicateStudyPosition copies a study with a new id and name', () => {
  mockStudies([makeStudy('study-a', 1)])

  const result = duplicateStudyPosition('study-a')

  assert.equal(result.length, 2)
  assert.notEqual(result[0].id, 'study-a')
  assert.equal(result[0].name, '研究 study-a 副本')
  assert.equal(result[0].moves.length, 1)
  assert.equal(result[1].id, 'study-a')
})

function makeStudy(id: string, updatedAt: number) {
  return {
    id,
    name: `研究 ${id}`,
    initialFen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',
    moves: [MOVE],
    currentMoveIndex: 0,
    analysisPoints: [],
    createdAt: updatedAt,
    updatedAt,
  }
}

function mockStudies(studies: ReturnType<typeof makeStudy>[]) {
  const data = new Map<string, string>()
  data.set('xiangqi.study-positions.v1', JSON.stringify(studies))
  globalThis.window = {
    localStorage: {
      getItem: (key: string) => data.get(key) || null,
      setItem: (key: string, value: string) => {
        data.set(key, value)
      },
    },
  } as unknown as Window & typeof globalThis
}
