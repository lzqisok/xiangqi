export const BOARD_SIZE = 15
export const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE

export type Cell = 0 | 1 | 2
export type Player = 1 | 2

export type GameMode = 'pvp' | 'ai' | 'ai-vs-ai'
export type Difficulty = 'easy' | 'medium' | 'hard' | 'master'

export const GOMOKU_DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard', 'master']
export const GOMOKU_DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: '简单',
  medium: '中等',
  hard: '高等',
  master: '大师',
}

export interface Position {
  row: number
  col: number
}

export interface Move extends Position {
  player: Player
}

export interface WinResult {
  winner: Player
  line: Position[]
  reason: 'five' | 'forbidden'
}

export interface RuleConfig {
  forbiddenEnabled: boolean
}

export const EMPTY: Cell = 0
export const BLACK: Player = 1
export const WHITE: Player = 2
