type PieceColor = 'red' | 'black'
type PieceType = 'k' | 'a' | 'b' | 'n' | 'r' | 'c' | 'p'

type Piece = { type: PieceType; color: PieceColor }
type Board = (Piece | null)[][]
type Position = { row: number; col: number }

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
    const { board } = parseFen(fen)
    return validateBoardPosition(board)
  } catch {
    return { ok: false, errors: ['Invalid FEN'] }
  }
}

export function validateMoveSequence(fen: string, moves: string[]): { ok: boolean; errors: string[] } {
  try {
    let { board, turn } = parseFen(fen)

    for (let index = 0; index < moves.length; index++) {
      const move = moves[index]
      const from = uciToPos(move.slice(0, 2))
      const to = uciToPos(move.slice(2, 4))
      const piece = board[from.row]?.[from.col]

      if (!piece || piece.color !== turn) {
        return { ok: false, errors: [`Illegal move at ${index + 1}: ${move}`] }
      }

      const legalMoves = getLegalMoves(board, from)
      if (!legalMoves.some(target => target.row === to.row && target.col === to.col)) {
        return { ok: false, errors: [`Illegal move at ${index + 1}: ${move}`] }
      }

      board = applyMove(board, from, to)
      turn = turn === 'red' ? 'black' : 'red'
    }

    return { ok: true, errors: [] }
  } catch {
    return { ok: false, errors: ['Invalid move sequence'] }
  }
}

function validateBoardPosition(board: Board): { ok: boolean; errors: string[] } {
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
}

function parseFen(fen: string): { board: Board; turn: PieceColor } {
  const parts = fen.trim().split(/\s+/)
  const rows = parts[0]?.split('/') ?? []
  if (rows.length !== ROWS || (parts[1] !== 'w' && parts[1] !== 'b')) {
    throw new Error('Invalid FEN')
  }

  const board = rows.map(rowText => {
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
  return { board, turn: parts[1] === 'w' ? 'red' : 'black' }
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

function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < ROWS && col >= 0 && col < COLS
}

function isOwnPiece(board: Board, row: number, col: number, color: PieceColor): boolean {
  return board[row][col]?.color === color
}

function uciToPos(uci: string): Position {
  return {
    row: 9 - Number(uci[1]),
    col: uci.charCodeAt(0) - 'a'.charCodeAt(0),
  }
}

function applyMove(board: Board, from: Position, to: Position): Board {
  const next = board.map(row => row.map(piece => piece ? { ...piece } : null))
  next[to.row][to.col] = next[from.row][from.col]
  next[from.row][from.col] = null
  return next
}

function getPseudoMoves(board: Board, pos: Position): Position[] {
  const piece = board[pos.row]?.[pos.col]
  if (!piece) return []

  const moves: Position[] = []
  const { row, col } = pos
  const color = piece.color
  const isRed = color === 'red'

  switch (piece.type) {
    case 'k': {
      const palaceRows = isRed ? [7, 8, 9] : [0, 1, 2]
      const palaceCols = [3, 4, 5]
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nr = row + dr
        const nc = col + dc
        if (palaceRows.includes(nr) && palaceCols.includes(nc) && !isOwnPiece(board, nr, nc, color)) {
          moves.push({ row: nr, col: nc })
        }
      }

      const opponent = findKing(board, isRed ? 'black' : 'red')
      if (opponent?.col === col && !hasPieceBetween(board, row, opponent.row, col)) {
        moves.push({ row: opponent.row, col: opponent.col })
      }
      break
    }

    case 'a': {
      const palaceRows = isRed ? [7, 8, 9] : [0, 1, 2]
      const palaceCols = [3, 4, 5]
      for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nr = row + dr
        const nc = col + dc
        if (palaceRows.includes(nr) && palaceCols.includes(nc) && !isOwnPiece(board, nr, nc, color)) {
          moves.push({ row: nr, col: nc })
        }
      }
      break
    }

    case 'b': {
      const homeSide = isRed ? (r: number) => r >= 5 : (r: number) => r <= 4
      for (const [dr, dc] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
        const nr = row + dr
        const nc = col + dc
        const br = row + dr / 2
        const bc = col + dc / 2
        if (inBounds(nr, nc) && homeSide(nr) && !board[br][bc] && !isOwnPiece(board, nr, nc, color)) {
          moves.push({ row: nr, col: nc })
        }
      }
      break
    }

    case 'n': {
      const jumps: [number, number, number, number][] = [
        [-2, -1, -1, 0], [-2, 1, -1, 0],
        [2, -1, 1, 0], [2, 1, 1, 0],
        [-1, -2, 0, -1], [-1, 2, 0, 1],
        [1, -2, 0, -1], [1, 2, 0, 1],
      ]
      for (const [dr, dc, br, bc] of jumps) {
        const nr = row + dr
        const nc = col + dc
        if (inBounds(nr, nc) && !board[row + br][col + bc] && !isOwnPiece(board, nr, nc, color)) {
          moves.push({ row: nr, col: nc })
        }
      }
      break
    }

    case 'r': {
      addSlidingMoves(board, moves, row, col, color, false)
      break
    }

    case 'c': {
      addSlidingMoves(board, moves, row, col, color, true)
      break
    }

    case 'p': {
      const forward = isRed ? -1 : 1
      const nr = row + forward
      if (inBounds(nr, col) && !isOwnPiece(board, nr, col, color)) {
        moves.push({ row: nr, col })
      }
      const crossedRiver = isRed ? row <= 4 : row >= 5
      if (crossedRiver) {
        for (const dc of [-1, 1]) {
          const nc = col + dc
          if (inBounds(row, nc) && !isOwnPiece(board, row, nc, color)) {
            moves.push({ row, col: nc })
          }
        }
      }
      break
    }
  }

  return moves
}

function addSlidingMoves(board: Board, moves: Position[], row: number, col: number, color: PieceColor, cannon: boolean): void {
  for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    let nr = row + dr
    let nc = col + dc
    let jumped = false
    while (inBounds(nr, nc)) {
      const target = board[nr][nc]
      if (!target) {
        if (!jumped) moves.push({ row: nr, col: nc })
      } else if (!cannon) {
        if (target.color !== color) moves.push({ row: nr, col: nc })
        break
      } else if (!jumped) {
        jumped = true
      } else {
        if (target.color !== color) moves.push({ row: nr, col: nc })
        break
      }
      nr += dr
      nc += dc
    }
  }
}

function getLegalMoves(board: Board, pos: Position): Position[] {
  const piece = board[pos.row]?.[pos.col]
  if (!piece) return []

  return getPseudoMoves(board, pos).filter(to => {
    const next = applyMove(board, pos, to)
    return !isInCheck(next, piece.color)
  })
}

function isInCheck(board: Board, color: PieceColor): boolean {
  const king = findKing(board, color)
  if (!king) return true
  const opponent = color === 'red' ? 'black' : 'red'

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const piece = board[row][col]
      if (piece?.color !== opponent) continue
      if (getPseudoMoves(board, { row, col }).some(pos => pos.row === king.row && pos.col === king.col)) {
        return true
      }
    }
  }

  return false
}

function hasPieceBetween(board: Board, firstRow: number, secondRow: number, col: number): boolean {
  const minRow = Math.min(firstRow, secondRow)
  const maxRow = Math.max(firstRow, secondRow)
  for (let row = minRow + 1; row < maxRow; row++) {
    if (board[row][col]) return true
  }
  return false
}
