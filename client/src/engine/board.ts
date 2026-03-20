import { Board, Piece, PieceColor, PieceType, Position } from '../types'

export const ROWS = 10
export const COLS = 9

export const INITIAL_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'

const PIECE_MAP: Record<string, { type: PieceType; color: PieceColor }> = {
  K: { type: 'k', color: 'red' },
  A: { type: 'a', color: 'red' },
  B: { type: 'b', color: 'red' },
  N: { type: 'n', color: 'red' },
  R: { type: 'r', color: 'red' },
  C: { type: 'c', color: 'red' },
  P: { type: 'p', color: 'red' },
  k: { type: 'k', color: 'black' },
  a: { type: 'a', color: 'black' },
  b: { type: 'b', color: 'black' },
  n: { type: 'n', color: 'black' },
  r: { type: 'r', color: 'black' },
  c: { type: 'c', color: 'black' },
  p: { type: 'p', color: 'black' },
}

export function parseFen(fen: string): { board: Board; turn: PieceColor } {
  const parts = fen.split(' ')
  const rows = parts[0].split('/')
  const board: Board = []

  for (let r = 0; r < ROWS; r++) {
    const row: (Piece | null)[] = []
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '9') {
        for (let i = 0; i < parseInt(ch); i++) row.push(null)
      } else {
        const p = PIECE_MAP[ch]
        if (p) row.push({ type: p.type, color: p.color })
        else row.push(null)
      }
    }
    board.push(row)
  }

  const turn: PieceColor = parts[1] === 'b' ? 'black' : 'red'
  return { board, turn }
}

export function boardToFen(board: Board, turn: PieceColor, moveCount = 0): string {
  const rows: string[] = []
  for (let r = 0; r < ROWS; r++) {
    let row = ''
    let empty = 0
    for (let c = 0; c < COLS; c++) {
      const piece = board[r][c]
      if (!piece) {
        empty++
      } else {
        if (empty > 0) { row += empty; empty = 0 }
        row += pieceToFenChar(piece)
      }
    }
    if (empty > 0) row += empty
    rows.push(row)
  }
  return `${rows.join('/')} ${turn === 'red' ? 'w' : 'b'} - - 0 ${moveCount}`
}

function pieceToFenChar(piece: Piece): string {
  const charMap: Record<PieceType, string> = {
    k: 'k', a: 'a', b: 'b', n: 'n', r: 'r', c: 'c', p: 'p',
  }
  const ch = charMap[piece.type]
  return piece.color === 'red' ? ch.toUpperCase() : ch
}

export function cloneBoard(board: Board): Board {
  return board.map(row => row.map(cell => cell ? { ...cell } : null))
}

export function applyMove(board: Board, from: Position, to: Position): { newBoard: Board; captured: Piece | null } {
  const newBoard = cloneBoard(board)
  const captured = newBoard[to.row][to.col]
  newBoard[to.row][to.col] = newBoard[from.row][from.col]
  newBoard[from.row][from.col] = null
  return { newBoard, captured }
}

export function findKing(board: Board, color: PieceColor): Position | null {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = board[r][c]
      if (p && p.type === 'k' && p.color === color) {
        return { row: r, col: c }
      }
    }
  }
  return null
}
