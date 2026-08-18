import { applyMove, createEmptyBoard, getCell, hasNeighbor } from '../core/board'
import { isForbiddenMove } from '../core/rules'
import { BLACK, BOARD_SIZE, EMPTY, type Move, type Player } from '../core/types'
import { evaluateBoard, evaluateMove } from './evaluate'
import type {
  ReviewGrade,
  ReviewPayload,
  ReviewReport,
  ReviewStep,
  ReviewSuggestion,
} from './types'

const MAX_REVIEW_CANDIDATES = 12
const MIN_REVIEW_CANDIDATES = 4
const REVIEW_CANDIDATE_WORK = 180

function gradeByDelta(delta: number): ReviewGrade {
  if (delta < 4_000) return 'best'
  if (delta < 15_000) return 'inaccuracy'
  if (delta < 50_000) return 'mistake'
  return 'blunder'
}

function sameMove(a: Move, b: { row: number; col: number }): boolean {
  return a.row === b.row && a.col === b.col
}

function candidatePriority(board: Int8Array, row: number, col: number, player: Player): number {
  let priority = 14 - Math.abs(7 - row) - Math.abs(7 - col)
  for (let dr = -2; dr <= 2; dr += 1) {
    for (let dc = -2; dc <= 2; dc += 1) {
      if (dr === 0 && dc === 0) continue
      const cell = getCell(board, row + dr, col + dc)
      if (cell === EMPTY) continue
      const distance = Math.max(Math.abs(dr), Math.abs(dc))
      const proximity = distance === 1 ? 5 : 2
      priority += proximity * (cell === player ? 3 : 2)
    }
  }
  return priority
}

function isLegalReviewMove(
  board: Int8Array,
  row: number,
  col: number,
  player: Player,
  forbiddenEnabled: boolean,
): boolean {
  if (getCell(board, row, col) !== EMPTY) return false
  if (!forbiddenEnabled || player !== BLACK) return true
  const next = applyMove(board, { row, col, player })
  return !isForbiddenMove(next, row, col, { forbiddenEnabled })
}

function findReviewSuggestions(
  board: Int8Array,
  player: Player,
  forbiddenEnabled: boolean,
  candidateLimit: number,
): ReviewSuggestion[] {
  const candidates: Array<{ row: number; col: number; priority: number }> = []
  const hasStone = board.some((cell) => cell !== EMPTY)
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (getCell(board, row, col) !== EMPTY) continue
      if (hasStone && !hasNeighbor(board, row, col, 2)) continue
      candidates.push({
        row,
        col,
        priority: candidatePriority(board, row, col, player),
      })
    }
  }

  return candidates
    .sort((a, b) => b.priority - a.priority)
    .slice(0, candidateLimit)
    .filter((candidate) =>
      isLegalReviewMove(board, candidate.row, candidate.col, player, forbiddenEnabled),
    )
    .map((candidate) => ({
      row: candidate.row,
      col: candidate.col,
      score: evaluateMove(board, candidate.row, candidate.col, player),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
}

function buildSummary(steps: ReviewStep[]): {
  keyTurns: number[]
  text: string
} {
  if (steps.length === 0) {
    return { keyTurns: [], text: '暂无可复盘数据。' }
  }
  const sorted = [...steps].sort((a, b) => b.delta - a.delta)
  const keyTurns = sorted.slice(0, 3).map((s) => s.ply)
  const blunders = steps.filter((s) => s.grade === 'blunder').length
  const mistakes = steps.filter((s) => s.grade === 'mistake').length
  const text = `关键转折共 ${keyTurns.length} 处（手数：${keyTurns.join('、')}）。全局共出现 ${blunders} 次明显失误（blunder）和 ${mistakes} 次中等失误（mistake）。`
  return { keyTurns, text }
}

export function analyzeGameReview(
  payload: ReviewPayload,
  onProgress?: (completed: number, total: number) => void,
): ReviewReport {
  const { moveHistory, forbiddenEnabled } = payload
  const steps: ReviewStep[] = []
  const candidateLimit = Math.max(
    MIN_REVIEW_CANDIDATES,
    Math.min(
      MAX_REVIEW_CANDIDATES,
      Math.floor(REVIEW_CANDIDATE_WORK / Math.max(1, moveHistory.length)),
    ),
  )

  let board = createEmptyBoard()
  for (let i = 0; i < moveHistory.length; i += 1) {
    const mv = moveHistory[i]
    const evalBlackBefore = evaluateBoard(board, BLACK)

    const top = findReviewSuggestions(board, mv.player, forbiddenEnabled, candidateLimit)
    const bestScore = top.length > 0 ? top[0].score : 0

    let playedScore = top.find((t) => sameMove(mv, t))?.score
    if (playedScore === undefined) {
      playedScore = evaluateMove(board, mv.row, mv.col, mv.player)
    }
    const delta = Math.max(0, bestScore - playedScore)
    const grade = gradeByDelta(delta)

    board = applyMove(board, mv)
    const evalBlackAfter = evaluateBoard(board, BLACK)

    steps.push({
      ply: i + 1,
      player: mv.player,
      playedMove: { row: mv.row, col: mv.col },
      playedScore,
      bestScore,
      delta,
      grade,
      suggestions: top.map((t) => ({ row: t.row, col: t.col, score: t.score })),
      evalBlackBefore,
      evalBlackAfter,
    })
    onProgress?.(i + 1, moveHistory.length)
  }

  return {
    steps,
    summary: buildSummary(steps),
  }
}
