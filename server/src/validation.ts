type PieceColor = 'red' | 'black'
type PieceType = 'k' | 'a' | 'b' | 'n' | 'r' | 'c' | 'p'

type Piece = { type: PieceType; color: PieceColor }
type Board = (Piece | null)[][]

const ROWS = 10
const COLS = 9

const PIECE_MAP: Record<string, Piece> = {
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

const MAX_COUNTS: Record<PieceColor, Record<PieceType, number>> = {
  red: { k: 1, a: 2, b: 2, n: 2, r: 2, c: 2, p: 5 },
  black: { k: 1, a: 2, b: 2, n: 2, r: 2, c: 2, p: 5 },
}

export function validateFenPosition(fen: string): { ok: boolean; errors: string[] } {
  try {
    const board = parseFenBoard(fen)
    const errors: string[] = []
    const counts: Record<PieceColor, Record<PieceType, number>> = {
      red: { k: 0, a: 0, b: 0, n: 0, r: 0, c: 0, p: 0 },
      black: { k: 0, a: 0, b: 0, n: 0, r: 0, c: 0, p: 0 },
    }

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const piece = board[row][col]
        if (!piece) continue

        counts[piece.color][piece.type]++
        if ((piece.type === 'k' || piece.type === 'a') && !isInPalace(row, col, piece.color)) {
          errors.push('King and advisors must stay in palace')
        }
        if (piece.type === 'b' && (piece.color === 'red' ? row < 5 : row > 4)) {
          errors.push('Elephants cannot cross river')
        }
        if (piece.type === 'p' && (piece.color === 'red' ? row > 6 : row < 3)) {
          errors.push('Pawns cannot be behind their starting rank')
        }
      }
    }

    for (const color of ['red', 'black'] as const) {
      if (counts[color].k !== 1) errors.push('Position must contain exactly one king per side')
      for (const type of Object.keys(MAX_COUNTS[color]) as PieceType[]) {
        if (counts[color][type] > MAX_COUNTS[color][type]) {
          errors.push('Piece count exceeds legal maximum')
        }
      }
    }

    if (kingsFace(board)) errors.push('Kings cannot face each other')
    return { ok: errors.length === 0, errors }
  } catch {
    return { ok: false, errors: ['Invalid FEN'] }
  }
}

function parseFenBoard(fen: string): Board {
  const parts = fen.trim().split(/\s+/)
  const rows = parts[0]?.split('/') ?? []
  if (rows.length !== ROWS || (parts[1] !== 'w' && parts[1] !== 'b')) {
    throw new Error('Invalid FEN')
  }

  return rows.map(rowText => {
    const row: (Piece | null)[] = []
    for (const ch of rowText) {
      if (ch >= '1' && ch <= '9') {
        for (let i = 0; i < Number(ch); i++) row.push(null)
      } else {
        const piece = PIECE_MAP[ch]
        if (!piece) throw new Error('Invalid piece')
        row.push(piece)
      }
    }
    if (row.length !== COLS) throw new Error('Invalid row width')
    return row
  })
}

function isInPalace(row: number, col: number, color: PieceColor): boolean {
  const rowOk = color === 'red' ? row >= 7 && row <= 9 : row >= 0 && row <= 2
  return rowOk && col >= 3 && col <= 5
}

function findKing(board: Board, color: PieceColor): { row: number; col: number } | null {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const piece = board[row][col]
      if (piece?.type === 'k' && piece.color === color) return { row, col }
    }
  }
  return null
}

function kingsFace(board: Board): boolean {
  const redKing = findKing(board, 'red')
  const blackKing = findKing(board, 'black')
  if (!redKing || !blackKing || redKing.col !== blackKing.col) return false
  for (let row = blackKing.row + 1; row < redKing.row; row++) {
    if (board[row][redKing.col]) return false
  }
  return true
}
