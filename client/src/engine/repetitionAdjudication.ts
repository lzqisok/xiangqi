import type { MoveRecord, PieceColor } from '../types'
import { parseFen } from './board'
import { getRepetitionKey } from './repetition'
import { isInCheck } from './rules'

export type RepetitionCaseAnalysis =
  | { kind: 'not-ready'; occurrences: number }
  | {
      kind: 'single-perpetual-check'
      occurrences: number
      liableSide: PieceColor
      cycleStartPly: number
      cycleEndPly: number
    }
  | {
      kind: 'requires-chase-classification'
      occurrences: number
      checkingSides: PieceColor[]
      cycleStartPly: number
      cycleEndPly: number
    }

/**
 * Builds evidence for a threefold repetition ruling without changing the current
 * simplified draw behavior. Only an unambiguous single-side perpetual check is
 * classified; chase, kill, exchange, sacrifice, and mixed cases remain pending.
 */
export function analyzeRepetitionCase(
  initialFen: string,
  records: MoveRecord[],
): RepetitionCaseAnalysis {
  const positions = [initialFen, ...records.map((record) => record.fen)]
  const currentKey = getRepetitionKey(positions[positions.length - 1])
  const occurrences = positions
    .map((fen, index) => ({ key: getRepetitionKey(fen), index }))
    .filter((item) => item.key === currentKey)
    .map((item) => item.index)

  if (occurrences.length < 3) return { kind: 'not-ready', occurrences: occurrences.length }

  const cycleStartPly = occurrences[occurrences.length - 3]
  const cycleEndPly = occurrences[occurrences.length - 1]
  const checkingMoves: Record<PieceColor, boolean[]> = { red: [], black: [] }

  for (let ply = cycleStartPly; ply < cycleEndPly; ply++) {
    const { board, turn: sideToMove } = parseFen(records[ply].fen)
    const mover: PieceColor = sideToMove === 'red' ? 'black' : 'red'
    checkingMoves[mover].push(isInCheck(board, sideToMove))
  }

  const checkingSides = (['red', 'black'] as const).filter(
    (side) => checkingMoves[side].length > 0 && checkingMoves[side].every(Boolean),
  )
  if (checkingSides.length === 1) {
    return {
      kind: 'single-perpetual-check',
      occurrences: occurrences.length,
      liableSide: checkingSides[0],
      cycleStartPly,
      cycleEndPly,
    }
  }
  return {
    kind: 'requires-chase-classification',
    occurrences: occurrences.length,
    checkingSides: [...checkingSides],
    cycleStartPly,
    cycleEndPly,
  }
}
