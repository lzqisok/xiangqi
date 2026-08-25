import { GameStatus, GameStatusReason, MoveRecord } from '../types'
import { countQuietPlies } from './naturalLimit'
import { getCurrentRepetitionCount } from './repetition'
import { analyzeRepetitionCase } from './repetitionAdjudication'

export const AUTOMATIC_DRAW_QUIET_PLIES = 120
export const AUTOMATIC_DRAW_MAX_PLIES = 600
export const AUTOMATIC_DRAW_REPETITIONS = 3

export type AutomaticGameStatus = {
  status: Exclude<GameStatus, 'playing'>
  reason: GameStatusReason
}

export function getAutomaticGameStatus(
  initialFen: string,
  records: MoveRecord[],
): AutomaticGameStatus | undefined {
  if (getCurrentRepetitionCount(initialFen, records) >= AUTOMATIC_DRAW_REPETITIONS) {
    const adjudication = analyzeRepetitionCase(initialFen, records)
    if (adjudication.kind === 'adjudicated') {
      return { status: adjudication.outcome, reason: 'repetition' }
    }
  }
  if (countQuietPlies(records) >= AUTOMATIC_DRAW_QUIET_PLIES)
    return { status: 'draw', reason: 'natural-limit' }
  if (records.length >= AUTOMATIC_DRAW_MAX_PLIES)
    return { status: 'draw', reason: 'move-limit' }
  return undefined
}
