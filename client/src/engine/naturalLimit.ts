import { MoveRecord } from '../types'

export const NATURAL_LIMIT_REMINDER_PLIES = 30

export function countQuietPlies(records: MoveRecord[]): number {
  let count = 0
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].move.captured) break
    count += 1
  }
  return count
}

export function getNaturalLimitReminder(records: MoveRecord[], threshold = NATURAL_LIMIT_REMINDER_PLIES): string {
  const quietPlies = countQuietPlies(records)
  if (quietPlies < threshold) return ''
  return `已连续 ${quietPlies} 手未吃子，注意自然限着风险。`
}
