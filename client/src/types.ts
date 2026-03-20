export type PieceType = 'k' | 'a' | 'b' | 'n' | 'r' | 'c' | 'p'
export type PieceColor = 'red' | 'black'

export interface Piece {
  type: PieceType
  color: PieceColor
}

export type Board = (Piece | null)[][]

export interface Position {
  row: number
  col: number
}

export interface Move {
  from: Position
  to: Position
  captured?: Piece
  piece: Piece
}

export interface MoveRecord {
  move: Move
  notation: string
  fen: string
  elapsedMs?: number
  source?: 'human' | 'ai-red' | 'ai-black'
}

export type GameMode = 'human-vs-ai' | 'human-vs-human' | 'ai-vs-ai'
export type Difficulty = 'easy' | 'medium' | 'hard' | 'master'
export type PlayerSide = 'red' | 'black'
export type GameStatus = 'playing' | 'red-wins' | 'black-wins' | 'draw'

export interface EngineInfo {
  depth: number
  score: number
  pv: string[]
  nodes: number
  nps: number
}

export type WSMessage =
  | { type: 'init'; difficulty: Difficulty }
  | { type: 'move'; fen: string; moves: string[]; difficulty?: Difficulty }
  | { type: 'hint'; fen: string; moves: string[]; difficulty?: Difficulty }
  | { type: 'analyze'; fen: string; moves: string[] }
  | { type: 'stop' }
  | { type: 'bestmove'; move: string; ponder?: string; elapsedMs?: number; requestKind?: 'move' | 'hint' }
  | { type: 'info'; data: EngineInfo }
  | { type: 'error'; message: string }
