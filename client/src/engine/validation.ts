import { Board, PieceColor, PieceType } from '../types'
import { COLS, ROWS, findKing, parseFen } from './board'

export interface PositionValidationResult {
  ok: boolean
  errors: string[]
  warnings: string[]
}

const MAX_COUNTS: Record<PieceColor, Record<PieceType, number>> = {
  red: { k: 1, a: 2, b: 2, n: 2, r: 2, c: 2, p: 5 },
  black: { k: 1, a: 2, b: 2, n: 2, r: 2, c: 2, p: 5 },
}

function isInPalace(row: number, col: number, color: PieceColor): boolean {
  const palaceRows = color === 'red' ? row >= 7 && row <= 9 : row >= 0 && row <= 2
  return palaceRows && col >= 3 && col <= 5
}

function kingsFace(board: Board): boolean {
  const redKing = findKing(board, 'red')
  const blackKing = findKing(board, 'black')
  if (!redKing || !blackKing || redKing.col !== blackKing.col) return false

  const minRow = Math.min(redKing.row, blackKing.row)
  const maxRow = Math.max(redKing.row, blackKing.row)
  for (let row = minRow + 1; row < maxRow; row++) {
    if (board[row][redKing.col]) return false
  }
  return true
}

export function validateBoardPosition(board: Board): PositionValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const counts: Record<PieceColor, Record<PieceType, number>> = {
    red: { k: 0, a: 0, b: 0, n: 0, r: 0, c: 0, p: 0 },
    black: { k: 0, a: 0, b: 0, n: 0, r: 0, c: 0, p: 0 },
  }

  if (board.length !== ROWS || board.some(row => row.length !== COLS)) {
    errors.push('棋盘尺寸必须是 10x9')
    return { ok: false, errors, warnings }
  }

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const piece = board[row][col]
      if (!piece) continue

      counts[piece.color][piece.type]++

      if (piece.type === 'k' && !isInPalace(row, col, piece.color)) {
        errors.push(`${piece.color === 'red' ? '红帅' : '黑将'}必须在九宫内`)
      }

      if (piece.type === 'a' && !isInPalace(row, col, piece.color)) {
        errors.push(`${piece.color === 'red' ? '红仕' : '黑士'}必须在九宫内`)
      }

      if (piece.type === 'b') {
        const validHomeSide = piece.color === 'red' ? row >= 5 : row <= 4
        if (!validHomeSide) {
          errors.push(`${piece.color === 'red' ? '红相' : '黑象'}不能过河`)
        }
      }

      if (piece.type === 'p') {
        const behindStart = piece.color === 'red' ? row > 6 : row < 3
        if (behindStart) {
          errors.push(`${piece.color === 'red' ? '红兵' : '黑卒'}不能出现在己方底线后方`)
        }
      }
    }
  }

  for (const color of ['red', 'black'] as const) {
    const kingName = color === 'red' ? '红帅' : '黑将'
    if (counts[color].k !== 1) {
      errors.push(`必须且只能有一个${kingName}`)
    }

    for (const type of Object.keys(MAX_COUNTS[color]) as PieceType[]) {
      if (counts[color][type] > MAX_COUNTS[color][type]) {
        errors.push(`${color === 'red' ? '红方' : '黑方'}${type}数量超过上限`)
      }
    }
  }

  if (kingsFace(board)) {
    errors.push('将帅不能直接照面')
  }

  return { ok: errors.length === 0, errors, warnings }
}

export function validateFenPosition(fen: string): PositionValidationResult {
  try {
    const { board } = parseFen(fen.trim())
    return validateBoardPosition(board)
  } catch {
    return { ok: false, errors: ['FEN 格式无效'], warnings: [] }
  }
}
