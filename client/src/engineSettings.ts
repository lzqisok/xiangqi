import { Difficulty } from './types'
import {
  cloudSyncEnabled,
  pullCloudDocuments,
  queueCloudUpsert,
  scopedStorageKey,
} from './sync/cloudDocuments'

export type EngineSearchMode = 'depth' | 'time'
export type EngineThreads = 'auto' | number

export interface EngineSettings {
  candidateCount: number
  candidateAutoRefreshDelay: number
  hintDifficulty: Difficulty
  searchMode: EngineSearchMode
  searchDepth: number
  searchTimeMs: number
  engineThreads: EngineThreads
  engineHashMb: number
}

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  candidateCount: 3,
  candidateAutoRefreshDelay: 900,
  hintDifficulty: 'master',
  searchMode: 'depth',
  searchDepth: 16,
  searchTimeMs: 2500,
  engineThreads: 'auto',
  engineHashMb: 128,
}

const LEGACY_STORAGE_KEY = 'xiangqi_engine_settings'
const ACCOUNT_STORAGE_KEY = 'xiangqi_account_settings'
const DEVICE_STORAGE_KEY = 'xiangqi_engine_device_settings'
const DIFFICULTIES = new Set<Difficulty>(['easy', 'medium', 'hard', 'master'])
const SEARCH_MODES = new Set<EngineSearchMode>(['depth', 'time'])

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value)))
}

function normalizeThreads(value: unknown): EngineThreads {
  if (value === 'auto') return 'auto'
  if (typeof value !== 'number' || !Number.isFinite(value))
    return DEFAULT_ENGINE_SETTINGS.engineThreads
  return Math.max(1, Math.min(8, Math.round(value)))
}

function canUseStorage(): boolean {
  try {
    return typeof window !== 'undefined' && Boolean(window.localStorage)
  } catch {
    return false
  }
}

export function normalizeEngineSettings(
  value: Partial<EngineSettings> | null | undefined,
): EngineSettings {
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
    searchDepth: clampInteger(value?.searchDepth, 4, 30, DEFAULT_ENGINE_SETTINGS.searchDepth),
    searchTimeMs: clampInteger(
      value?.searchTimeMs,
      500,
      10000,
      DEFAULT_ENGINE_SETTINGS.searchTimeMs,
    ),
    engineThreads: normalizeThreads(value?.engineThreads),
    engineHashMb: clampInteger(value?.engineHashMb, 16, 512, DEFAULT_ENGINE_SETTINGS.engineHashMb),
  }
}

export function serializeEngineSettings(value: Partial<EngineSettings>): string {
  return JSON.stringify(normalizeEngineSettings(value))
}

export function loadEngineSettings(): EngineSettings {
  if (!canUseStorage()) return DEFAULT_ENGINE_SETTINGS

  try {
    const accountRaw = window.localStorage.getItem(scopedStorageKey(ACCOUNT_STORAGE_KEY))
    const deviceRaw = window.localStorage.getItem(DEVICE_STORAGE_KEY)
    const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY)
    const account = accountRaw ? (JSON.parse(accountRaw) as Partial<EngineSettings>) : {}
    const device = deviceRaw ? (JSON.parse(deviceRaw) as Partial<EngineSettings>) : {}
    const legacy =
      !cloudSyncEnabled() && legacyRaw ? (JSON.parse(legacyRaw) as Partial<EngineSettings>) : {}
    return normalizeEngineSettings({ ...legacy, ...account, ...device })
  } catch {
    return DEFAULT_ENGINE_SETTINGS
  }
}

export function saveEngineSettings(value: Partial<EngineSettings>): EngineSettings {
  const next = normalizeEngineSettings(value)
  if (canUseStorage()) {
    const account = {
      candidateCount: next.candidateCount,
      candidateAutoRefreshDelay: next.candidateAutoRefreshDelay,
      hintDifficulty: next.hintDifficulty,
      searchMode: next.searchMode,
      searchDepth: next.searchDepth,
      searchTimeMs: next.searchTimeMs,
    }
    window.localStorage.setItem(scopedStorageKey(ACCOUNT_STORAGE_KEY), JSON.stringify(account))
    window.localStorage.setItem(
      DEVICE_STORAGE_KEY,
      JSON.stringify({ engineThreads: next.engineThreads, engineHashMb: next.engineHashMb }),
    )
    queueCloudUpsert('account-settings', 'engine', account)
  }
  return next
}

export async function syncEngineSettingsFromCloud(): Promise<EngineSettings | null> {
  const pulled = await pullCloudDocuments<Partial<EngineSettings>>(
    'account-settings',
    () => 'engine',
  )
  if (!pulled) return null
  const account = pulled[0] || {}
  if (canUseStorage()) {
    window.localStorage.setItem(scopedStorageKey(ACCOUNT_STORAGE_KEY), JSON.stringify(account))
  }
  return loadEngineSettings()
}
