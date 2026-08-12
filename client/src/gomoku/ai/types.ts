import type { Board } from '../core/board'
import type { Difficulty, Move, Player, Position } from '../core/types'

export interface ComputeAiPayload {
  board: Board
  aiPlayer: Player
  currentPlayer: Player
  forbiddenEnabled: boolean
  difficulty: Difficulty
  moveCount: number
  partitionModulo?: number
  partitionIndex?: number
}

export interface ComputeWorkerRequest {
  id: number
  type: 'compute'
  payload: ComputeAiPayload
}

export interface ReviewWorkerRequest {
  id: number
  type: 'review'
  payload: ReviewPayload
}

export type WorkerRequest = ComputeWorkerRequest | ReviewWorkerRequest

export interface BestMoveWorkerResponse {
  id: number
  type: 'best-move'
  move: Position | null
  score: number
}

export interface ReviewPayload {
  moveHistory: Move[]
  forbiddenEnabled: boolean
  difficulty: Difficulty
}

export interface ReviewSuggestion {
  row: number
  col: number
  score: number
}

export type ReviewGrade = 'best' | 'inaccuracy' | 'mistake' | 'blunder'

export interface ReviewStep {
  ply: number
  player: Player
  playedMove: Position
  playedScore: number
  bestScore: number
  delta: number
  grade: ReviewGrade
  suggestions: ReviewSuggestion[]
  evalBlackBefore: number
  evalBlackAfter: number
}

export interface ReviewSummary {
  keyTurns: number[]
  text: string
}

export interface ReviewReport {
  steps: ReviewStep[]
  summary: ReviewSummary
}

export interface ReviewWorkerResponse {
  id: number
  type: 'review-result'
  review: ReviewReport
}

export interface ReviewProgressWorkerResponse {
  id: number
  type: 'review-progress'
  completed: number
  total: number
}

export type WorkerResponse = BestMoveWorkerResponse | ReviewWorkerResponse | ReviewProgressWorkerResponse
