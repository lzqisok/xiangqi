import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deleteStudyPositions,
  duplicateStudyPosition,
  exportStudyPositionsJson,
  importStudyPositionsJson,
  renameStudyPosition,
  saveStudyPosition,
} from './storage'
import { createVariationTree } from '../variations/tree'

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
  mockStudies([])
  const result = importStudyPositionsJson(
    JSON.stringify({
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
    }),
  )

  assert.equal(result.length, 1)
  assert.equal(result[0].id, 'study-new')
  assert.equal(result[0].moves.length, 1)
})

test('study JSON v3 preserves annotated trees and rejects disconnected nodes', () => {
  const valid = makeStudy('study-tree', 1)
  valid.variationTree = createVariationTree(valid.initialFen, valid.moves, 0, 1)
  valid.variationTree.nodes['variation-node-1'].annotations = [
    {
      id: 'arrow-1',
      type: 'arrow',
      color: 'red',
      from: { row: 9, col: 7 },
      to: { row: 7, col: 7 },
    },
  ]
  mockStudies([valid])
  assert.equal(JSON.parse(exportStudyPositionsJson()).version, 4)
  assert.equal(
    JSON.parse(exportStudyPositionsJson()).studies[0].variationTree.nodes['variation-node-1']
      .annotations.length,
    1,
  )

  const invalid = structuredClone(valid)
  invalid.id = 'study-invalid-tree'
  invalid.variationTree!.nodes.orphan = {
    ...invalid.variationTree!.nodes['variation-node-1'],
    id: 'orphan',
  }
  const imported = importStudyPositionsJson(JSON.stringify({ version: 2, studies: [invalid] }))
  assert.deepEqual(
    imported.map((study) => study.id),
    ['study-tree'],
  )

  const invalidAnnotation = structuredClone(valid)
  invalidAnnotation.id = 'study-invalid-annotation'
  invalidAnnotation.variationTree!.nodes['variation-node-1'].annotations = [
    {
      id: 'bad-arrow',
      type: 'arrow',
      color: 'red',
      from: { row: 9, col: 7 },
      to: { row: 9, col: 7 },
    },
  ]
  assert.deepEqual(
    importStudyPositionsJson(JSON.stringify({ version: 3, studies: [invalidAnnotation] })).map(
      (study) => study.id,
    ),
    ['study-tree'],
  )
})

test('study JSON v4 preserves node analysis and rejects invalid analysis', () => {
  const valid = makeStudy('study-analysis', 1)
  valid.variationTree = createVariationTree(valid.initialFen, valid.moves, 0, 1)
  valid.variationTree.nodes['variation-node-1'].analysis = {
    complete: true,
    score: 25,
    depth: 12,
    bestMove: 'h2e2',
    pv: ['h2e2', 'h7e7'],
    searchLimit: { searchMode: 'depth', searchDepth: 12 },
    engineThreads: 4,
    engineHashMb: 128,
    updatedAt: 3,
  }
  mockStudies([valid])

  const exported = JSON.parse(exportStudyPositionsJson())
  assert.equal(exported.version, 4)
  assert.equal(exported.studies[0].variationTree.nodes['variation-node-1'].analysis.score, 25)
  assert.equal(exported.studies[0].variationTree.nodes['variation-node-1'].analysis.complete, true)

  const invalid = structuredClone(valid)
  invalid.id = 'study-invalid-analysis'
  invalid.variationTree!.nodes['variation-node-1'].analysis = { score: 'bad' }
  assert.deepEqual(
    importStudyPositionsJson(JSON.stringify({ version: 4, studies: [invalid] })).map(
      (study) => study.id,
    ),
    ['study-analysis'],
  )

  const invalidLimit = structuredClone(valid)
  invalidLimit.id = 'study-invalid-limit'
  invalidLimit.variationTree!.nodes['variation-node-1'].analysis = {
    score: 25,
    depth: 12,
    searchLimit: { searchMode: 'foo' },
    updatedAt: 3,
  }
  assert.deepEqual(
    importStudyPositionsJson(JSON.stringify({ version: 4, studies: [invalidLimit] })).map(
      (study) => study.id,
    ),
    ['study-analysis'],
  )
})

