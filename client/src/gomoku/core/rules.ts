import { getCell, inBounds, isBoardFull, toIndex } from './board'
import { BLACK, EMPTY, type Player, type Position, type RuleConfig, type WinResult } from './types'
import type { Board } from './board'

const DIRECTIONS: Array<[number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
]

function countInDirection(
  board: Board,
  row: number,
  col: number,
  player: Player,
  dr: number,
  dc: number,
): Position[] {
  const points: Position[] = [{ row, col }]

  let r = row + dr
  let c = col + dc
  while (inBounds(r, c) && getCell(board, r, c) === player) {
    points.push({ row: r, col: c })
    r += dr
    c += dc
  }

  r = row - dr
  c = col - dc
  while (inBounds(r, c) && getCell(board, r, c) === player) {
    points.unshift({ row: r, col: c })
    r -= dr
    c -= dc
  }

  return points
}

type LinePattern = Array<'x' | 'o' | '_' | '#'>

function lineAt(
  board: Board,
  row: number,
  col: number,
  dr: number,
  dc: number,
  radius = 5,
): { pattern: LinePattern; center: number; points: Array<Position | null> } {
  const pattern: LinePattern = []
  const points: Array<Position | null> = []
  let center = 0

  for (let i = -radius; i <= radius; i += 1) {
    const r = row + dr * i
    const c = col + dc * i
    if (i === 0) center = pattern.length

    if (!inBounds(r, c)) {
      pattern.push('#')
      points.push(null)
      continue
    }
    const cell = getCell(board, r, c)
    pattern.push(cell === BLACK ? 'x' : cell === EMPTY ? '_' : 'o')
    points.push({ row: r, col: c })
  }

  return { pattern, center, points }
}

function chainLength(
  board: Board,
  row: number,
  col: number,
  player: Player,
  dr: number,
  dc: number,
): number {
  return countInDirection(board, row, col, player, dr, dc).length
}

function isExactFiveAtMove(board: Board, row: number, col: number): boolean {
  for (const [dr, dc] of DIRECTIONS) {
    if (chainLength(board, row, col, BLACK, dr, dc) === 5) return true
  }
  return false
}

function hasOverlineAtMove(board: Board, row: number, col: number): boolean {
  for (const [dr, dc] of DIRECTIONS) {
    if (chainLength(board, row, col, BLACK, dr, dc) >= 6) return true
  }
  return false
}

function exactFiveRange(pattern: LinePattern, idx: number): { left: number; right: number } | null {
  if (pattern[idx] !== 'x') return null
  let left = idx
  while (left > 0 && pattern[left - 1] === 'x') left -= 1
  let right = idx
  while (right < pattern.length - 1 && pattern[right + 1] === 'x') right += 1
  if (right - left + 1 !== 5) return null
  return { left, right }
}

function canCreateExactFiveIncludingCenter(
  pattern: LinePattern,
  idx: number,
  center: number,
): boolean {
  if (pattern[idx] !== '_') return false
  const temp = [...pattern]
  temp[idx] = 'x'
  const range = exactFiveRange(temp, idx)
  if (!range) return false
  return center >= range.left && center <= range.right
}

function isSingleOpenFour(pattern: LinePattern, points: number[]): boolean {
  if (points.length !== 2) return false
  const sorted = [...points].sort((a, b) => a - b)
  const [a, b] = sorted
  if (b - a !== 5) return false
  if (pattern[a] !== '_' || pattern[b] !== '_') return false
  for (let i = a + 1; i < b; i += 1) {
    if (pattern[i] !== 'x') return false
  }
  return true
}

function collectFourThreatsFromMove(board: Board, row: number, col: number): number {
  let total = 0
  for (const [dr, dc] of DIRECTIONS) {
    const { pattern, center } = lineAt(board, row, col, dr, dc, 5)
    const winningPoints: number[] = []
    for (let i = 0; i < pattern.length; i += 1) {
      if (Math.abs(i - center) > 4) continue
      if (canCreateExactFiveIncludingCenter(pattern, i, center)) {
        winningPoints.push(i)
      }
    }
    if (winningPoints.length === 0) continue
    if (isSingleOpenFour(pattern, winningPoints)) {
      total += 1
      continue
    }
    total += Math.min(2, winningPoints.length)
  }
  return total
}

