import { parseFen } from '../engine/board'
import { buildMoveRecordsFromUci } from '../share/replayLink'
import { Board, MoveCandidate, MoveRecord, PieceColor } from '../types'

export interface CandidatePreviewFrame {
  board: Board
  turn: PieceColor
  lastMove: MoveRecord['move'] | null
  notation: string
}

export function buildCandidatePreview(initialFen: string, candidate: MoveCandidate): MoveRecord[] {
  const moves = candidate.pv[0] === candidate.move
    ? candidate.pv
    : [candidate.move, ...candidate.pv]
  return buildMoveRecordsFromUci(initialFen, moves)
}

export function getCandidatePreviewFrame(
  initialFen: string,
  records: MoveRecord[],
  stepIndex: number,
): CandidatePreviewFrame {
  const clampedIndex = Math.max(0, Math.min(stepIndex, records.length))
  const record = clampedIndex > 0 ? records[clampedIndex - 1] : null
  const { board, turn } = parseFen(record?.fen || initialFen)
  return {
    board,
    turn,
    lastMove: record?.move || null,
    notation: record?.notation || '当前局面',
  }
}