test('importStudyPositionsJson accepts v2, v3 and v4 exports together', () => {
  mockStudies([])

  const v2 = makeStudy('study-v2', 1)
  v2.variationTree = undefined
  v2.analysisPoints = [{ moveIndex: -1, evaluation: 5, depth: 8 }]

  const v3 = makeStudy('study-v3', 2)
  v3.variationTree = createVariationTree(v3.initialFen, v3.moves, 0, 2)
  v3.variationTree.nodes['variation-node-1'].annotations = [
    {
      id: 'circle-1',
      type: 'circle',
      color: 'blue',
      from: { row: 7, col: 7 },
    },
  ]

  const v4 = makeStudy('study-v4', 3)
  v4.variationTree = createVariationTree(v4.initialFen, v4.moves, 0, 3)
  v4.variationTree.nodes['variation-node-1'].analysis = {
    score: 25,
    depth: 12,
    bestMove: 'h2e2',
    searchLimit: { searchMode: 'depth', searchDepth: 12 },
    engineThreads: 4,
    engineHashMb: 128,
    updatedAt: 3,
  }

  const result = importStudyPositionsJson(JSON.stringify({ version: 4, studies: [v2, v3, v4] }))

  assert.deepEqual(result.map((study) => study.id).sort(), ['study-v2', 'study-v3', 'study-v4'])
  const v3Study = result.find((study) => study.id === 'study-v3')!
  assert.equal(v3Study.variationTree!.nodes['variation-node-1'].annotations?.length, 1)
  const v4Study = result.find((study) => study.id === 'study-v4')!
  assert.equal(v4Study.variationTree!.nodes['variation-node-1'].analysis?.score, 25)
  const v2Study = result.find((study) => study.id === 'study-v2')!
  assert.equal(v2Study.variationTree, undefined)
  assert.equal(v2Study.analysisPoints[0].moveIndex, -1)
})

test('deleteStudyPositions removes multiple selected studies', () => {
  mockStudies([makeStudy('study-a', 1), makeStudy('study-b', 2), makeStudy('study-c', 3)])

  const result = deleteStudyPositions(['study-a', 'study-c'])

  assert.deepEqual(
    result.map((study) => study.id),
    ['study-b'],
  )
})

test('renameStudyPosition trims names and preserves blank names', () => {
  mockStudies([makeStudy('study-a', 1)])

  const renamed = renameStudyPosition('study-a', '  新名称  ')
  assert.equal(renamed[0].name, '新名称')

  const unchanged = renameStudyPosition('study-a', '   ')
  assert.equal(unchanged[0].name, '新名称')
})

test('duplicateStudyPosition copies a study with a new id and name', () => {
  const source = makeStudy('study-a', 1)
  source.variationTree = createVariationTree(source.initialFen, source.moves, 0, 1)
  source.variationTree.nodes['variation-node-1'].annotations = [
    {
      id: 'circle-1',
      type: 'circle',
      color: 'blue',
      from: { row: 7, col: 7 },
    },
  ]
  source.variationTree.nodes['variation-node-1'].analysis = {
    complete: true,
    score: 32,
    depth: 16,
    updatedAt: 2,
  }
  mockStudies([source])

  const result = duplicateStudyPosition('study-a')

  assert.equal(result.length, 2)
  assert.notEqual(result[0].id, 'study-a')
  assert.equal(result[0].name, '研究 study-a 副本')
  assert.equal(result[0].moves.length, 1)
  assert.deepEqual(result[0].variationTree, source.variationTree)
  assert.notEqual(result[0].variationTree, source.variationTree)
  assert.notEqual(
    result[0].variationTree!.nodes['variation-node-1'].annotations,
    source.variationTree.nodes['variation-node-1'].annotations,
  )
  assert.deepEqual(
    result[0].variationTree!.nodes['variation-node-1'].analysis,
    source.variationTree.nodes['variation-node-1'].analysis,
  )
  assert.notEqual(
    result[0].variationTree!.nodes['variation-node-1'].analysis,
    source.variationTree.nodes['variation-node-1'].analysis,
  )
  assert.equal(result[1].id, 'study-a')
})

test('saveStudyPosition updates an existing study without changing its creation time', () => {
  mockStudies([makeStudy('study-a', 1)])

  const result = saveStudyPosition({
    ...makeStudy('study-a', 99),
    currentMoveIndex: -1,
  })

  assert.equal(result.length, 1)
  assert.equal(result[0].id, 'study-a')
  assert.equal(result[0].createdAt, 1)
  assert.equal(result[0].currentMoveIndex, -1)
  assert.equal(result[0].updatedAt >= result[0].createdAt, true)
})

function makeStudy(id: string, updatedAt: number) {
  return {
    id,
    name: `研究 ${id}`,
    initialFen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',
    moves: [MOVE],
    currentMoveIndex: 0,
    analysisPoints: [] as { moveIndex: number; evaluation: number; depth: number }[],
    createdAt: updatedAt,
    updatedAt,
    variationTree: undefined as ReturnType<typeof createVariationTree> | undefined,
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
