import {
  BOARD_CELLS,
  BOARD_SIZE,
  EMPTY,
  type Cell,
  type Move,
  type Player,
  type Position,
} from './types'

export type Board = Int8Array

export function createEmptyBoard(): Board {
  return new Int8Array(BOARD_CELLS)
}

export function cloneBoard(board: Board): Board {
  return new Int8Array(board)
}

export function toIndex(row: number, col: number): number {
  return row * BOARD_SIZE + col
}

export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE
}

export function getCell(board: Board, row: number, col: number): Cell {
  if (!inBounds(row, col)) return EMPTY
  return board[toIndex(row, col)] as Cell
}

export function setCell(board: Board, row: number, col: number, player: Player): boolean {
  if (!inBounds(row, col)) return false
  const idx = toIndex(row, col)
  if (board[idx] !== EMPTY) return false
  board[idx] = player
  return true
}

export function applyMove(board: Board, move: Move): Board {
  const next = cloneBoard(board)
  setCell(next, move.row, move.col, move.player)
  return next
}

export function removeLastMove(board: Board, move: Position): Board {
  const next = cloneBoard(board)
  if (inBounds(move.row, move.col)) {
    next[toIndex(move.row, move.col)] = EMPTY
  }
  return next
}

export function isBoardFull(board: Board): boolean {
  for (let i = 0; i < BOARD_CELLS; i += 1) {
    if (board[i] === EMPTY) return false
  }
  return true
}

export function hasNeighbor(board: Board, row: number, col: number, distance = 2): boolean {
  for (let dr = -distance; dr <= distance; dr += 1) {
    for (let dc = -distance; dc <= distance; dc += 1) {
      if (dr === 0 && dc === 0) continue
      const nr = row + dr
      const nc = col + dc
      if (!inBounds(nr, nc)) continue
      if (getCell(board, nr, nc) !== EMPTY) return true
    }
  }
  return false
}
