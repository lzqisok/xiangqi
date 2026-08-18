import { EMPTY, BLACK, WHITE, type Player } from '../core/types'
import type { Board } from '../core/board'

const DIRECTIONS: Array<[number, number]> = [
  [0, 1], // Horizontal
  [1, 0], // Vertical
  [1, 1], // Diagonal \
  [1, -1], // Diagonal /
]

const BOARD_SIZE = 15
const OPPONENT_WEIGHT = 1.18
const FORBIDDEN_RISK_PENALTY = 1_600_000

type ThreatLevel = 'none' | 'open-three' | 'blocked-four' | 'open-four' | 'five'

export interface MoveThreat {
  level: ThreatLevel
  openFour: number
  blockedFour: number
  openThree: number
}

interface FeatureCount {
  five: number
  openFour: number
  blockedFour: number
  openThree: number
  brokenThree: number
  openTwo: number
  blockedTwo: number
}

type Phase = 'opening' | 'midgame' | 'endgame'

const FEATURE_WEIGHT = {
  five: 1_000_000_000,
  openFour: 3_000_000,
  blockedFour: 850_000,
  openThree: 90_000,
  brokenThree: 30_000,
  openTwo: 4_000,
  blockedTwo: 1_000,
}

function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE
}

function cellAt(board: Board, row: number, col: number): number {
  if (!inBounds(row, col)) return -1
  return board[row * BOARD_SIZE + col]
}

function countConsecutive(
  board: Board,
  row: number,
  col: number,
  player: Player,
  dr: number,
  dc: number,
): number {
  let count = 1
  let r = row + dr
  let c = col + dc
  while (inBounds(r, c) && cellAt(board, r, c) === player) {
    count += 1
    r += dr
    c += dc
  }
  r = row - dr
  c = col - dc
  while (inBounds(r, c) && cellAt(board, r, c) === player) {
    count += 1
    r -= dr
    c -= dc
  }
  return count
}

function lineToChars(
  board: Board,
  row: number,
  col: number,
  dr: number,
  dc: number,
  radius = 5,
): { chars: string[]; center: number } {
  const chars: string[] = []
  let center = 0
  for (let i = -radius; i <= radius; i += 1) {
    const r = row + dr * i
    const c = col + dc * i
    if (i === 0) center = chars.length
    if (!inBounds(r, c)) chars.push('#')
    else {
      const v = cellAt(board, r, c)
      chars.push(v === EMPTY ? '_' : v === BLACK ? 'x' : 'o')
    }
  }
  return { chars, center }
}

function scoreFeaturesByPhase(feature: FeatureCount, phase: Phase): number {
  const phaseMul =
    phase === 'opening'
      ? {
          openFour: 0.95,
          blockedFour: 0.95,
          openThree: 1.15,
          brokenThree: 1.1,
          openTwo: 1.2,
          blockedTwo: 1.1,
        }
      : phase === 'endgame'
        ? {
            openFour: 1.12,
            blockedFour: 1.12,
            openThree: 0.95,
            brokenThree: 0.92,
            openTwo: 0.85,
            blockedTwo: 0.85,
          }
        : {
            openFour: 1,
            blockedFour: 1,
            openThree: 1,
            brokenThree: 1,
            openTwo: 1,
            blockedTwo: 1,
          }

  let score = 0
  score += feature.five * FEATURE_WEIGHT.five
  score += feature.openFour * FEATURE_WEIGHT.openFour * phaseMul.openFour
  score += feature.blockedFour * FEATURE_WEIGHT.blockedFour * phaseMul.blockedFour
  score += feature.openThree * FEATURE_WEIGHT.openThree * phaseMul.openThree
  score += feature.brokenThree * FEATURE_WEIGHT.brokenThree * phaseMul.brokenThree
  score += feature.openTwo * FEATURE_WEIGHT.openTwo * phaseMul.openTwo
  score += feature.blockedTwo * FEATURE_WEIGHT.blockedTwo * phaseMul.blockedTwo
  if (feature.openThree >= 2) score += 250_000
  if (feature.blockedFour >= 1 && feature.openThree >= 1) score += 400_000
  if (feature.openFour >= 1) score += 2_000_000
  return score
}

