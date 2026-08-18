import { GomokuRoomBoard, RoomColor, RoomMove, RoomStatus, RoomStatusReason } from './types.js'

const SIZE = 15
const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const

export type RebuiltGomokuRoom = { board: GomokuRoomBoard; turn: RoomColor }

export function emptyGomokuBoard(): GomokuRoomBoard {
  return Array.from({ length: SIZE }, () => Array<RoomColor | null>(SIZE).fill(null))
}

function inside(row: number, col: number) {
  return row >= 0 && row < SIZE && col >= 0 && col < SIZE
}

function chain(
  board: GomokuRoomBoard,
  row: number,
  col: number,
  color: RoomColor,
  dr: number,
  dc: number,
) {
  const points = [{ row, col }]
  for (let r = row + dr, c = col + dc; inside(r, c) && board[r][c] === color; r += dr, c += dc)
    points.push({ row: r, col: c })
  for (let r = row - dr, c = col - dc; inside(r, c) && board[r][c] === color; r -= dr, c -= dc)
    points.unshift({ row: r, col: c })
  return points
}

type LinePattern = Array<'x' | 'o' | '_' | '#'>
function key(row: number, col: number) {
  return row * SIZE + col
}
function lineAt(board: GomokuRoomBoard, row: number, col: number, dr: number, dc: number) {
  const pattern: LinePattern = [],
    points: Array<{ row: number; col: number } | null> = []
  let center = 0
  for (let offset = -5; offset <= 5; offset++) {
    const r = row + dr * offset,
      c = col + dc * offset
    if (offset === 0) center = pattern.length
    if (!inside(r, c)) {
      pattern.push('#')
      points.push(null)
      continue
    }
    pattern.push(board[r][c] === 'red' ? 'x' : board[r][c] === null ? '_' : 'o')
    points.push({ row: r, col: c })
  }
  return { pattern, points, center }
}
function exactFiveRange(pattern: LinePattern, index: number) {
  if (pattern[index] !== 'x') return null
  let left = index,
    right = index
  while (left > 0 && pattern[left - 1] === 'x') left--
  while (right < pattern.length - 1 && pattern[right + 1] === 'x') right++
  return right - left + 1 === 5 ? { left, right } : null
}
function canCreateExactFive(pattern: LinePattern, index: number, center: number) {
  if (pattern[index] !== '_') return false
  const next = [...pattern]
  next[index] = 'x'
  const range = exactFiveRange(next, index)
  return Boolean(range && center >= range.left && center <= range.right)
}
function isSingleOpenFour(pattern: LinePattern, points: number[]) {
  if (points.length !== 2) return false
  const [left, right] = [...points].sort((a, b) => a - b)
  if (right - left !== 5 || pattern[left] !== '_' || pattern[right] !== '_') return false
  for (let index = left + 1; index < right; index++) if (pattern[index] !== 'x') return false
  return true
}
function collectFourThreats(board: GomokuRoomBoard, row: number, col: number) {
  let total = 0
  for (const [dr, dc] of DIRECTIONS) {
    const { pattern, center } = lineAt(board, row, col, dr, dc)
    const wins: number[] = []
    for (let index = 0; index < pattern.length; index++)
      if (Math.abs(index - center) <= 4 && canCreateExactFive(pattern, index, center))
        wins.push(index)
    if (wins.length) total += isSingleOpenFour(pattern, wins) ? 1 : Math.min(2, wins.length)
  }
  return total
}
function hasOpenFourIncluding(
  board: GomokuRoomBoard,
  row: number,
  col: number,
  dr: number,
  dc: number,
  required: Array<{ row: number; col: number }>,
) {
  const { pattern, points } = lineAt(board, row, col, dr, dc)
  const requiredIndexes = required.map((point) =>
    points.findIndex((candidate) => candidate?.row === point.row && candidate?.col === point.col),
  )
  if (requiredIndexes.some((index) => index < 0)) return false
  for (let index = 0; index <= pattern.length - 6; index++) {
    if (pattern[index] !== '_' || pattern[index + 5] !== '_') continue
    if (
      pattern.slice(index + 1, index + 5).every((cell) => cell === 'x') &&
      requiredIndexes.every(
        (requiredIndex) => requiredIndex >= index + 1 && requiredIndex <= index + 4,
      )
    )
      return true
  }
  return false
}
function legalBlackExtension(
  board: GomokuRoomBoard,
  row: number,
  col: number,
  checking: Set<number>,
) {
  if (!inside(row, col) || board[row][col] !== null) return false
  board[row][col] = 'red'
  const forbidden = isForbiddenInternal(board, row, col, checking)
  board[row][col] = null
  return !forbidden
}
function collectOpenThreeThreats(
  board: GomokuRoomBoard,
  row: number,
  col: number,
  checking: Set<number>,
) {
  let total = 0
  for (const [dr, dc] of DIRECTIONS) {
    const { pattern, center, points } = lineAt(board, row, col, dr, dc)
    let found = false
    for (let index = 0; index < pattern.length; index++) {
      if (pattern[index] !== '_' || Math.abs(index - center) > 4) continue
      const point = points[index]
      if (!point || !legalBlackExtension(board, point.row, point.col, checking)) continue
      board[point.row][point.col] = 'red'
      const open = hasOpenFourIncluding(board, point.row, point.col, dr, dc, [{ row, col }, point])
      board[point.row][point.col] = null
      if (open) {
        found = true
        break
      }
    }
    if (found) total++
  }
  return total
}
function isForbiddenInternal(
  board: GomokuRoomBoard,
  row: number,
  col: number,
  checking: Set<number>,
) {
  if (board[row][col] !== 'red') return false
  const lengths = DIRECTIONS.map(([dr, dc]) => chain(board, row, col, 'red', dr, dc).length)
  if (lengths.includes(5)) return false
  if (lengths.some((length) => length > 5) || collectFourThreats(board, row, col) >= 2) return true
  const positionKey = key(row, col)
  if (checking.has(positionKey) || checking.size >= 3) return false
  checking.add(positionKey)
  const threes = collectOpenThreeThreats(board, row, col, checking)
  checking.delete(positionKey)
  return threes >= 2
}
export function isGomokuForbiddenMove(board: GomokuRoomBoard, row: number, col: number) {
  return isForbiddenInternal(board, row, col, new Set())
}

