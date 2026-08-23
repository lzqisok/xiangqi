import { BoardAnnotation, MoveRecord, NodeAnalysis, StudyPosition, VariationTree } from '../types'
import { MAX_NODE_ANNOTATIONS } from '../annotations/model'

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
    (item.variationTree === undefined || isValidVariationTree(item.variationTree)) &&
    typeof item.createdAt === 'number' &&
    typeof item.updatedAt === 'number'
  )
}

function isValidSearchLimit(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    (item.searchMode === undefined || item.searchMode === 'depth' || item.searchMode === 'time') &&
    (item.searchDepth === undefined || typeof item.searchDepth === 'number') &&
    (item.searchTimeMs === undefined || typeof item.searchTimeMs === 'number')
  )
}

function isValidNodeAnalysis(value: unknown): value is NodeAnalysis {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    (item.complete === undefined || typeof item.complete === 'boolean') &&
    typeof item.score === 'number' &&
    typeof item.depth === 'number' &&
    (item.bestMove === undefined || typeof item.bestMove === 'string') &&
    (item.pv === undefined ||
      (Array.isArray(item.pv) && item.pv.every((move) => typeof move === 'string'))) &&
    (item.searchLimit === undefined || isValidSearchLimit(item.searchLimit)) &&
    (item.engineThreads === undefined ||
      item.engineThreads === 'auto' ||
      typeof item.engineThreads === 'number') &&
    (item.engineHashMb === undefined || typeof item.engineHashMb === 'number') &&
    typeof item.updatedAt === 'number'
  )
}

function isValidVariationTree(value: unknown): value is VariationTree {
  if (!value || typeof value !== 'object') return false
  const tree = value as Record<string, unknown>
  if (
    typeof tree.rootId !== 'string' ||
    typeof tree.currentNodeId !== 'string' ||
    !tree.nodes ||
    typeof tree.nodes !== 'object'
  ) {
    return false
  }
  const nodes = tree.nodes as Record<string, unknown>
  if (!nodes[tree.rootId] || !nodes[tree.currentNodeId]) return false

  const entries = Object.entries(nodes)
  const structurallyValid = entries.every(([id, value]) => {
    if (!value || typeof value !== 'object') return false
    const node = value as Record<string, unknown>
    const isRoot = id === tree.rootId
    return (
      node.id === id &&
      (isRoot
        ? node.parentId === null && node.move === undefined
        : typeof node.parentId === 'string' &&
          Boolean(nodes[node.parentId]) &&
          isValidMoveRecord(node.move)) &&
      typeof node.fen === 'string' &&
      Array.isArray(node.children) &&
      node.children.every((childId) => typeof childId === 'string' && Boolean(nodes[childId])) &&
      (node.mainChildId === undefined ||
        (typeof node.mainChildId === 'string' && node.children.includes(node.mainChildId))) &&
      (node.annotations === undefined ||
        (Array.isArray(node.annotations) &&
          node.annotations.length <= MAX_NODE_ANNOTATIONS &&
          node.annotations.every(isValidBoardAnnotation))) &&
      (node.analysis === undefined || isValidNodeAnalysis(node.analysis)) &&
      typeof node.createdAt === 'number' &&
      typeof node.updatedAt === 'number'
    )
  })
  if (!structurallyValid) return false

  const reachable = new Set<string>()
  const pending = [tree.rootId]
  while (pending.length > 0) {
    const id = pending.pop()!
    if (reachable.has(id)) return false
    reachable.add(id)
    const node = nodes[id] as { children: string[] }
    for (const childId of node.children) {
      const child = nodes[childId] as { parentId: string | null }
      if (child.parentId !== id) return false
      pending.push(childId)
    }
  }
  return reachable.size === entries.length && reachable.has(tree.currentNodeId)
}

function isValidBoardAnnotation(value: unknown): value is BoardAnnotation {
  if (!value || typeof value !== 'object') return false
  const annotation = value as Record<string, unknown>
  const from = annotation.from
  const to = annotation.to
  const validFrom =
    isPosition(from) && from.row >= 0 && from.row < 10 && from.col >= 0 && from.col < 9
  const validTo = isPosition(to) && to.row >= 0 && to.row < 10 && to.col >= 0 && to.col < 9
  return (
    typeof annotation.id === 'string' &&
    annotation.id.length > 0 &&
    annotation.id.length <= 100 &&
    (annotation.color === 'red' || annotation.color === 'green' || annotation.color === 'blue') &&
    ((annotation.type === 'circle' && validFrom && annotation.to === undefined) ||
      (annotation.type === 'arrow' &&
        validFrom &&
        validTo &&
        (from.row !== to.row || from.col !== to.col)))
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

export function saveStudyPosition(
  study: Omit<StudyPosition, 'id' | 'createdAt' | 'updatedAt'> & {
    id?: string
  },
): StudyPosition[] {
  const current = loadStudyPositions()
  const now = Date.now()
  const existing = study.id ? current.find((item) => item.id === study.id) : null
  const saved: StudyPosition = {
    ...study,
    id: study.id || `study-${now}`,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }
  const next = [saved, ...current.filter((item) => item.id !== saved.id)]
  if (canUseStorage()) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
  return next
}

export function deleteStudyPosition(id: string): StudyPosition[] {
  return deleteStudyPositions([id])
}

export function deleteStudyPositions(ids: string[]): StudyPosition[] {
  const selected = new Set(ids)
  const next = loadStudyPositions().filter((item) => !selected.has(item.id))
  saveStudyPositions(next)
  return next
}

export function renameStudyPosition(id: string, name: string): StudyPosition[] {
  const trimmed = name.trim()
  const current = loadStudyPositions()
  if (!trimmed) return current

  const next = current.map((study) =>
    study.id === id ? { ...study, name: trimmed, updatedAt: Date.now() } : study,
  )
  saveStudyPositions(next)
  return next
}

export function duplicateStudyPosition(id: string): StudyPosition[] {
  const current = loadStudyPositions()
  const source = current.find((study) => study.id === id)
  if (!source) return current

  const now = Date.now()
  const copy: StudyPosition = {
    ...source,
    id: `study-${now}-${Math.random().toString(36).slice(2)}`,
    name: `${source.name} 副本`,
    moves: source.moves.map((move) => ({
      ...move,
      move: {
        ...move.move,
        from: { ...move.move.from },
        to: { ...move.move.to },
        piece: { ...move.move.piece },
        captured: move.move.captured ? { ...move.move.captured } : undefined,
      },
    })),
    analysisPoints: source.analysisPoints.map((point) => ({ ...point })),
    variationTree: source.variationTree ? structuredClone(source.variationTree) : undefined,
    createdAt: now,
    updatedAt: now,
  }
  const next = [copy, ...current]
  saveStudyPositions(next)
  return next
}

export function exportStudyPositionsJson(): string {
  return JSON.stringify(
    {
      version: 4,
      exportedAt: new Date().toISOString(),
      studies: loadStudyPositions(),
    },
    null,
    2,
  )
}

export function importStudyPositionsJson(raw: string): StudyPosition[] {
  const parsed = JSON.parse(raw) as unknown
  const candidates = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { studies?: unknown }).studies)
      ? (parsed as { studies: unknown[] }).studies
      : []

  const imported = candidates.filter(isValidStudy)
  if (imported.length === 0) {
    return loadStudyPositions()
  }

  const current = loadStudyPositions()
  const merged = [
    ...imported,
    ...current.filter((item) => !imported.some((importedItem) => importedItem.id === item.id)),
  ].sort((a, b) => b.updatedAt - a.updatedAt)
  saveStudyPositions(merged)
  return merged
}
