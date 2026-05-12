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
    (item.tags === undefined || (Array.isArray(item.tags) && item.tags.every(tag => typeof tag === 'string'))) &&
    (item.target === undefined || ['red-win', 'black-win', 'draw', 'survive'].includes(String(item.target))) &&
    (item.maxMoves === undefined || typeof item.maxMoves === 'number') &&
    (item.solution === undefined || (Array.isArray(item.solution) && item.solution.every(move => typeof move === 'string'))) &&
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
  next.unshift({ ...endgame, tags: normalizeTags(endgame.tags), solution: normalizeSolution(endgame.solution), source: 'custom' })
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

export function normalizeTags(tags: string[] | undefined): string[] {
  return Array.from(new Set((tags || []).map(tag => tag.trim()).filter(Boolean))).slice(0, 8)
}

export function parseTags(value: string): string[] {
  return normalizeTags(value.split(/[,\s，、]+/))
}

export function normalizeSolution(solution: string[] | undefined): string[] {
  return (solution || []).map(move => move.trim()).filter(move => /^[a-i][0-9][a-i][0-9]$/.test(move))
}

export function exportCustomEndgamesJson(): string {
  return JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    endgames: loadCustomEndgames(),
  }, null, 2)
}

export function importCustomEndgamesJson(raw: string): EndgameDefinition[] {
  const parsed = JSON.parse(raw) as unknown
  const candidates = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { endgames?: unknown }).endgames)
      ? (parsed as { endgames: unknown[] }).endgames
      : []

  const imported = candidates
    .filter(isValidEndgame)
    .map(item => ({ ...item, id: item.id || `custom-${Date.now()}`, tags: normalizeTags(item.tags), solution: normalizeSolution(item.solution), source: 'custom' as const }))

  if (imported.length === 0) {
    return loadCustomEndgames()
  }

  const current = loadCustomEndgames()
  const merged = [
    ...imported,
    ...current.filter(item => !imported.some(importedItem => importedItem.id === item.id)),
  ]
  saveCustomEndgames(merged)
  return merged
}