function result(
  board: GomokuRoomBoard,
  row: number,
  col: number,
  color: RoomColor,
  renju: boolean,
): { status: RoomStatus; reason?: RoomStatusReason } {
  for (const [dr, dc] of DIRECTIONS) {
    const length = chain(board, row, col, color, dr, dc).length
    if (color === 'red' && renju ? length === 5 : length >= 5)
      return { status: color === 'red' ? 'red-wins' : 'black-wins', reason: 'five' }
  }
  return board.every((line) => line.every(Boolean))
    ? { status: 'draw', reason: 'full-board' }
    : { status: 'playing' }
}

export function rebuildGomokuRoom(moves: RoomMove[]): RebuiltGomokuRoom {
  const board = emptyGomokuBoard()
  for (const [index, move] of moves.entries()) {
    const expectedColor: RoomColor = index % 2 === 0 ? 'red' : 'black'
    const expectedCode =
      Number.isInteger(move.row) && Number.isInteger(move.col)
        ? `${String.fromCharCode(97 + move.col!)}${String.fromCharCode(97 + move.row!)}`
        : ''
    if (
      move.color !== expectedColor ||
      move.uci !== expectedCode ||
      !Number.isInteger(move.row) ||
      !Number.isInteger(move.col) ||
      !inside(move.row!, move.col!) ||
      board[move.row!][move.col!]
    )
      throw new Error('五子棋记录无效')
    board[move.row!][move.col!] = move.color
  }
  return { board, turn: moves.length % 2 === 0 ? 'red' : 'black' }
}

export function executeGomokuMove(
  rebuilt: RebuiltGomokuRoom,
  moves: RoomMove[],
  row: number,
  col: number,
  color: RoomColor,
  rule: 'freestyle' | 'renju',
) {
  if (!inside(row, col)) throw new Error('落子位置无效')
  if (rebuilt.turn !== color) throw new Error('尚未轮到当前棋手')
  if (rebuilt.board[row][col]) throw new Error('该位置已有棋子')
  const board = rebuilt.board.map((line) => [...line])
  board[row][col] = color
  if (rule === 'renju' && color === 'red' && isGomokuForbiddenMove(board, row, col))
    throw new Error('该位置为黑方禁手')
  const move: RoomMove = {
    uci: `${String.fromCharCode(97 + col)}${String.fromCharCode(97 + row)}`,
    color,
    row,
    col,
    notation: `${String.fromCharCode(65 + col)}${row + 1}`,
  }
  return {
    board,
    turn: color === 'red' ? ('black' as const) : ('red' as const),
    move,
    detail: result(board, row, col, color, rule === 'renju'),
    moves: [...moves, move],
  }
}
