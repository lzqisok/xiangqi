import { MoveRecord, PieceColor, ReviewPosition } from '../types'
import { applyMove, parseFen } from '../engine/board'
import { moveToNotation, moveToUci, uciToMove } from '../engine/notation'

export type MoveReviewCategory = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'

export interface MoveReview {
  /** 走棋前局面的稳定节点引用。 */
  nodeId: string
  moveIndex: number
  mover: PieceColor
  positionFen: string
  playedMove: string
  playedNotation: string
  category: MoveReviewCategory
  loss: number
  beforeEvaluation: number
  afterEvaluation: number
  bestMove: string
  recommendedNotation: string
  recommendedLine: string[]
}

const EVALUATION_CAP = 2000

function clampEvaluation(value: number): number {
  return Math.max(-EVALUATION_CAP, Math.min(EVALUATION_CAP, value))
}

export function classifyMoveLoss(loss: number, playedBestMove = false): MoveReviewCategory {
  if (playedBestMove) return 'best'
  if (loss <= 30) return 'good'
  if (loss < 100) return 'inaccuracy'
  if (loss < 250) return 'mistake'
  return 'blunder'
}

function translateLine(fen: string, pv: string[]): string[] {
  let { board } = parseFen(fen)
  const line: string[] = []
  for (const uci of pv.slice(0, 5)) {
    try {
      const { from, to } = uciToMove(uci)
      const piece = board[from.row][from.col]
      if (!piece) break
      const move = {
        from,
        to,
        piece,
        captured: board[to.row][to.col] || undefined,
      }
      line.push(moveToNotation(board, move))
      board = applyMove(board, from, to).newBoard
    } catch {
      break
    }
  }
  return line
}

export function buildMoveReviews(
  initialFen: string,
  records: MoveRecord[],
  positions: ReviewPosition[],
): MoveReview[] {
  const byIndex = new Map(positions.map((position) => [position.moveIndex, position]))

  return records.flatMap((record, moveIndex) => {
    const before = byIndex.get(moveIndex - 1)
    const after = byIndex.get(moveIndex)
    if (!before?.nodeId || !after?.nodeId) return []

    const positionFen = moveIndex === 0 ? initialFen : records[moveIndex - 1].fen
    const mover = parseFen(positionFen).turn
    const beforeEvaluation = clampEvaluation(before.evaluation)
    const afterEvaluation = clampEvaluation(after.evaluation)
    const loss = Math.max(
      0,
      Math.round(
        mover === 'red' ? beforeEvaluation - afterEvaluation : afterEvaluation - beforeEvaluation,
      ),
    )
    const playedMove = moveToUci(record.move.from, record.move.to)
    const recommendedLine = translateLine(positionFen, before.pv)

    return [
      {
        nodeId: before.nodeId,
        moveIndex,
        mover,
        positionFen,
        playedMove,
        playedNotation: record.notation,
        category: classifyMoveLoss(loss, playedMove === before.bestMove),
        loss,
        beforeEvaluation: before.evaluation,
        afterEvaluation: after.evaluation,
        bestMove: before.bestMove,
        recommendedNotation: recommendedLine[0] || before.bestMove,
        recommendedLine,
      },
    ]
  })
}

export const MOVE_REVIEW_LABELS: Record<MoveReviewCategory, string> = {
  best: '最佳',
  good: '良好',
  inaccuracy: '疑问',
  mistake: '错着',
  blunder: '严重失误',
}
