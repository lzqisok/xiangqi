import { GameStatusReason, MoveRecord } from '../types'
import { countQuietPlies } from './naturalLimit'
import { getCurrentRepetitionCount } from './repetition'

export const AUTOMATIC_DRAW_QUIET_PLIES = 120
export const AUTOMATIC_DRAW_MAX_PLIES = 600
export const AUTOMATIC_DRAW_REPETITIONS = 3

export function getAutomaticDrawReason(initialFen: string, records: MoveRecord[]): GameStatusReason | undefined {
  if (getCurrentRepetitionCount(initialFen, records) >= AUTOMATIC_DRAW_REPETITIONS) return 'repetition'
  if (countQuietPlies(records) >= AUTOMATIC_DRAW_QUIET_PLIES) return 'natural-limit'
  if (records.length >= AUTOMATIC_DRAW_MAX_PLIES) return 'move-limit'
  return undefined
}