function emptyFeature(): FeatureCount {
  return {
    five: 0,
    openFour: 0,
    blockedFour: 0,
    openThree: 0,
    brokenThree: 0,
    openTwo: 0,
    blockedTwo: 0,
  }
}

function scanLineGaps(
  board: Board,
  r0: number,
  c0: number,
  dr: number,
  dc: number,
  len: number,
  player: Player,
  out: FeatureCount,
): void {
  if (len < 5) return
  const a: number[] = new Array(len + 2)
  a[0] = -1
  for (let i = 0; i < len; i += 1) {
    const v = cellAt(board, r0 + dr * i, c0 + dc * i)
    a[i + 1] = v === player ? 1 : v === EMPTY ? 0 : -1
  }
  a[len + 1] = -1
  const n = a.length

  for (let i = 1; i <= n - 6; i += 1) {
    if (a[i - 1] === 1 || a[i + 5] === 1) continue
    if (
      (a[i] === 1 && a[i + 1] === 0 && a[i + 2] === 1 && a[i + 3] === 1 && a[i + 4] === 1) ||
      (a[i] === 1 && a[i + 1] === 1 && a[i + 2] === 0 && a[i + 3] === 1 && a[i + 4] === 1) ||
      (a[i] === 1 && a[i + 1] === 1 && a[i + 2] === 1 && a[i + 3] === 0 && a[i + 4] === 1)
    ) {
      out.blockedFour += 1
    }
  }

  for (let i = 0; i <= n - 6; i += 1) {
    if (
      (a[i] === 0 &&
        a[i + 1] === 1 &&
        a[i + 2] === 0 &&
        a[i + 3] === 1 &&
        a[i + 4] === 1 &&
        a[i + 5] === 0) ||
      (a[i] === 0 &&
        a[i + 1] === 1 &&
        a[i + 2] === 1 &&
        a[i + 3] === 0 &&
        a[i + 4] === 1 &&
        a[i + 5] === 0)
    ) {
      out.openThree += 1
    }
  }
}

function scanAllLinesForGaps(board: Board, player: Player, out: FeatureCount): void {
  for (let r = 0; r < BOARD_SIZE; r += 1) {
    scanLineGaps(board, r, 0, 0, 1, BOARD_SIZE, player, out)
  }
  for (let c = 0; c < BOARD_SIZE; c += 1) {
    scanLineGaps(board, 0, c, 1, 0, BOARD_SIZE, player, out)
  }
  for (let c = 0; c <= BOARD_SIZE - 5; c += 1) {
    scanLineGaps(board, 0, c, 1, 1, BOARD_SIZE - c, player, out)
  }
  for (let r = 1; r <= BOARD_SIZE - 5; r += 1) {
    scanLineGaps(board, r, 0, 1, 1, BOARD_SIZE - r, player, out)
  }
  for (let c = 4; c < BOARD_SIZE; c += 1) {
    scanLineGaps(board, 0, c, 1, -1, c + 1, player, out)
  }
  for (let r = 1; r <= BOARD_SIZE - 5; r += 1) {
    scanLineGaps(board, r, BOARD_SIZE - 1, 1, -1, BOARD_SIZE - r, player, out)
  }
}

function collectRunFeatures(board: Board, player: Player): FeatureCount {
  const out = emptyFeature()
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (cellAt(board, row, col) !== player) continue
      for (const [dr, dc] of DIRECTIONS) {
        const pr = row - dr
        const pc = col - dc
        if (inBounds(pr, pc) && cellAt(board, pr, pc) === player) continue
        let len = 0
        let r = row
        let c = col
        while (inBounds(r, c) && cellAt(board, r, c) === player) {
          len += 1
          r += dr
          c += dc
        }
        const leftEmpty = inBounds(pr, pc) && cellAt(board, pr, pc) === EMPTY
        const rightEmpty = inBounds(r, c) && cellAt(board, r, c) === EMPTY
        const open = Number(leftEmpty) + Number(rightEmpty)

        if (len >= 5) out.five += 1
        else if (len === 4) {
          if (open === 2) out.openFour += 1
          else if (open === 1) out.blockedFour += 1
        } else if (len === 3) {
          if (open === 2) out.openThree += 1
          else if (open === 1) out.brokenThree += 1
        } else if (len === 2) {
          if (open === 2) out.openTwo += 1
          else if (open === 1) out.blockedTwo += 1
        }
      }
    }
  }

  scanAllLinesForGaps(board, player, out)
  return out
}

