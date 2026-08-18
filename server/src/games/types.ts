export type LiveGameMode = 'human-vs-ai' | 'human-vs-human' | 'ai-vs-ai' | 'jieqi'
export type Difficulty = 'easy' | 'medium' | 'hard' | 'master'
export type PlayerSide = 'red' | 'black'
export type GameStatus = 'playing' | 'red-wins' | 'black-wins' | 'draw'
export type GameStatusReason =
  | 'checkmate'
  | 'stalemate'
  | 'illegal-position'
  | 'manual'
  | 'resignation'
  | 'repetition'
  | 'natural-limit'
  | 'move-limit'

export interface GameConfig {
  difficulty: Difficulty
  playerSide: PlayerSide
  aiRedDifficulty: Difficulty
  aiBlackDifficulty: Difficulty
}

export interface CompactGameMove {
  u: string
  q?: string
  e?: number
  s?: 'human' | 'ai-red' | 'ai-black'
  m?: 1
  n?: string
}

export interface CompactVariationNode {
  p: string | null
  c: string[]
  x?: string
  v?: CompactGameMove
}

export interface StoredGameState {
  f: string
  j?: string
  t: { r: string; c: string; n: Record<string, CompactVariationNode> }
  s: GameStatus
  g?: GameStatusReason
}

export interface GameDocument {
  id: string
  schemaVersion: 2
  revision: number
  name: string
  mode: LiveGameMode
  config: GameConfig
  state: StoredGameState
  createdAt: number
  updatedAt: number
}

export interface GameSummary {
  id: string
  revision: number
  name: string
  mode: LiveGameMode
  config: GameConfig
  status: GameStatus
  moveCount: number
  createdAt: number
  updatedAt: number
}

export interface GameIndexFile {
  schemaVersion: 2
  games: Record<string, GameSummary>
}

export interface GameExportFile {
  exportVersion: 2
  exportedAt: number
  games: GameDocument[]
}
