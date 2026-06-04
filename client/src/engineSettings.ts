import { Difficulty } from './types'

export type EngineSearchMode = 'depth' | 'time'

export interface EngineSettings {
  candidateCount: number
  candidateAutoRefreshDelay: number
  hintDifficulty: Difficulty
  searchMode: EngineSearchMode
  searchDepth: number
  searchTimeMs: number
}

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  candidateCount: 3,
  candidateAutoRefreshDelay: 900,
  hintDifficulty: 'master',
  searchMode: 'depth',
  searchDepth: 16,
  searchTimeMs: 2500,
}

const STORAGE_KEY = 'xiangqi_engine_settings'
const DIFFICULTIES = new Set<Difficulty>(['easy', 'medium', 'hard', 'master'])
const SEARCH_MODES = new Set<EngineSearchMode>(['depth', 'time'])

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value)))
}

function canUseStorage(): boolean {
  try {
    return typeof window !== 'undefined' && Boolean(window.localStorage)
  } catch {
    return false
  }
}

export function normalizeEngineSettings(value: Partial<EngineSettings> | null | undefined): EngineSettings {
  return {
    candidateCount: clampInteger(
      value?.candidateCount,
      1,
      5,
      DEFAULT_ENGINE_SETTINGS.candidateCount,
    ),
    candidateAutoRefreshDelay: clampInteger(
      value?.candidateAutoRefreshDelay,
      500,
      5000,
      DEFAULT_ENGINE_SETTINGS.candidateAutoRefreshDelay,
    ),
    hintDifficulty: DIFFICULTIES.has(value?.hintDifficulty as Difficulty)
      ? value!.hintDifficulty!
      : DEFAULT_ENGINE_SETTINGS.hintDifficulty,
    searchMode: SEARCH_MODES.has(value?.searchMode as EngineSearchMode)
      ? value!.searchMode!
      : DEFAULT_ENGINE_SETTINGS.searchMode,
    searchDepth: clampInteger(
      value?.searchDepth,
      4,
      30,
      DEFAULT_ENGINE_SETTINGS.searchDepth,
    ),
    searchTimeMs: clampInteger(
      value?.searchTimeMs,
      500,
      10000,
      DEFAULT_ENGINE_SETTINGS.searchTimeMs,
    ),
  }
}

export function serializeEngineSettings(value: Partial<EngineSettings>): string {
  return JSON.stringify(normalizeEngineSettings(value))
}

export function loadEngineSettings(): EngineSettings {
  if (!canUseStorage()) return DEFAULT_ENGINE_SETTINGS

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_ENGINE_SETTINGS
    return normalizeEngineSettings(JSON.parse(raw) as Partial<EngineSettings>)
  } catch {
    return DEFAULT_ENGINE_SETTINGS
  }
}

export function saveEngineSettings(value: Partial<EngineSettings>): EngineSettings {
  const next = normalizeEngineSettings(value)
  if (canUseStorage()) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
  return next
}
