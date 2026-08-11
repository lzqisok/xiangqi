import { validateFenPosition } from '../validation.js'
import { CompactVariationNode, GameConfig, GameDocument, GameStatus, GameSummary, LiveGameMode, StoredGameState } from './types.js'

const MODES = new Set<LiveGameMode>(['human-vs-ai', 'human-vs-human', 'ai-vs-ai', 'jieqi'])
const DIFFICULTIES = new Set(['easy', 'medium', 'hard', 'master'])
const STATUSES = new Set<GameStatus>(['playing', 'red-wins', 'black-wins', 'draw'])
const STATUS_REASONS = new Set(['checkmate', 'stalemate', 'illegal-position', 'manual', 'resignation', 'repetition', 'natural-limit', 'move-limit'])
const SOURCES = new Set(['human', 'ai-red', 'ai-black'])
const UCI_MOVE = /^[a-i][0-9][a-i][0-9]$/
const GAME_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const JIEQI_INITIAL_FEN = 'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P5N2B2r2a2c2p5n2b2 0 1'
// A line of N moves has N + 1 nodes because the root position is also stored.
export const MAX_VARIATION_NODES = 2001
export const MAX_STORED_GAMES = 500

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function isJieqiLayout(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[rabncp]{30}$/.test(value)) return false
  const validSide = (layout: string) => {
    const counts = { r: 0, a: 0, b: 0, n: 0, c: 0, p: 0 }
    for (const type of layout) counts[type as keyof typeof counts]++
    return counts.r === 2 && counts.a === 2 && counts.b === 2 && counts.n === 2 && counts.c === 2 && counts.p === 5
  }
  return validSide(value.slice(0, 15)) && validSide(value.slice(15))
}

function isCompactMove(value: unknown): boolean {
  const move = object(value)
  return Boolean(move) && UCI_MOVE.test(move!.u as string) &&
    (move!.q === undefined || typeof move!.q === 'string' && move!.q.length <= 200) &&
    (move!.e === undefined || typeof move!.e === 'number' && Number.isFinite(move!.e) && move!.e >= 0) &&
    (move!.s === undefined || SOURCES.has(move!.s as string)) &&
    (move!.m === undefined || move!.m === 1) &&
    (move!.n === undefined || typeof move!.n === 'string' && move!.n.length <= 2000)
}

function isCompactTree(value: unknown): value is StoredGameState['t'] {
  const tree = object(value)
  const nodes = object(tree?.n)
  if (!tree || !nodes || typeof tree.r !== 'string' || typeof tree.c !== 'string') return false
  const entries = Object.entries(nodes)
  if (entries.length < 1 || entries.length > MAX_VARIATION_NODES || !nodes[tree.r] || !nodes[tree.c]) return false
  for (const [id, rawNode] of entries) {
    const node = object(rawNode)
    if (!node || !Array.isArray(node.c) || !node.c.every(child => typeof child === 'string' && Boolean(nodes[child]))) return false
    const isRoot = id === tree.r
    if (isRoot ? node.p !== null || node.v !== undefined : typeof node.p !== 'string' || !nodes[node.p] || !isCompactMove(node.v)) return false
    if (node.x !== undefined && (typeof node.x !== 'string' || !node.c.includes(node.x))) return false
  }
  const reached = new Set<string>()
  const pending = [tree.r as string]
  while (pending.length) {
    const id = pending.pop()!
    if (reached.has(id)) return false
    reached.add(id)
    const node = nodes[id] as unknown as CompactVariationNode
    for (const childId of node.c) {
      if ((nodes[childId] as unknown as CompactVariationNode).p !== id) return false
      pending.push(childId)
    }
  }
  return reached.size === entries.length
}

export function isGameConfig(value: unknown): value is GameConfig {
  const item = object(value)
  return Boolean(item) && DIFFICULTIES.has(item!.difficulty as string) &&
    (item!.playerSide === 'red' || item!.playerSide === 'black') &&
    DIFFICULTIES.has(item!.aiRedDifficulty as string) && DIFFICULTIES.has(item!.aiBlackDifficulty as string)
}

export function isStoredGameState(value: unknown, mode: LiveGameMode): value is StoredGameState {
  const state = object(value)
  if (!state || typeof state.f !== 'string' || state.f.length > 300 || !isCompactTree(state.t)) return false
  if (mode === 'jieqi' ? state.f !== JIEQI_INITIAL_FEN || !isJieqiLayout(state.j) : !validateFenPosition(state.f).ok || state.j !== undefined) return false
  return STATUSES.has(state.s as GameStatus) && (state.g === undefined || STATUS_REASONS.has(state.g as string))
}

export function isGameDocument(value: unknown): value is GameDocument {
  const game = object(value)
  if (!game || typeof game.id !== 'string' || !GAME_ID.test(game.id) || game.schemaVersion !== 2) return false
  if (!Number.isInteger(game.revision) || Number(game.revision) < 0 || typeof game.name !== 'string' || !game.name.trim() || game.name.length > 100) return false
  if (!isLiveGameMode(game.mode) || !isGameConfig(game.config) || !isStoredGameState(game.state, game.mode)) return false
  return typeof game.createdAt === 'number' && Number.isFinite(game.createdAt) && typeof game.updatedAt === 'number' && Number.isFinite(game.updatedAt)
}

export function isGameSummary(value: unknown): value is GameSummary {
  const game = object(value)
  return Boolean(game) && typeof game!.id === 'string' && Number.isInteger(game!.revision) &&
    typeof game!.name === 'string' && isLiveGameMode(game!.mode) && isGameConfig(game!.config) &&
    STATUSES.has(game!.status as GameStatus) && Number.isInteger(game!.moveCount) && Number(game!.moveCount) >= 0 &&
    typeof game!.createdAt === 'number' && typeof game!.updatedAt === 'number'
}

export function getCompactLineMoveCount(state: StoredGameState): number {
  let count = 0
  let node = state.t.n[state.t.c]
  const visited = new Set<string>()
  while (node?.p && !visited.has(node.p)) {
    visited.add(node.p)
    count++
    node = state.t.n[node.p]
  }
  node = state.t.n[state.t.c]
  while (node?.x && !visited.has(node.x)) {
    visited.add(node.x)
    count++
    node = state.t.n[node.x]
  }
  return count
}

export function isLiveGameMode(value: unknown): value is LiveGameMode {
  return typeof value === 'string' && MODES.has(value as LiveGameMode)
}