function countStones(board: Board): number {
  let count = 0
  for (let i = 0; i < board.length; i += 1) {
    if (board[i] !== EMPTY) count += 1
  }
  return count
}

function phaseByStones(stones: number): Phase {
  if (stones < 14) return 'opening'
  if (stones < 40) return 'midgame'
  return 'endgame'
}

function countOpenThreeAtMove(board: Board, row: number, col: number, player: Player): number {
  let total = 0
  for (const [dr, dc] of DIRECTIONS) {
    const { chars, center } = lineToChars(board, row, col, dr, dc, 5)
    let found = false
    for (let i = 0; i < chars.length; i += 1) {
      if (chars[i] !== '_' || Math.abs(i - center) > 4) continue
      const temp = [...chars]
      temp[i] = player === BLACK ? 'x' : 'o'
      for (let j = 1; j <= temp.length - 5; j += 1) {
        if (
          temp[j - 1] === '_' &&
          temp[j + 4] === '_' &&
          temp[j] === temp[i] &&
          temp[j + 1] === temp[i] &&
          temp[j + 2] === temp[i] &&
          temp[j + 3] === temp[i] &&
          center >= j &&
          center <= j + 3 &&
          i >= j &&
          i <= j + 3
        ) {
          found = true
          break
        }
      }
      if (found) break
    }
    if (found) total += 1
  }
  return total
}

export function evaluateMoveThreat(
  board: Board,
  row: number,
  col: number,
  player: Player,
): MoveThreat {
  const idx = row * BOARD_SIZE + col
  const original = board[idx]
  board[idx] = player

  let openFour = 0
  let blockedFour = 0
  for (const [dr, dc] of DIRECTIONS) {
    let forward = 0
    let r = row + dr
    let c = col + dc
    while (inBounds(r, c) && cellAt(board, r, c) === player) {
      forward += 1
      r += dr
      c += dc
    }
    const forwardOpen = inBounds(r, c) && cellAt(board, r, c) === EMPTY

    let backward = 0
    r = row - dr
    c = col - dc
    while (inBounds(r, c) && cellAt(board, r, c) === player) {
      backward += 1
      r -= dr
      c -= dc
    }
    const backwardOpen = inBounds(r, c) && cellAt(board, r, c) === EMPTY

    const len = 1 + forward + backward
    const open = Number(forwardOpen) + Number(backwardOpen)
    if (len === 4) {
      if (open === 2) openFour += 1
      else if (open === 1) blockedFour += 1
    }

    if (len < 4) {
      for (let off = -4; off <= 0; off += 1) {
        let sc = 0,
          gc = 0,
          ig = false,
          ok = true
        for (let j = 0; j < 5; j += 1) {
          const pr = row + dr * (off + j)
          const pc = col + dc * (off + j)
          if (!inBounds(pr, pc)) {
            ok = false
            break
          }
          const v = cellAt(board, pr, pc)
          if (v === player) sc += 1
          else if (v === EMPTY) {
            gc += 1
            if (j > 0 && j < 4) ig = true
          } else {
            ok = false
            break
          }
        }
        if (!ok || sc !== 4 || gc !== 1 || !ig) continue
        const lr = row + dr * (off - 1),
          lc = col + dc * (off - 1)
        const rr = row + dr * (off + 5),
          rc = col + dc * (off + 5)
        if (inBounds(lr, lc) && cellAt(board, lr, lc) === player) continue
        if (inBounds(rr, rc) && cellAt(board, rr, rc) === player) continue
        blockedFour += 1
        break
      }
    }
  }

  const openThree = countOpenThreeAtMove(board, row, col, player)
  let level: ThreatLevel = 'none'
  if (DIRECTIONS.some(([dr, dc]) => countConsecutive(board, row, col, player, dr, dc) >= 5))
    level = 'five'
  else if (openFour > 0) level = 'open-four'
  else if (blockedFour > 0) level = 'blocked-four'
  else if (openThree > 0) level = 'open-three'

  board[idx] = original
  return { level, openFour, blockedFour, openThree }
}

