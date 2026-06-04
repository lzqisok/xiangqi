import { Board as BoardState, EndgameDefinition, MoveRecord } from '../types'
import { getPieceDisplayName, moveToNotation, moveToUci, uciToMove } from '../engine/notation'

export type TrainingHintHistoryEntry = {
  moveIndex: number
  level: number
  text: string
  positionKey?: string
}

export function getEndgameTrainingHint(
  endgame: EndgameDefinition | null,
  records: MoveRecord[],
  board: BoardState,
  level: number,
): string {
  if (!endgame?.solution?.length || level <= 0) return ''
  const nextUci = endgame.solution[records.length]
  if (!nextUci) return '标准解法已走完。'

  try {
    const { from, to } = uciToMove(nextUci)
    const piece = board[from.row]?.[from.col]
    if (!piece) return `完整提示：${nextUci}`
    const move = { from, to, piece, captured: board[to.row]?.[to.col] || undefined }
    const pieceName = getPieceDisplayName(piece)
    if (level === 1) return `方向提示：下一手重点关注${piece.color === 'red' ? '红方' : '黑方'}${pieceName}的主动走法。`
    if (level === 2) return `棋子提示：建议动子是${pieceName}。`
    return `完整提示：${moveToNotation(board, move)}。`
  } catch {
    return `完整提示：${nextUci}`
  }
}

export function recordTrainingHintLevel(
  history: TrainingHintHistoryEntry[],
  moveIndex: number,
  level: number,
  text: string,
  positionKey?: string,
): TrainingHintHistoryEntry[] {
  if (!text) return history
  if (history.some(item => item.moveIndex === moveIndex && item.level === level && item.positionKey === positionKey)) return history
  const next = history.filter(item => !(item.moveIndex === moveIndex && item.level === level))
  const entry: TrainingHintHistoryEntry = positionKey
    ? { moveIndex, level, text, positionKey }
    : { moveIndex, level, text }
  return [...next, entry].slice(-6)
}

export function formatTrainingHintHistory(history: TrainingHintHistoryEntry[]): string {
  if (history.length === 0) return ''
  const parts = history.map(item => {
    const moveText = item.moveIndex < 0 ? '开局' : `第 ${item.moveIndex + 1} 手`
    return `${moveText} L${item.level} ${item.text}`
  })
  return `提示记录：${parts.join(' / ')}`
}

export function getEndgameTrainingFeedback(endgame: EndgameDefinition | null, records: MoveRecord[], status: string, evaluation: number | null): string {
  if (!endgame) return ''

  const solution = endgame.solution || []
  if (solution.length > 0 && records.length > 0) {
    const played = records.map(record => moveToUci(record.move.from, record.move.to))
    const firstMismatch = played.findIndex((uci, index) => solution[index] && solution[index] !== uci)
    if (firstMismatch >= 0) {
      return `已偏离标准解法：第 ${firstMismatch + 1} 手建议 ${solution[firstMismatch]}。${formatDeviationSeverity(endgame, evaluation)}`
    }
    if (played.length >= solution.length) {
      return '标准解法已完成。'
    }
    return `标准解法进度：${played.length}/${solution.length}。`
  }

  if (endgame.target === 'red-win' && status === 'red-wins') return '目标完成：红方胜。'
  if (endgame.target === 'black-win' && status === 'black-wins') return '目标完成：黑方胜。'
  if (endgame.target === 'draw' && status === 'draw') return '目标完成：守和成功。'
  if (endgame.target === 'survive' && endgame.maxMoves && records.length >= endgame.maxMoves && status === 'playing') {
    return `目标完成：已坚持 ${endgame.maxMoves} 手。`
  }
  if ((endgame.target === 'red-win' || endgame.target === 'black-win') && endgame.maxMoves && records.length >= endgame.maxMoves && status === 'playing') {
    return `已到目标步数：${endgame.maxMoves} 手内尚未完成目标。`
  }
  return ''
}

function formatDeviationSeverity(endgame: EndgameDefinition, evaluation: number | null): string {
  if (evaluation === null) return '可结合候选走法继续判断是否仍可挽回。'
  if (endgame.target === 'red-win') {
    if (evaluation >= 180) return '当前评估仍偏红方，可继续寻找胜法。'
    if (evaluation <= -120) return '当前评估已明显转差，建议回看标准解法。'
    return '当前评估接近均势，仍可继续但胜势不明确。'
  }
  if (endgame.target === 'black-win') {
    if (evaluation <= -180) return '当前评估仍偏黑方，可继续寻找胜法。'
    if (evaluation >= 120) return '当前评估已明显转差，建议回看标准解法。'
    return '当前评估接近均势，仍可继续但胜势不明确。'
  }
  if (endgame.target === 'draw' || endgame.target === 'survive') {
    return Math.abs(evaluation) <= 180
      ? '当前评估仍接近均势，守和目标仍可继续。'
      : '当前评估已偏离均势，建议谨慎回看关键分支。'
  }
  return '可结合候选走法继续判断是否仍可挽回。'
}
