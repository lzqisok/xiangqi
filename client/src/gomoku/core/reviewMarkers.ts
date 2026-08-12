import type { Move } from './types'

const BOARD_SIZE = 15

export function buildMoveOrderMap(moveHistory: Move[]): Map<number, number> {
  const result = new Map<number, number>()
  moveHistory.forEach((move, index) => {
    result.set(move.row * BOARD_SIZE + move.col, index + 1)
  })
  return result
}