export function evaluateBoard(board: Board, perspective: Player): number {
  const opp = perspective === BLACK ? WHITE : BLACK
  const phase = phaseByStones(countStones(board))
  const selfFeature = collectRunFeatures(board, perspective)
  const oppFeature = collectRunFeatures(board, opp)
  const selfScore = scoreFeaturesByPhase(selfFeature, phase)
  const oppScore = scoreFeaturesByPhase(oppFeature, phase)
  return selfScore - oppScore * OPPONENT_WEIGHT
}

function getAffectedScoreForPlayer(
  board: Board,
  _row: number,
  _col: number,
  player: Player,
): number {
  const phase = phaseByStones(countStones(board))
  return scoreFeaturesByPhase(collectRunFeatures(board, player), phase)
}

export function evaluateMove(board: Board, row: number, col: number, player: Player): number {
  const opp = player === BLACK ? WHITE : BLACK
  const idx = row * 15 + col
  const original = board[idx]

  // Attack value
  board[idx] = player
  const meAfter = getAffectedScoreForPlayer(board, row, col, player)
  board[idx] = EMPTY
  const meBefore = getAffectedScoreForPlayer(board, row, col, player)
  const meAttack = meAfter - meBefore

  // Defense value
  board[idx] = opp
  const oppAfter = getAffectedScoreForPlayer(board, row, col, opp)
  board[idx] = EMPTY
  const oppBefore = getAffectedScoreForPlayer(board, row, col, opp)
  const oppAttack = oppAfter - oppBefore

  board[idx] = player
  const myThreat = evaluateMoveThreat(board, row, col, player)
  board[idx] = opp
  const oppThreat = evaluateMoveThreat(board, row, col, opp)
  board[idx] = original

  let threatBonus = 0
  if (myThreat.level === 'five') threatBonus += 5_000_000
  else if (myThreat.level === 'open-four') threatBonus += 2_200_000
  else if (myThreat.level === 'blocked-four') threatBonus += 900_000
  else if (myThreat.level === 'open-three') threatBonus += 140_000

  if (oppThreat.level === 'five') threatBonus += 2_500_000
  else if (oppThreat.level === 'open-four') threatBonus += 1_600_000
  else if (oppThreat.level === 'blocked-four') threatBonus += 700_000

  if (myThreat.openFour >= 1 && myThreat.openThree >= 1) threatBonus += 500_000
  if (myThreat.openThree >= 2) threatBonus += 2_200_000
  if (player === BLACK && myThreat.level !== 'none') {
    const next = board.slice()
    next[idx] = player
    if (isPotentialForbiddenShape(next, row, col)) threatBonus -= FORBIDDEN_RISK_PENALTY
  }

  return meAttack + oppAttack * 1.15 + threatBonus
}

export function isFourCreatingMove(
  board: Board,
  row: number,
  col: number,
  player: Player,
): boolean {
  const threat = evaluateMoveThreat(board, row, col, player)
  return threat.level === 'open-four' || threat.level === 'blocked-four' || threat.level === 'five'
}

export function evaluateAfterMove(
  board: Board,
  row: number,
  col: number,
  player: Player,
  perspective: Player,
  previousEval: number,
): number {
  const idx = row * 15 + col
  if (board[idx] !== player) return evaluateBoard(board, perspective)

  const opp = perspective === BLACK ? WHITE : BLACK

  // Before
  board[idx] = EMPTY
  const selfBefore = getAffectedScoreForPlayer(board, row, col, perspective)
  const oppBefore = getAffectedScoreForPlayer(board, row, col, opp)

  // After
  board[idx] = player
  const selfAfter = getAffectedScoreForPlayer(board, row, col, perspective)
  const oppAfter = getAffectedScoreForPlayer(board, row, col, opp)

  const selfDiff = selfAfter - selfBefore
  const oppDiff = oppAfter - oppBefore

  return previousEval + selfDiff - oppDiff * OPPONENT_WEIGHT
}

function isPotentialForbiddenShape(board: Board, row: number, col: number): boolean {
  let overlineLike = false
  let multiThreat = 0
  for (const [dr, dc] of DIRECTIONS) {
    const len = countConsecutive(board, row, col, BLACK, dr, dc)
    if (len >= 6) overlineLike = true
    if (len === 4) multiThreat += 1
  }
  return overlineLike || multiThreat >= 2
}
