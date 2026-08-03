import { MoveRecord } from '../types'

export function getRepetitionKey(fen: string): string {
  const parts = fen.trim().split(/\s+/)
  return `${parts[0] || ''} ${parts[1] || 'w'}`
}

export function getCurrentRepetitionCount(initialFen: string, records: MoveRecord[]): number {
  const currentFen = records.length > 0 ? records[records.length - 1].fen : initialFen
  const currentKey = getRepetitionKey(currentFen)
  const positions = [initialFen, ...records.map(record => record.fen)]
  return positions.filter(fen => getRepetitionKey(fen) === currentKey).length
}

export function getRepetitionReminder(initialFen: string, records: MoveRecord[]): string {
  const count = getCurrentRepetitionCount(initialFen, records)
  if (count < 2) return ''
  if (count === 2) return '当前局面已第 2 次出现，注意可能进入重复局面。'
  return `当前局面已第 ${count} 次出现，后续可结合长将/长捉规则判断。`
}
