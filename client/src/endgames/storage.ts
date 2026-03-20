import { EndgameDefinition } from '../types'

const STORAGE_KEY = 'xiangqi.custom-endgames.v1'
const FAVORITES_KEY = 'xiangqi.favorite-endgames.v1'

function isValidEndgame(value: unknown): value is EndgameDefinition {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    typeof item.fen === 'string' &&
    (item.description === undefined || typeof item.description === 'string') &&
    item.source === 'custom'
  )
}

export function loadCustomEndgames(): EndgameDefinition[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidEndgame)
  } catch {
    return []
  }
}

export function saveCustomEndgames(endgames: EndgameDefinition[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(endgames.filter(item => item.source === 'custom')))
}

export function upsertCustomEndgame(endgame: EndgameDefinition): EndgameDefinition[] {
  const current = loadCustomEndgames()
  const next = current.filter(item => item.id !== endgame.id)
  next.unshift({ ...endgame, source: 'custom' })
  saveCustomEndgames(next)
  return next
}

export function deleteCustomEndgame(id: string): EndgameDefinition[] {
  const next = loadCustomEndgames().filter(item => item.id !== id)
  saveCustomEndgames(next)
  return next
}

export function loadFavoriteEndgameIds(): string[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function saveFavoriteEndgameIds(ids: string[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(new Set(ids))))
}

export function toggleFavoriteEndgame(id: string): string[] {
  const current = loadFavoriteEndgameIds()
  const next = current.includes(id)
    ? current.filter(item => item !== id)
    : [id, ...current]
  saveFavoriteEndgameIds(next)
  return next
}
