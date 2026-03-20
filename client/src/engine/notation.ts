import { Board, Move, Piece, PieceColor, Position } from '../types'

const COL_NAMES_RED = ['九', '八', '七', '六', '五', '四', '三', '二', '一']
const COL_NAMES_BLACK = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

const PIECE_NAMES_RED: Record<string, string> = {
  k: '帅', a: '仕', b: '相', n: '马', r: '车', c: '炮', p: '兵',
}
const PIECE_NAMES_BLACK: Record<string, string> = {
  k: '将', a: '士', b: '象', n: '馬', r: '車', c: '砲', p: '卒',
}

export function moveToNotation(board: Board, move: Move): string {
  const { piece, from, to } = move
  const isRed = piece.color === 'red'

  const pieceName = isRed ? PIECE_NAMES_RED[piece.type] : PIECE_NAMES_BLACK[piece.type]
  const colNames = isRed ? COL_NAMES_RED : COL_NAMES_BLACK
  const fromCol = colNames[from.col]

  // Handle duplicate pieces in same column
  const prefix = getDuplicatePrefix(board, piece, from, isRed) || (pieceName + fromCol)

  const dr = to.row - from.row
  const forward = isRed ? -1 : 1

  let action: string
  let target: string

  if (dr === 0) {
    action = '平'
    target = colNames[to.col]
  } else if (dr * forward > 0) {
    action = '进'
    if (piece.type === 'n' || piece.type === 'a' || piece.type === 'b') {
      target = colNames[to.col]
    } else {
      target = isRed ? numToChinese(Math.abs(dr)) : String(Math.abs(dr))
    }
  } else {
    action = '退'
    if (piece.type === 'n' || piece.type === 'a' || piece.type === 'b') {
      target = colNames[to.col]
    } else {
      target = isRed ? numToChinese(Math.abs(dr)) : String(Math.abs(dr))
    }
  }

  return prefix + action + target
}

function getDuplicatePrefix(board: Board, piece: Piece, from: Position, isRed: boolean): string | null {
  if (piece.type === 'a' || piece.type === 'b' || piece.type === 'k') return null

  const sameTypeSameCol: Position[] = []
  for (let r = 0; r < 10; r++) {
    const p = board[r][from.col]
    if (p && p.type === piece.type && p.color === piece.color) {
      sameTypeSameCol.push({ row: r, col: from.col })
    }
  }

  if (sameTypeSameCol.length <= 1) return null

  const pieceName = isRed ? PIECE_NAMES_RED[piece.type] : PIECE_NAMES_BLACK[piece.type]
  const forward = isRed ? -1 : 1
  const sorted = [...sameTypeSameCol].sort((a, b) => (a.row - b.row) * forward)

  if (sameTypeSameCol.length === 2) {
    const idx = sorted.findIndex(p => p.row === from.row && p.col === from.col)
    return (idx === 0 ? '前' : '后') + pieceName
  }

  const colNames = isRed ? COL_NAMES_RED : COL_NAMES_BLACK
  return pieceName + colNames[from.col]
}

function numToChinese(n: number): string {
  const map = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  return map[n] || String(n)
}

export function posToUci(pos: Position): string {
  const col = String.fromCharCode('a'.charCodeAt(0) + pos.col)
  return `${col}${pos.row}`
}

export function uciToPos(uci: string): Position {
  const col = uci.charCodeAt(0) - 'a'.charCodeAt(0)
  const row = parseInt(uci[1])
  return { row, col }
}

export function moveToUci(from: Position, to: Position): string {
  return posToUci(from) + posToUci(to)
}

export function uciToMove(uci: string): { from: Position; to: Position } {
  return {
    from: uciToPos(uci.substring(0, 2)),
    to: uciToPos(uci.substring(2, 4)),
  }
}

export function getPieceDisplayName(piece: Piece): string {
  return piece.color === 'red' ? PIECE_NAMES_RED[piece.type] : PIECE_NAMES_BLACK[piece.type]
}
