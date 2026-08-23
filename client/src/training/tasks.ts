import { MoveReview } from '../analysis/moveReview'
import { getPieceDisplayName, uciToMove } from '../engine/notation'
import { parseFen } from '../engine/board'
import {
  TrainingAttemptResult,
  TrainingTask,
  TrainingTaskSource,
  TrainingTaskStatus,
} from '../types'

export const TRAINING_PASS_LOSS_THRESHOLD = 100

export interface TrainingEvaluation {
  passed: boolean
  result: TrainingAttemptResult
  method: 'recommended' | 'engine' | 'fallback'
  loss?: number
}

export function buildTrainingTask(
  review: MoveReview,
  source: TrainingTaskSource,
  now = Date.now(),
  id = `training-${now}-${Math.random().toString(36).slice(2, 9)}`,
): TrainingTask | null {
  if (review.category !== 'mistake' && review.category !== 'blunder') return null
  return {
    id,
    positionFen: review.positionFen,
    mover: review.mover,
    playedMove: review.playedMove,
    playedNotation: review.playedNotation,
    recommendedMove: review.bestMove,
    recommendedNotation: review.recommendedNotation,
    recommendedLine: review.recommendedLine,
    beforeEvaluation: review.beforeEvaluation,
    category: review.category,
    source: { ...source, nodeId: review.nodeId },
    status: 'unseen',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  }
}

export function trainingTaskDedupeKey(task: TrainingTask): string {
  if (task.source.type !== 'snapshot' && task.source.id) {
    return `${task.source.type}:${task.source.id}:${task.source.nodeId}`
  }
  return `snapshot:${task.positionFen}:${task.recommendedMove}`
}

export function evaluateTrainingAttempt(
  task: TrainingTask,
  attemptedMove: string,
  afterEvaluation?: number,
  threshold = TRAINING_PASS_LOSS_THRESHOLD,
): TrainingEvaluation {
  if (attemptedMove === task.recommendedMove) {
    return { passed: true, result: 'passed', method: 'recommended', loss: 0 }
  }
  if (Number.isFinite(afterEvaluation)) {
    const loss = Math.max(
      0,
      Math.round(
        task.mover === 'red'
          ? task.beforeEvaluation - afterEvaluation!
          : afterEvaluation! - task.beforeEvaluation,
      ),
    )
    const passed = loss <= threshold
    return { passed, result: passed ? 'passed' : 'failed', method: 'engine', loss }
  }
  return { passed: false, result: 'failed', method: 'fallback' }
}

export function applyTrainingAttempt(
  task: TrainingTask,
  evaluation: TrainingEvaluation,
  now = Date.now(),
): TrainingTask {
  return {
    ...task,
    status: evaluation.passed ? 'mastered' : 'review',
    attempts: task.attempts + 1,
    lastResult: evaluation.result,
    lastPracticedAt: now,
    updatedAt: now,
  }
}

export function getTrainingHint(task: TrainingTask, level: number): string {
  if (level <= 0) return ''
  if (level >= 3) {
    const line = task.recommendedLine.length
      ? task.recommendedLine.join(' ')
      : task.recommendedNotation
    return `推荐变化：${line}`
  }

  try {
    const { from, to } = uciToMove(task.recommendedMove)
    if (level === 1) {
      const rowDelta = to.row - from.row
      const isForward = task.mover === 'red' ? rowDelta < 0 : rowDelta > 0
      const direction = rowDelta === 0 ? '横向调动' : isForward ? '向前推进' : '回撤调整'
      return `方向提示：优先考虑${direction}。`
    }
    const { board } = parseFen(task.positionFen)
    const piece = board[from.row]?.[from.col]
    return piece
      ? `候选棋子：考虑移动${getPieceDisplayName(piece)}。`
      : '候选棋子：从当前可动棋子中寻找更积极的一着。'
  } catch {
    return level === 1
      ? '方向提示：先比较将军、吃子和改善子力位置的着法。'
      : '候选棋子：从当前可动棋子中寻找更积极的一着。'
  }
}

export const TRAINING_STATUS_LABELS: Record<TrainingTaskStatus, string> = {
  unseen: '未练',
  review: '待复习',
  mastered: '已掌握',
}
