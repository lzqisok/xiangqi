import { validateFenPosition } from '../engine/validation'

export interface RecentFenPosition {
  fen: string
  label: string
  savedAt: number
}

const STORAGE_KEY = 'xiangqi_recent_fens'
const MAX_RECENT_FENS = 10

function canUseStorage(): boolean {
  try {
    return typeof window !== 'undefined' && Boolean(window.localStorage)
  } catch {
    return false
  }
}

export function loadRecentFenPositions(): RecentFenPosition[] {
  if (!canUseStorage()) return []

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as RecentFenPosition[]
    return parsed
      .filter((item) => item?.fen && validateFenPosition(item.fen).ok)
      .slice(0, MAX_RECENT_FENS)
  } catch {
    return []
  }
}

export function saveRecentFenPosition(fen: string, label = '最近局面'): RecentFenPosition[] {
  const normalizedFen = fen.trim()
  if (!canUseStorage() || !validateFenPosition(normalizedFen).ok) {
    return loadRecentFenPositions()
  }

  const next = [
    { fen: normalizedFen, label, savedAt: Date.now() },
    ...loadRecentFenPositions().filter((item) => item.fen !== normalizedFen),
  ].slice(0, MAX_RECENT_FENS)

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}
