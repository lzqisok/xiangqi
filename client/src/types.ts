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
export type PlayerSide = 'red' | 'black'
export type GameStatus = 'playing' | 'red-wins' | 'black-wins' | 'draw'
export type GameStatusReason = 'checkmate' | 'stalemate' | 'illegal-position' | 'manual'
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
  score: number
  depth: number
  pv: string[]
}

export interface StudyPosition {
  id: string
  name: string
  description?: string
  initialFen: string
  moves: MoveRecord[]
  currentMoveIndex: number
  analysisPoints: AnalysisPoint[]
  createdAt: number
  updatedAt: number
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected'

export type WSMessage =
  | { type: 'init'; difficulty: Difficulty }
  | { type: 'move'; requestId: string; fen: string; moves: string[]; difficulty?: Difficulty }
  | { type: 'hint'; requestId: string; fen: string; moves: string[]; difficulty?: Difficulty }
  | { type: 'analyze'; requestId: string; fen: string; moves: string[] }
  | { type: 'candidates'; requestId?: string; fen?: string; moves?: string[]; difficulty?: Difficulty; count?: number; candidates?: MoveCandidate[] }
  | { type: 'stop'; requestId?: string }
  | { type: 'bestmove'; requestId?: string; move: string; ponder?: string; elapsedMs?: number; requestKind?: 'move' | 'hint' }
  | { type: 'info'; requestId?: string; data: EngineInfo }
  | { type: 'engine-status'; available: boolean; message?: string }
  | { type: 'error'; requestId?: string; message: string }
