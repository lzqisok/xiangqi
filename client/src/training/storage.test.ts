import assert from 'node:assert/strict'
import test from 'node:test'
import { INITIAL_FEN } from '../engine/board.js'
import { TrainingTask } from '../types.js'
import {
  deleteTrainingTasks,
  exportTrainingTasksJson,
  importTrainingTasksJson,
  loadTrainingTasks,
  updateTrainingTaskAttempt,
  upsertTrainingTask,
} from './storage.js'

test('adding the same study node updates content without resetting practice progress', () => {
  mockTasks([makeTask('task-old', 1)])
  const refreshed = {
    ...makeTask('task-new', 10),
    recommendedMove: 'b2e2',
    recommendedNotation: '炮八平五',
    status: 'unseen' as const,
    attempts: 0,
  }

  const result = upsertTrainingTask(refreshed)

  assert.equal(result.length, 1)
  assert.equal(result[0].id, 'task-old')
  assert.equal(result[0].recommendedMove, 'b2e2')
  assert.equal(result[0].attempts, 2)
  assert.equal(result[0].status, 'review')
})

test('attempt result immediately updates queue status and metrics', () => {
  mockTasks([makeTask('task-1', 1)])

  const result = updateTrainingTaskAttempt(
    'task-1',
    { passed: true, result: 'passed', method: 'recommended', loss: 0 },
    20,
  )

  assert.equal(result[0].status, 'mastered')
  assert.equal(result[0].attempts, 3)
  assert.equal(result[0].lastResult, 'passed')
  assert.equal(result[0].lastPracticedAt, 20)
})

test('training JSON backup filters invalid entries and deduplicates source nodes', () => {
  mockTasks([makeTask('task-current', 5)])
  const imported = { ...makeTask('task-imported', 9), attempts: 4 }
  const malformedPosition = { ...makeTask('task-bad-fen', 10), positionFen: 'not-a-fen' }
  const malformedMove = { ...makeTask('task-bad-move', 11), recommendedMove: 'bad' }

  const result = importTrainingTasksJson(
    JSON.stringify({
      version: 1,
      tasks: [imported, malformedPosition, malformedMove, { id: 'invalid' }],
    }),
  )

  assert.equal(result.length, 1)
  assert.equal(result[0].id, 'task-current')
  assert.equal(result[0].attempts, 4)
  assert.equal(JSON.parse(exportTrainingTasksJson()).version, 1)
})

test('training tasks support batch deletion and malformed storage fallback', () => {
  mockTasks([
    makeTask('task-a', 1),
    {
      ...makeTask('task-b', 2),
      source: { type: 'game', id: 'game-1', name: '对局', nodeId: 'node-b' },
    },
  ])
  assert.deepEqual(
    deleteTrainingTasks(['task-a']).map((item) => item.id),
    ['task-b'],
  )

  const data = new Map<string, string>([['xiangqi.training-tasks.v1', '{']])
  installStorage(data)
  assert.deepEqual(loadTrainingTasks(), [])
})

function makeTask(id: string, updatedAt: number): TrainingTask {
  return {
    id,
    positionFen: INITIAL_FEN,
    mover: 'red',
    playedMove: 'h2h3',
    playedNotation: '炮二进一',
    recommendedMove: 'h2e2',
    recommendedNotation: '炮二平五',
    recommendedLine: ['炮二平五'],
    beforeEvaluation: 40,
    category: 'mistake',
    source: { type: 'study', id: 'study-1', name: '研究一', nodeId: 'variation-root' },
    status: 'review',
    attempts: 2,
    lastResult: 'failed',
    lastPracticedAt: updatedAt,
    createdAt: 1,
    updatedAt,
  }
}

function installStorage(data: Map<string, string>) {
  globalThis.window = {
    localStorage: {
      getItem: (key: string) => data.get(key) || null,
      setItem: (key: string, value: string) => data.set(key, value),
    },
  } as unknown as Window & typeof globalThis
}

function mockTasks(tasks: TrainingTask[]) {
  const data = new Map<string, string>()
  data.set('xiangqi.training-tasks.v1', JSON.stringify(tasks))
  installStorage(data)
}
