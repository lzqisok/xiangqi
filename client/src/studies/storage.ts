import { MoveRecord, StudyPosition } from '../types'

const STORAGE_KEY = 'xiangqi.study-positions.v1'

function canUseStorage(): boolean {
  try {
    return typeof window !== 'undefined' && Boolean(window.localStorage)
  } catch {
    return false
  }
}

function isValidStudy(value: unknown): value is StudyPosition {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    (item.description === undefined || typeof item.description === 'string') &&
    typeof item.initialFen === 'string' &&
    Array.isArray(item.moves) &&
    item.moves.every(isValidMoveRecord) &&
    typeof item.currentMoveIndex === 'number' &&
    Array.isArray(item.analysisPoints) &&
    typeof item.createdAt === 'number' &&
    typeof item.updatedAt === 'number'
  )
}

function isPosition(value: unknown): value is { row: number; col: number } {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.row === 'number' && typeof item.col === 'number'
}

function isValidMoveRecord(value: unknown): value is MoveRecord {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  const move = item.move as Record<string, unknown> | undefined
  return (
    Boolean(move) &&
    typeof move === 'object' &&
    isPosition(move.from) &&
    isPosition(move.to) &&
    typeof item.notation === 'string' &&
    typeof item.fen === 'string' &&
    (item.note === undefined || typeof item.note === 'string') &&
    (item.marked === undefined || typeof item.marked === 'boolean')
  )
}

export function loadStudyPositions(): StudyPosition[] {
  if (!canUseStorage()) return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isValidStudy) : []
  } catch {
    return []
  }
}

export function saveStudyPositions(studies: StudyPosition[]) {
  if (!canUseStorage()) return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(studies.filter(isValidStudy)))
}

export function saveStudyPosition(study: Omit<StudyPosition, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): StudyPosition[] {
  const current = loadStudyPositions()
  const now = Date.now()
  const existing = study.id ? current.find(item => item.id === study.id) : null
  const saved: StudyPosition = {
    ...study,
    id: study.id || `study-${now}`,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }
  const next = [saved, ...current.filter(item => item.id !== saved.id)]
  if (canUseStorage()) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
  return next
}

export function deleteStudyPosition(id: string): StudyPosition[] {
  const next = loadStudyPositions().filter(item => item.id !== id)
  saveStudyPositions(next)
  return next
}

export function exportStudyPositionsJson(): string {
  return JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    studies: loadStudyPositions(),
  }, null, 2)
}

export function importStudyPositionsJson(raw: string): StudyPosition[] {
  const parsed = JSON.parse(raw) as unknown
  const candidates = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { studies?: unknown }).studies)
      ? (parsed as { studies: unknown[] }).studies
      : []

  const imported = candidates.filter(isValidStudy)
  if (imported.length === 0) {
    return loadStudyPositions()
  }

  const current = loadStudyPositions()
  const merged = [
    ...imported,
    ...current.filter(item => !imported.some(importedItem => importedItem.id === item.id)),
  ].sort((a, b) => b.updatedAt - a.updatedAt)
  saveStudyPositions(merged)
  return merged
}
