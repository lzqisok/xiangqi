import { StudyPosition } from '../types'

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
    typeof item.initialFen === 'string' &&
    Array.isArray(item.moves) &&
    typeof item.currentMoveIndex === 'number' &&
    Array.isArray(item.analysisPoints) &&
    typeof item.createdAt === 'number' &&
    typeof item.updatedAt === 'number'
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
  if (canUseStorage()) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
  return next
}
