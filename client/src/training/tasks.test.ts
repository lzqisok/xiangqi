import assert from 'node:assert/strict'
import test from 'node:test'
import { INITIAL_FEN } from '../engine/board.js'
import { MoveReview } from '../analysis/moveReview.js'
import {
  applyTrainingAttempt,
  buildTrainingTask,
  evaluateTrainingAttempt,
  getTrainingHint,
  trainingTaskDedupeKey,
} from './tasks.js'

const REVIEW: MoveReview = {
  nodeId: 'variation-root',
  moveIndex: 0,
  mover: 'red',
  positionFen: INITIAL_FEN,
  playedMove: 'h2h3',
  playedNotation: '炮二进一',
  category: 'mistake',
  loss: 120,
  beforeEvaluation: 40,
  afterEvaluation: -80,
  bestMove: 'h2e2',
  recommendedNotation: '炮二平五',
  recommendedLine: ['炮二平五', '砲8平5'],
}

test('training task keeps source node identity and deduplicates by source node', () => {
  const task = buildTrainingTask(
    REVIEW,
    { type: 'study', id: 'study-1', name: '开局研究', nodeId: 'ignored' },
    10,
    'task-1',
  )!

  assert.equal(task.source.nodeId, 'variation-root')
  assert.equal(task.status, 'unseen')
  assert.equal(trainingTaskDedupeKey(task), 'study:study-1:variation-root')
})

test('training evaluation accepts the recommendation or an engine-approved alternative', () => {
  const task = buildTrainingTask(
    REVIEW,
    { type: 'snapshot', name: '临时复盘', nodeId: 'ignored' },
    10,
    'task-1',
  )!

  assert.deepEqual(evaluateTrainingAttempt(task, 'h2e2'), {
    passed: true,
    result: 'passed',
    method: 'recommended',
    loss: 0,
  })
  assert.equal(evaluateTrainingAttempt(task, 'b2e2', -20).passed, true)
  assert.equal(evaluateTrainingAttempt(task, 'b2e2', -80).passed, false)
  assert.equal(evaluateTrainingAttempt(task, 'b2e2').method, 'fallback')
})

test('black training loss is measured from the black movers perspective', () => {
  const task = buildTrainingTask(
    { ...REVIEW, mover: 'black', beforeEvaluation: -30 },
    { type: 'snapshot', name: '临时复盘', nodeId: 'ignored' },
    10,
    'task-1',
  )!

  assert.equal(evaluateTrainingAttempt(task, 'b2e2', 20).loss, 50)
  assert.equal(evaluateTrainingAttempt(task, 'b2e2', 90).loss, 120)
})

test('applying attempts updates queue state and layered hints hide the answer initially', () => {
  const task = buildTrainingTask(
    REVIEW,
    { type: 'snapshot', name: '临时复盘', nodeId: 'ignored' },
    10,
    'task-1',
  )!

  assert.equal(getTrainingHint(task, 0), '')
  assert.match(getTrainingHint(task, 1), /方向提示/)
  assert.match(getTrainingHint(task, 2), /候选棋子.*炮/)
  assert.equal(getTrainingHint(task, 3), '推荐变化：炮二平五 砲8平5')

  const failed = applyTrainingAttempt(task, evaluateTrainingAttempt(task, 'b2e2'), 20)
  assert.equal(failed.status, 'review')
  assert.equal(failed.attempts, 1)
  const passed = applyTrainingAttempt(failed, evaluateTrainingAttempt(task, 'h2e2'), 30)
  assert.equal(passed.status, 'mastered')
  assert.equal(passed.attempts, 2)
})
