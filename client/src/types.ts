export type PieceType = 'k' | 'a' | 'b' | 'n' | 'r' | 'c' | 'p'
export type PieceColor = 'red' | 'black'

export interface Piece {
  type: PieceType
  color: PieceColor
  /** 揭棋暗子在客户端保存真实身份，但在棋盘和引擎局面中保持隐藏。 */
  hidden?: boolean
  /** 暗子翻开前按初始落点对应的棋种行走。 */
  darkType?: PieceType
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
  /** 揭棋回退/重做需要保留当时尚未公开的随机棋子身份。 */
  snapshot?: { board: Board; turn: PieceColor }
}

export type GameMode = 'human-vs-ai' | 'human-vs-human' | 'ai-vs-ai' | 'jieqi' | 'endgame' | 'study'
export type LiveGameMode = Exclude<GameMode, 'endgame' | 'study'>
export type EngineVariant = 'xiangqi' | 'jieqi'
export type Difficulty = 'easy' | 'medium' | 'hard' | 'master'
export type EngineSearchMode = 'depth' | 'time'
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

/**
 * 变招节点的独立引擎分析结果。
 * 评估归属具体节点,切换分支后曲线仍对应各自的节点数据。
 */
export interface NodeAnalysis {
  /** 只有有限分析任务正常结束后才可作为同配置缓存复用。 */
  complete?: boolean
  /** 红方视角分值(cp)。 */
  score: number
  /** 实际到达深度。 */
  depth: number
  /** UCI 最佳着。 */
  bestMove?: string
  /** 主变化 UCI 走法列表。 */
  pv?: string[]
  /** 分析时的搜索限制,用于缓存签名比较。 */
  searchLimit?: EngineSearchLimit
  /** 分析时的引擎线程配置。 */
  engineThreads?: number | 'auto'
  /** 分析时的引擎 Hash 配置(MB)。 */
  engineHashMb?: number
  updatedAt: number
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
  /** 客户端把服务端步索引响应绑定到稳定的变招节点。 */
  nodeId?: string
  moveIndex: number
  evaluation: number
  depth: number
  bestMove: string
  pv: string[]
}

export type BoardAnnotationType = 'arrow' | 'circle'
export type BoardAnnotationColor = 'red' | 'green' | 'blue'

export interface BoardAnnotation {
  id: string
  type: BoardAnnotationType
  color: BoardAnnotationColor
  from: Position
  to?: Position
}

export interface VariationNode {
  id: string
  parentId: string | null
  move?: MoveRecord
  fen: string
  children: string[]
  mainChildId?: string
  annotations?: BoardAnnotation[]
  analysis?: NodeAnalysis
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

export interface PersistedGameConfig {
  difficulty: Difficulty
  playerSide: PlayerSide
  aiRedDifficulty: Difficulty
  aiBlackDifficulty: Difficulty
}

export interface PersistedGameState {
  initialFen: string
  initialJieqiBoard?: Board
  historyRecords: MoveRecord[]
  currentMoveIndex: number
  variationTree: VariationTree
  gameStatus: GameStatus
  gameStatusReason?: GameStatusReason
}

export interface GameDocument {
  id: string
  schemaVersion: 2
  revision: number
  name: string
  mode: LiveGameMode
  config: PersistedGameConfig
  state: PersistedGameState
  createdAt: number
  updatedAt: number
}

export interface CompactGameMove {
  /** UCI move. */
  u: string
  /** Preserved notation. */
  q?: string
  /** Engine elapsed milliseconds. */
  e?: number
  /** Move source. */
  s?: MoveRecord['source']
  /** Marked move. */
  m?: 1
  /** User note. */
  n?: string
}

export interface CompactVariationNode {
  /** Parent node id; null for the root. */
  p: string | null
  /** Ordered child ids. */
  c: string[]
  /** Main child id. */
  x?: string
  /** Move from the parent to this node. */
  v?: CompactGameMove
}

export interface CompactGameState {
  /** Initial FEN. */
  f: string
  /** Thirty hidden Jieqi identities in initial-square order. */
  j?: string
  /** Compact variation tree. */
  t: { r: string; c: string; n: Record<string, CompactVariationNode> }
  /** Game status. */
  s: GameStatus
  /** Game status reason. */
  g?: GameStatusReason
}

export interface StoredGameDocument extends Omit<GameDocument, 'state'> {
  state: CompactGameState
}

export interface GameSummary {
  id: string
  revision: number
  name: string
  mode: LiveGameMode
  config: PersistedGameConfig
  status: GameStatus
  moveCount: number
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
  | ({
      type: 'init'
      difficulty: Difficulty
      variant?: EngineVariant
    } & EngineRuntimeOptions)
  | ({
      type: 'move'
      requestId: string
      fen: string
      moves: string[]
      difficulty?: Difficulty
      variant?: EngineVariant
    } & EngineSearchLimit)
  | ({
      type: 'hint'
      requestId: string
      fen: string
      moves: string[]
      difficulty?: Difficulty
      variant?: EngineVariant
    } & EngineSearchLimit)
  | ({
      type: 'analyze'
      requestId: string
      fen: string
      moves: string[]
      variant?: EngineVariant
    } & EngineSearchLimit)
  | ({
      type: 'analyze-nodes'
      requestId: string
      fen: string
      moves: string[]
      moveIndexes: number[]
      variant?: EngineVariant
    } & EngineSearchLimit)
  | ({
      type: 'candidates'
      requestId?: string
      fen?: string
      moves?: string[]
      difficulty?: Difficulty
      count?: number
      candidates?: MoveCandidate[]
      variant?: EngineVariant
    } & EngineSearchLimit)
  | {
      type: 'review'
      requestId: string
      fen: string
      moves: string[]
      searchDepth: number
    }
  | { type: 'stop'; requestId?: string }
  | { type: 'claim-game' | 'takeover-game'; requestId: string; gameId: string }
  | { type: 'release-game'; gameId: string }
  | {
      type: 'bestmove'
      requestId?: string
      move: string
      ponder?: string
      elapsedMs?: number
      requestKind?: 'move' | 'hint'
      searchCapped?: boolean
    }
  | { type: 'info'; requestId?: string; data: EngineInfo }
  | {
      type: 'review-progress'
      requestId: string
      completed: number
      total: number
    }
  | { type: 'review-result'; requestId: string; positions: ReviewPosition[] }
  | {
      type: 'node-analysis-progress'
      requestId: string
      completed: number
      total: number
    }
  | { type: 'node-analysis-result'; requestId: string; positions: ReviewPosition[] }
  | { type: 'engine-status'; available: boolean; message?: string }
  | {
      type: 'game-lease'
      requestId?: string
      gameId: string
      status: 'granted' | 'readonly'
      leaseToken?: string
    }
  | { type: 'game-lease-lost'; gameId: string }
  | { type: 'error'; requestId?: string; message: string }
