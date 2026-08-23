import { TrainingEvaluation, applyTrainingAttempt, trainingTaskDedupeKey } from './tasks'
import { TrainingTask } from '../types'
import { validateFenPosition } from '../engine/validation'

const STORAGE_KEY = 'xiangqi.training-tasks.v1'
const MAX_TRAINING_TASKS = 1000
const UCI_MOVE_PATTERN = /^[a-i][0-9][a-i][0-9]$/

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isValidTrainingTask(value: unknown): value is TrainingTask {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  const source = item.source as Record<string, unknown> | undefined
  return (
    typeof item.id === 'string' &&
    typeof item.positionFen === 'string' &&
    validateFenPosition(item.positionFen).ok &&
    (item.mover === 'red' || item.mover === 'black') &&
    typeof item.playedMove === 'string' &&
    UCI_MOVE_PATTERN.test(item.playedMove) &&
    typeof item.playedNotation === 'string' &&
    typeof item.recommendedMove === 'string' &&
    UCI_MOVE_PATTERN.test(item.recommendedMove) &&
    typeof item.recommendedNotation === 'string' &&
    Array.isArray(item.recommendedLine) &&
    item.recommendedLine.every((entry) => typeof entry === 'string') &&
    isFiniteNumber(item.beforeEvaluation) &&
    (item.category === 'mistake' || item.category === 'blunder') &&
    !!source &&
    (source.type === 'game' || source.type === 'study' || source.type === 'snapshot') &&
    (source.id === undefined || typeof source.id === 'string') &&
    typeof source.name === 'string' &&
    typeof source.nodeId === 'string' &&
    (item.status === 'unseen' || item.status === 'review' || item.status === 'mastered') &&
    Number.isInteger(item.attempts) &&
    (item.attempts as number) >= 0 &&
    (item.lastResult === undefined ||
      item.lastResult === 'passed' ||
      item.lastResult === 'failed') &&
    (item.lastPracticedAt === undefined || isFiniteNumber(item.lastPracticedAt)) &&
    isFiniteNumber(item.createdAt) &&
    isFiniteNumber(item.updatedAt)
  )
}

export function loadTrainingTasks(): TrainingTask[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter(isValidTrainingTask).slice(0, MAX_TRAINING_TASKS)
      : []
  } catch {
    return []
  }
}

export function saveTrainingTasks(tasks: TrainingTask[]): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks.slice(0, MAX_TRAINING_TASKS)))
}

function mergeTaskProgress(preferred: TrainingTask, other: TrainingTask): TrainingTask {
  const latestPractice = Math.max(preferred.lastPracticedAt || 0, other.lastPracticedAt || 0)
  const progressSource =
    (other.lastPracticedAt || 0) > (preferred.lastPracticedAt || 0) ? other : preferred
  return {
    ...preferred,
    id: other.id,
    status: progressSource.status,
    attempts: Math.max(preferred.attempts, other.attempts),
    lastResult: progressSource.lastResult,
    lastPracticedAt: latestPractice || undefined,
    createdAt: Math.min(preferred.createdAt, other.createdAt),
    updatedAt: Math.max(preferred.updatedAt, other.updatedAt),
  }
}

export function upsertTrainingTask(task: TrainingTask): TrainingTask[] {
  const current = loadTrainingTasks()
  const key = trainingTaskDedupeKey(task)
  const existing = current.find((item) => trainingTaskDedupeKey(item) === key)
  const saved = existing
    ? {
        ...task,
        id: existing.id,
        status: existing.status,
        attempts: existing.attempts,
        lastResult: existing.lastResult,
        lastPracticedAt: existing.lastPracticedAt,
        createdAt: existing.createdAt,
        updatedAt: Math.max(task.updatedAt, existing.updatedAt),
      }
    : task
  const next = [saved, ...current.filter((item) => item.id !== existing?.id && item.id !== task.id)]
  saveTrainingTasks(next)
  return next
}

export function updateTrainingTaskAttempt(
  id: string,
  evaluation: TrainingEvaluation,
  now = Date.now(),
): TrainingTask[] {
  const current = loadTrainingTasks()
  const next = current.map((item) =>
    item.id === id ? applyTrainingAttempt(item, evaluation, now) : item,
  )
  saveTrainingTasks(next)
  return next
}

export function deleteTrainingTasks(ids: string[]): TrainingTask[] {
  const selected = new Set(ids)
  const next = loadTrainingTasks().filter((item) => !selected.has(item.id))
  saveTrainingTasks(next)
  return next
}

export function exportTrainingTasksJson(): string {
  return JSON.stringify(
    { version: 1, exportedAt: new Date().toISOString(), tasks: loadTrainingTasks() },
    null,
    2,
  )
}

export function importTrainingTasksJson(raw: string): TrainingTask[] {
  const parsed = JSON.parse(raw) as unknown
  const candidates = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { tasks?: unknown }).tasks)
      ? (parsed as { tasks: unknown[] }).tasks
      : []
  const imported = candidates.filter(isValidTrainingTask)
  if (imported.length === 0) return loadTrainingTasks()

  let merged = loadTrainingTasks()
  imported.forEach((task) => {
    const key = trainingTaskDedupeKey(task)
    const existing = merged.find((item) => trainingTaskDedupeKey(item) === key)
    const preferred = existing && existing.updatedAt > task.updatedAt ? existing : task
    const saved = existing ? mergeTaskProgress(preferred, existing) : task
    merged = [saved, ...merged.filter((item) => item.id !== existing?.id && item.id !== task.id)]
  })
  saveTrainingTasks(merged)
  return merged
}