function hasOpenFourIncluding(
  board: Board,
  row: number,
  col: number,
  dr: number,
  dc: number,
  required: Position[],
): boolean {
  const { pattern, points } = lineAt(board, row, col, dr, dc, 5)
  const requiredIdx: number[] = []
  for (const p of required) {
    const idx = points.findIndex((q) => q?.row === p.row && q?.col === p.col)
    if (idx < 0) return false
    requiredIdx.push(idx)
  }

  for (let i = 0; i <= pattern.length - 6; i += 1) {
    if (pattern[i] !== '_' || pattern[i + 5] !== '_') continue
    if (
      pattern[i + 1] !== 'x' ||
      pattern[i + 2] !== 'x' ||
      pattern[i + 3] !== 'x' ||
      pattern[i + 4] !== 'x'
    )
      continue
    const covered = requiredIdx.every((idx) => idx >= i + 1 && idx <= i + 4)
    if (covered) return true
  }
  return false
}

function isLegalBlackMoveForRenju(
  board: Board,
  row: number,
  col: number,
  config: RuleConfig,
  checking: Set<number>,
): boolean {
  if (!inBounds(row, col)) return false
  if (getCell(board, row, col) !== EMPTY) return false
  const idx = toIndex(row, col)
  board[idx] = BLACK
  const forbidden = isForbiddenMoveInternal(board, row, col, config, checking)
  board[idx] = EMPTY
  return !forbidden
}

function collectOpenThreeThreatsFromMove(
  board: Board,
  row: number,
  col: number,
  config: RuleConfig,
  checking: Set<number>,
): number {
  let total = 0
  for (const [dr, dc] of DIRECTIONS) {
    const { pattern, center, points } = lineAt(board, row, col, dr, dc, 5)
    let hasOpenThreeInThisDirection = false

    for (let i = 0; i < pattern.length; i += 1) {
      if (pattern[i] !== '_' || Math.abs(i - center) > 4) continue
      const p = points[i]
      if (!p) continue
      if (!isLegalBlackMoveForRenju(board, p.row, p.col, config, checking)) continue

      const idx = toIndex(p.row, p.col)
      board[idx] = BLACK
      const hasOpenFour = hasOpenFourIncluding(board, p.row, p.col, dr, dc, [
        { row, col },
        { row: p.row, col: p.col },
      ])
      board[idx] = EMPTY

      if (hasOpenFour) {
        hasOpenThreeInThisDirection = true
        break
      }
    }

    if (hasOpenThreeInThisDirection) total += 1
  }
  return total
}

function isForbiddenMoveInternal(
  board: Board,
  row: number,
  col: number,
  config: RuleConfig,
  checking: Set<number>,
): boolean {
  if (!config.forbiddenEnabled) return false
  if (getCell(board, row, col) !== BLACK) return false

  if (isExactFiveAtMove(board, row, col)) return false
  if (hasOverlineAtMove(board, row, col)) return true

  const totalFours = collectFourThreatsFromMove(board, row, col)
  if (totalFours >= 2) return true

  const posKey = toIndex(row, col)
  if (checking.has(posKey) || checking.size >= 3) return false
  checking.add(posKey)
  const totalThrees = collectOpenThreeThreatsFromMove(board, row, col, config, checking)
  checking.delete(posKey)
  return totalThrees >= 2
}

export function isForbiddenMove(
  board: Board,
  row: number,
  col: number,
  config: RuleConfig,
): boolean {
  return isForbiddenMoveInternal(board, row, col, config, new Set())
}

export function checkWinResult(
  board: Board,
  lastMove: Position,
  player: Player,
  config: RuleConfig,
): WinResult | null {
  if (
    config.forbiddenEnabled &&
    player === BLACK &&
    isForbiddenMove(board, lastMove.row, lastMove.col, config)
  ) {
    return {
      winner: 2,
      line: [{ row: lastMove.row, col: lastMove.col }],
      reason: 'forbidden',
    }
  }

  for (const [dr, dc] of DIRECTIONS) {
    const chain = countInDirection(board, lastMove.row, lastMove.col, player, dr, dc)
    if (!config.forbiddenEnabled || player !== BLACK) {
      if (chain.length >= 5) {
        return { winner: player, line: chain.slice(0, 5), reason: 'five' }
      }
    } else if (chain.length === 5) {
      return { winner: player, line: chain, reason: 'five' }
    }
  }

  return null
}

export function isDraw(board: Board): boolean {
  return isBoardFull(board)
}
