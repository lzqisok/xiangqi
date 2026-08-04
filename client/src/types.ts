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
  marked?: boolean
  note?: string
}

export type GameMode = 'human-vs-ai' | 'human-vs-human' | 'ai-vs-ai' | 'endgame' | 'study'
export type Difficulty = 'easy' | 'medium' | 'hard' | 'master'
export type EngineSearchMode = 'depth' | 'time'
export type PlayerSide = 'red' | 'black'
export type GameStatus = 'playing' | 'red-wins' | 'black-wins' | 'draw'
export type GameStatusReason = 'checkmate' | 'stalemate' | 'illegal-position' | 'manual' | 'resignation'
export type PlayerType = 'human' | 'ai'

export interface PlayerConfig {
  type: PlayerType
  difficulty?: Difficulty
}

export type EndgameSource = 'builtin' | 'custom'

export interface EndgameDefinition {
  id: string
  name: string
  fen: string
  description?: string
  tags?: string[]
  target?: EndgameTarget
  maxMoves?: number
  solution?: string[]
  source: EndgameSource
}

export type EndgameTarget = 'red-win' | 'black-win' | 'draw' | 'survive'

export interface EndgameStartConfig {
  red: PlayerConfig
  black: PlayerConfig
}

export interface EngineInfo {
  depth: number
  score: number
  pv: string[]
  nodes: number
  nps: number
}

export interface AnalysisPoint {
  moveIndex: number
  evaluation: number
  depth: number
}

export interface MoveCandidate {
  move: string
  notation?: string
  pvNotation?: string[]
  score: number
  depth: number
  pv: string[]
}

export interface ReviewPosition {
  moveIndex: number
  evaluation: number
  depth: number
  bestMove: string
  pv: string[]
}

export interface VariationNode {
  id: string
  parentId: string | null
  move?: MoveRecord
  fen: string
  children: string[]
  mainChildId?: string
  createdAt: number
  updatedAt: number
}

export interface VariationTree {
  rootId: string
  nodes: Record<string, VariationNode>
  currentNodeId: string
}

export interface StudyPosition {
  id: string
  name: string
  description?: string
  initialFen: string
  moves: MoveRecord[]
  currentMoveIndex: number
  analysisPoints: AnalysisPoint[]
  variationTree?: VariationTree
  createdAt: number
  updatedAt: number
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected'

export interface EngineSearchLimit {
  searchMode?: EngineSearchMode
  searchDepth?: number
  searchTimeMs?: number
}

export interface EngineRuntimeOptions {
  engineThreads?: 'auto' | number
  engineHashMb?: number
}

export type WSMessage =
  | ({ type: 'init'; difficulty: Difficulty } & EngineRuntimeOptions)
  | ({ type: 'move'; requestId: string; fen: string; moves: string[]; difficulty?: Difficulty } & EngineSearchLimit)
  | ({ type: 'hint'; requestId: string; fen: string; moves: string[]; difficulty?: Difficulty } & EngineSearchLimit)
  | ({ type: 'analyze'; requestId: string; fen: string; moves: string[] } & EngineSearchLimit)
  | ({ type: 'candidates'; requestId?: string; fen?: string; moves?: string[]; difficulty?: Difficulty; count?: number; candidates?: MoveCandidate[] } & EngineSearchLimit)
  | { type: 'review'; requestId: string; fen: string; moves: string[]; searchDepth: number }
  | { type: 'stop'; requestId?: string }
  | { type: 'bestmove'; requestId?: string; move: string; ponder?: string; elapsedMs?: number; requestKind?: 'move' | 'hint'; searchCapped?: boolean }
  | { type: 'info'; requestId?: string; data: EngineInfo }
  | { type: 'review-progress'; requestId: string; completed: number; total: number }
  | { type: 'review-result'; requestId: string; positions: ReviewPosition[] }
  | { type: 'engine-status'; available: boolean; message?: string }
  | { type: 'error'; requestId?: string; message: string }
