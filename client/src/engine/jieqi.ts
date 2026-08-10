import { Board, Move, Piece, PieceColor, PieceType, Position } from '../types'
import { applyMove, cloneBoard, INITIAL_FEN, parseFen } from './board'
import { moveToNotation } from './notation'

export const JIEQI_INITIAL_FEN =
  'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P5N2B2r2a2c2p5n2b2 0 1'

const HIDDEN_POOL: PieceType[] = [
  'r', 'r', 'a', 'a', 'b', 'b', 'n', 'n', 'c', 'c',
  'p', 'p', 'p', 'p', 'p',
]

const PIECE_FEN: Record<PieceType, string> = {
  k: 'K', a: 'A', b: 'B', n: 'N', r: 'R', c: 'C', p: 'P',
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[result[index], result[swapIndex]] = [result[swapIndex], result[index]]
  }
  return result
}

/**
 * 每方除将帅外独立洗牌。真实身份只留在客户端；发送给揭棋引擎的始终是 X/x。
 */
export function createJieqiInitialBoard(random: () => number = Math.random): Board {
  const { board } = parseFen(INITIAL_FEN)
  const pools: Record<PieceColor, PieceType[]> = {
    red: shuffled(HIDDEN_POOL, random),
    black: shuffled(HIDDEN_POOL, random),
  }
  const offsets: Record<PieceColor, number> = { red: 0, black: 0 }

  return board.map(row => row.map(piece => {
    if (!piece || piece.type === 'k') return piece ? { ...piece } : null
    const color = piece.color
    const type = pools[color][offsets[color]++]
    return { color, type, hidden: true, darkType: piece.type }
  }))
}

export function isJieqiPieceHidden(piece: Piece | null | undefined): boolean {
  return Boolean(piece?.hidden)
}

export function getJieqiMovementType(piece: Piece): PieceType {
  return piece.hidden ? piece.darkType || piece.type : piece.type
}

export function applyJieqiMove(board: Board, from: Position, to: Position): {
  newBoard: Board
  captured: Piece | null
  revealed: Piece | null
} {
  const moving = board[from.row][from.col]
  const { newBoard, captured } = applyMove(board, from, to)
  if (!moving) return { newBoard, captured, revealed: null }

  const arrived = newBoard[to.row][to.col]
  let revealed: Piece | null = null
  if (arrived?.hidden) {
    arrived.hidden = false
    delete arrived.darkType
    revealed = { ...arrived }
  }
  return { newBoard, captured, revealed }
}

/**
 * 官方 jieqi 分支用第 5/6 个字符补充本回合才得知的身份：
 * 暗子移动=移动方身份，吃暗子=被吃方身份，两者同时发生则依次附加。
 */
export function encodeJieqiMove(move: Move, includeCapturedIdentity = true): string {
  const file = (col: number) => String.fromCharCode(97 + col)
  const rank = (row: number) => String(9 - row)
  let encoded = `${file(move.from.col)}${rank(move.from.row)}${file(move.to.col)}${rank(move.to.row)}`
  if (move.piece.hidden) encoded += pieceIdentityChar(move.piece)
  if (includeCapturedIdentity && move.captured?.hidden) encoded += pieceIdentityChar(move.captured)
  return encoded
}

/**
 * 暗吃身份只对捕获方可见。不同阵营向引擎请求计算时必须分别构造历史，
 * 不能复用对手视角的扩展 UCI 列表。
 */
export function encodeJieqiHistory(records: Array<{ move: Move }>, viewer: PieceColor): string[] {
  return records.map(record => encodeJieqiMove(
    record.move,
    record.move.piece.color === viewer,
  ))
}

export type JieqiCapturedPieceDisplay = {
  color: PieceColor
  type: PieceType | null
  wasHidden: boolean
}

/**
 * 暗吃的真实身份只返回给捕获方；对手视角只保留一个匿名暗子占位。
 * 这样渲染层拿不到不应展示的 type，避免通过 DOM 属性或辅助文本泄露。
 */
export function getJieqiCapturedPieces(
  records: Array<{ move: Move }>,
  viewer: PieceColor,
): Record<PieceColor, JieqiCapturedPieceDisplay[]> {
  const capturedBy: Record<PieceColor, JieqiCapturedPieceDisplay[]> = { red: [], black: [] }
  for (const record of records) {
    const captured = record.move.captured
    if (!captured) continue
    const capturer = record.move.piece.color
    const identityVisible = !captured.hidden || capturer === viewer
    capturedBy[capturer].push({
      color: captured.color,
      type: identityVisible ? captured.type : null,
      wasHidden: Boolean(captured.hidden),
    })
  }
  return capturedBy
}

export function formatJieqiNotation(board: Board, move: Move, showCapturedIdentity = false): string {
  const publicBoard = board.map(row => row.map(piece => piece?.hidden
    ? { ...piece, type: piece.darkType || piece.type, hidden: false }
    : piece))
  const visiblePiece: Piece = move.piece.hidden
    ? { ...move.piece, type: move.piece.darkType || move.piece.type, hidden: false }
    : move.piece
  const base = moveToNotation(publicBoard, { ...move, piece: visiblePiece })
  const details: string[] = []
  if (move.piece.hidden) {
    const revealed = PIECE_FEN[move.piece.type]
    details.push(`揭${move.piece.color === 'red' ? revealed : revealed.toLowerCase()}`)
  }
  if (showCapturedIdentity && move.captured?.hidden) {
    details.push(`获${pieceIdentityChar(move.captured)}`)
  }
  return details.length > 0 ? `${base}（${details.join(' · ')}）` : base
}

export function cloneJieqiSnapshot(board: Board, turn: PieceColor) {
  return { board: cloneBoard(board), turn }
}

function pieceIdentityChar(piece: Piece): string {
  const char = PIECE_FEN[piece.type]
  return piece.color === 'red' ? char : char.toLowerCase()
}
