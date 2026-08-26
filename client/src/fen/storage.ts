import { validateFenPosition } from '../engine/validation'
import {
  pullCloudDocuments,
  queueCloudDelete,
  queueCloudUpsert,
  scopedStorageKey,
} from '../sync/cloudDocuments'

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
    const raw = window.localStorage.getItem(scopedStorageKey(STORAGE_KEY))
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

  const previous = loadRecentFenPositions()
  const next = [
    { fen: normalizedFen, label, savedAt: Date.now() },
    ...previous.filter((item) => item.fen !== normalizedFen),
  ].slice(0, MAX_RECENT_FENS)

  window.localStorage.setItem(scopedStorageKey(STORAGE_KEY), JSON.stringify(next))
  queueCloudUpsert('recent-fens', normalizedFen, next[0])
  const nextFens = new Set(next.map((item) => item.fen))
  for (const item of previous) {
    if (!nextFens.has(item.fen)) queueCloudDelete('recent-fens', item.fen)
  }
  return next
}

export async function syncRecentFenPositionsFromCloud(): Promise<RecentFenPosition[] | null> {
  const pulled = await pullCloudDocuments<RecentFenPosition>('recent-fens', (item) => item.fen)
  if (!pulled) return null
  const valid = pulled
    .filter((item) => item?.fen && validateFenPosition(item.fen).ok)
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, MAX_RECENT_FENS)
  if (canUseStorage()) {
    window.localStorage.setItem(scopedStorageKey(STORAGE_KEY), JSON.stringify(valid))
  }
  return valid
}
