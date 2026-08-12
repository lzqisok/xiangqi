import { BLACK, EMPTY, WHITE, type Player, type Position } from '../core/types'
import type { Board } from '../core/board'

function countStones(board: Board): number {
  let c = 0
  for (let i = 0; i < board.length; i += 1) {
    if (board[i] !== EMPTY) c += 1
  }
  return c
}

function occupied(board: Board, row: number, col: number): boolean {
  return board[row * 15 + col] !== EMPTY
}

export function getOpeningMove(board: Board): Position | null {
  return getOpeningMoveForMode(board, BLACK, false)
}

function getOpeningMoveForMode(board: Board, currentPlayer: Player, forbiddenEnabled: boolean): Position | null {
  const stones = countStones(board)
  if (stones === 0) return { row: 7, col: 7 }

  if (stones === 1) {
    const whiteReplyFreestyle: Position[] = [
      { row: 7, col: 8 },
      { row: 8, col: 7 },
      { row: 7, col: 6 },
      { row: 6, col: 7 },
      { row: 8, col: 8 },
      { row: 6, col: 6 },
      { row: 6, col: 8 },
      { row: 8, col: 6 },
    ]
    const whiteReplyRenju: Position[] = [
      { row: 7, col: 8 },
      { row: 8, col: 7 },
      { row: 6, col: 7 },
      { row: 7, col: 6 },
      { row: 6, col: 8 },
      { row: 8, col: 6 },
      { row: 6, col: 6 },
      { row: 8, col: 8 },
    ]
    const preferred = forbiddenEnabled && currentPlayer === WHITE ? whiteReplyRenju : whiteReplyFreestyle
    for (const p of preferred) {
      if (!occupied(board, p.row, p.col)) return p
    }
  }

  if (stones === 2) {
    const blackThirdFreestyle: Position[] = [
      { row: 7, col: 5 },
      { row: 5, col: 7 },
      { row: 9, col: 7 },
      { row: 7, col: 9 },
      { row: 6, col: 8 },
      { row: 8, col: 6 },
      { row: 6, col: 6 },
      { row: 8, col: 8 },
    ]
    const blackThirdRenju: Position[] = [
      { row: 6, col: 8 },
      { row: 8, col: 6 },
      { row: 6, col: 6 },
      { row: 8, col: 8 },
      { row: 7, col: 5 },
      { row: 5, col: 7 },
      { row: 9, col: 7 },
      { row: 7, col: 9 },
    ]
    const preferred = forbiddenEnabled && currentPlayer === BLACK ? blackThirdRenju : blackThirdFreestyle
    for (const p of preferred) {
      if (!occupied(board, p.row, p.col)) return p
    }
  }

  return null
}

export function getOpeningMoveWithConfig(board: Board, currentPlayer: Player, forbiddenEnabled: boolean): Position | null {
  return getOpeningMoveForMode(board, currentPlayer, forbiddenEnabled)
}
