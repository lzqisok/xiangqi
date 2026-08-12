import { createEmptyBoard, inBounds } from '../core/board'
import { checkWinResult, isForbiddenMove } from '../core/rules'
import { BLACK, EMPTY, WHITE, type Difficulty, type Player, type Position } from '../core/types'
import { evaluateBoard, evaluateMove, evaluateMoveThreat } from './evaluate'
import { getOpeningMoveWithConfig } from './openingBook'
import { GomokuTransTable } from './transTable'
import type { Board } from '../core/board'

interface SearchConfig {
  forbiddenEnabled: boolean
  deadline: number
  context: SearchContext
  qDepth: number
  forcingLimit: number
}

interface SearchOptions {
  partitionModulo?: number
  partitionIndex?: number
}

interface Candidate {
  row: number
  col: number
  score: number
}

interface SearchResult {
  move: Position | null
  score: number
}

export interface ScoredMove {
  row: number
  col: number
  score: number
}

interface SearchContext {
  tt: GomokuTransTable
  history: Map<number, number>
  killers: Array<[Position | null, Position | null]>
  candidateCache: Map<string, Candidate[]>
}

const INF = 1_000_000_000

interface DifficultyProfile {
  baseTimeMs: number
  rootCandidates: number
  qDepth: number
  forcingLimit: number
}

function nextPlayer(player: Player): Player {
  return player === BLACK ? WHITE : BLACK
}

export function evaluatePositionForTurn(board: Board, turn: Player): number {
  return (evaluateBoard(board, turn) - evaluateBoard(board, nextPlayer(turn))) / 2
}

function moveKey(row: number, col: number): number {
  return row * 15 + col
}

function samePos(a: Position | null, b: Position): boolean {
  return Boolean(a && a.row === b.row && a.col === b.col)
}

function addKiller(context: SearchContext, ply: number, move: Position): void {
  if (!context.killers[ply]) {
    context.killers[ply] = [move, null]
    return
  }
  const [first] = context.killers[ply]
  if (!samePos(first, move)) context.killers[ply] = [move, first]
}

function addHistory(context: SearchContext, move: Position, depth: number): void {
  const key = moveKey(move.row, move.col)
  const prev = context.history.get(key) ?? 0
  context.history.set(key, prev + depth * depth)
}

function getTimeBudget(difficulty: Difficulty): number {
  return getDifficultyProfile(difficulty).baseTimeMs
}

function getDifficultyProfile(difficulty: Difficulty): DifficultyProfile {
  if (difficulty === 'easy') {
    return { baseTimeMs: 300, rootCandidates: 14, qDepth: 6, forcingLimit: 4 }
  }
  if (difficulty === 'medium') {
    return { baseTimeMs: 950, rootCandidates: 24, qDepth: 10, forcingLimit: 6 }
  }
  if (difficulty === 'hard') {
    return { baseTimeMs: 4_500, rootCandidates: 40, qDepth: 16, forcingLimit: 9 }
  }
  return { baseTimeMs: 9_000, rootCandidates: 48, qDepth: 18, forcingLimit: 10 }
}

function estimateComplexity(board: Board, currentPlayer: Player, forbiddenEnabled: boolean): number {
  const frontier = collectFrontier(board, 2)
  const opp = nextPlayer(currentPlayer)
  let danger = 0
  for (const p of frontier.slice(0, 24)) {
    if (!isLegalMove(board, p.row, p.col, currentPlayer, forbiddenEnabled)) continue
    const myThreat = evaluateMoveThreat(board, p.row, p.col, currentPlayer)
    const oppThreat = isLegalMove(board, p.row, p.col, opp, forbiddenEnabled)
      ? evaluateMoveThreat(board, p.row, p.col, opp)
      : { level: 'none' as const, openFour: 0, blockedFour: 0, openThree: 0 }
    if (myThreat.level === 'open-four' || oppThreat.level === 'open-four') danger += 4
    else if (myThreat.level === 'blocked-four' || oppThreat.level === 'blocked-four') danger += 2
    else if (myThreat.level === 'open-three' || oppThreat.level === 'open-three') danger += 1
  }
  return Math.min(12, Math.floor(frontier.length / 6) + danger)
}

function place(board: Board, row: number, col: number, player: Player): void {
  board[moveKey(row, col)] = player
}

function unplace(board: Board, row: number, col: number): void {
  board[moveKey(row, col)] = EMPTY
}

function isLegalMove(board: Board, row: number, col: number, player: Player, forbiddenEnabled: boolean): boolean {
  if (!inBounds(row, col)) return false
  if (board[moveKey(row, col)] !== EMPTY) return false
  if (!forbiddenEnabled || player !== BLACK) return true

  place(board, row, col, player)
  const forbidden = isForbiddenMove(board, row, col, { forbiddenEnabled })
  unplace(board, row, col)
  return !forbidden
}

function countStones(board: Board): number {
  let count = 0
  for (let i = 0; i < board.length; i += 1) {
    if (board[i] !== EMPTY) count += 1
  }
  return count
}

function collectFrontier(board: Board, distance = 2): Position[] {
  const occupied: Position[] = []
  for (let row = 0; row < 15; row += 1) {
    for (let col = 0; col < 15; col += 1) {
      if (board[moveKey(row, col)] !== EMPTY) occupied.push({ row, col })
    }
  }
  if (occupied.length === 0) return [{ row: 7, col: 7 }]

  const set = new Set<number>()
  for (const p of occupied) {
    for (let dr = -distance; dr <= distance; dr += 1) {
      for (let dc = -distance; dc <= distance; dc += 1) {
        if (dr === 0 && dc === 0) continue
        const nr = p.row + dr
        const nc = p.col + dc
        if (!inBounds(nr, nc)) continue
        const key = moveKey(nr, nc)
        if (board[key] !== EMPTY) continue
        set.add(key)
      }
    }
  }

  const result: Position[] = []
  set.forEach((k) => result.push({ row: Math.floor(k / 15), col: k % 15 }))
  return result.length ? result : [{ row: 7, col: 7 }]
}

function findImmediateWins(board: Board, player: Player, forbiddenEnabled: boolean): Position[] {
  const wins: Position[] = []
  for (const p of collectFrontier(board, 2)) {
    if (!isLegalMove(board, p.row, p.col, player, forbiddenEnabled)) continue
    place(board, p.row, p.col, player)
    const ended = checkWinResult(board, p, player, { forbiddenEnabled })
    unplace(board, p.row, p.col)
    if (ended?.winner === player) wins.push(p)
  }
  return wins
}

function buildCandidateCacheKey(hash: { hi: number; lo: number }, tacticalBias: boolean): string {
  return `${hash.hi}:${hash.lo}:${tacticalBias ? 1 : 0}`
}

function generateCandidates(
  board: Board,
  hash: { hi: number; lo: number },
  player: Player,
  forbiddenEnabled: boolean,
  context: SearchContext,
  limit = 16,
  tacticalBias = true,
): Candidate[] {
  const key = buildCandidateCacheKey(hash, tacticalBias)
  const cached = context.candidateCache.get(key)
  if (cached) return cached.slice(0, limit)

  const candidates: Candidate[] = []
  const opp = nextPlayer(player)
  const frontier = collectFrontier(board, 2)

  const oppImmediateWins = tacticalBias ? findImmediateWins(board, opp, forbiddenEnabled) : []
  const oppWinSet = new Set(oppImmediateWins.map((p) => moveKey(p.row, p.col)))
  const myImmediateWins = tacticalBias ? findImmediateWins(board, player, forbiddenEnabled) : []
  const myWinSet = new Set(myImmediateWins.map((p) => moveKey(p.row, p.col)))

  const myFourSet = new Set<number>()
  const blockOppFourSet = new Set<number>()
  const myDoubleThreeSet = new Set<number>()
  const myOpenThreeSet = new Set<number>()

  for (const p of frontier) {
    if (!isLegalMove(board, p.row, p.col, player, forbiddenEnabled)) continue

    place(board, p.row, p.col, player)
    const ended = checkWinResult(board, p, player, { forbiddenEnabled })
    unplace(board, p.row, p.col)

    const scoreVal = evaluateMove(board, p.row, p.col, player)

    const immediateWin = ended?.winner === player
    const centerBias = 14 - (Math.abs(7 - p.row) + Math.abs(7 - p.col))
    const mustBlockBonus = tacticalBias && oppWinSet.has(moveKey(p.row, p.col)) ? 2_000_000 : 0
    const immediateWinBonus = tacticalBias && immediateWin ? 5_000_000 : 0
    const myThreat = evaluateMoveThreat(board, p.row, p.col, player)

    if (tacticalBias) {
      const keyPos = moveKey(p.row, p.col)
      if (myThreat.level === 'open-four' || myThreat.level === 'blocked-four') {
        myFourSet.add(keyPos)
      }
      if (myThreat.level === 'open-three') {
        myOpenThreeSet.add(keyPos)
      }
      if (myThreat.openThree >= 2) {
        myDoubleThreeSet.add(keyPos)
      }
      if (isLegalMove(board, p.row, p.col, opp, forbiddenEnabled)) {
        const oppThreat = evaluateMoveThreat(board, p.row, p.col, opp)
        if (oppThreat.level === 'open-four' || oppThreat.level === 'blocked-four' || oppThreat.level === 'five') {
          blockOppFourSet.add(keyPos)
        }
      }
    }

    candidates.push({
      row: p.row,
      col: p.col,
      score: immediateWinBonus + mustBlockBonus + scoreVal + centerBias * 10,
    })
  }

  let finalCandidates = candidates
  if (tacticalBias) {
    const tier = (c: Candidate): number => {
      const keyPos = moveKey(c.row, c.col)
      if (myWinSet.has(keyPos)) return 0
      if (oppWinSet.has(keyPos)) return 1
      if (myFourSet.has(keyPos)) return 2
      if (blockOppFourSet.has(keyPos)) return 3
      if (myDoubleThreeSet.has(keyPos)) return 4
      if (myOpenThreeSet.has(keyPos)) return 5
      return 6
    }
    finalCandidates = [...candidates].sort((a, b) => {
      const ta = tier(a)
      const tb = tier(b)
      if (ta !== tb) return ta - tb
      return b.score - a.score
    })
  }

  context.candidateCache.set(key, finalCandidates.slice(0, 24))
  return finalCandidates.slice(0, limit)
}

function generateForcingMoves(
  board: Board,
  hash: { hi: number; lo: number },
  turn: Player,
  config: SearchConfig,
): Position[] {
  const myWins = findImmediateWins(board, turn, config.forbiddenEnabled)
  if (myWins.length > 0) return myWins.slice(0, 2)

  const oppWins = findImmediateWins(board, nextPlayer(turn), config.forbiddenEnabled)
  if (oppWins.length > 0) {
    return oppWins.filter((p) => isLegalMove(board, p.row, p.col, turn, config.forbiddenEnabled)).slice(0, 4)
  }

  const tactical = generateCandidates(board, hash, turn, config.forbiddenEnabled, config.context, Math.max(8, config.forcingLimit * 2), true)
  return tactical
    .map((m) => ({ row: m.row, col: m.col }))
    .filter((m) => {
      const threat = evaluateMoveThreat(board, m.row, m.col, turn)
      return threat.level === 'open-four' || threat.level === 'blocked-four' || threat.level === 'open-three'
    })
    .slice(0, config.forcingLimit)
}

function quiescence(
  board: Board,
  hash: { hi: number; lo: number },
  currentEval: number,
  alpha: number,
  beta: number,
  turn: Player,
  config: SearchConfig,
  ply: number,
  qDepth = 2,
): number {
  const standPat = currentEval
  if (standPat >= beta) return standPat
  let a = Math.max(alpha, standPat)
  if (qDepth <= 0 || Date.now() >= config.deadline) return a

  for (const move of generateForcingMoves(board, hash, turn, config)) {
    const idx = moveKey(move.row, move.col)
    if (board[idx] !== EMPTY) continue

    place(board, move.row, move.col, turn)
    const ended = checkWinResult(board, move, turn, { forbiddenEnabled: config.forbiddenEnabled })
    const nextHash = config.context.tt.applyMoveHash(hash, move.row, move.col, turn)
    const opponent = nextPlayer(turn)
    const nextEval = evaluatePositionForTurn(board, opponent)

    let score: number
    if (ended) {
      score = ended.winner === turn ? 9_000_000 - ply : -9_000_000 + ply
    } else {
      score = -quiescence(board, nextHash, nextEval, -beta, -a, opponent, config, ply + 1, qDepth - 1)
    }
    unplace(board, move.row, move.col)

    if (score > a) {
      a = score
      if (a >= beta) return a
    }
  }
  return a
}

function negamax(
  board: Board,
  hash: { hi: number; lo: number },
  currentEval: number,
  depth: number,
  alpha: number,
  beta: number,
  turn: Player,
  lastMove: Position | null,
  config: SearchConfig,
  ply: number,
): number {
  if (Date.now() >= config.deadline) return currentEval

  const originalAlpha = alpha
  const ttEntry = config.context.tt.get(hash)
  let ttBest: Position | null = null
  if (ttEntry && ttEntry.depth >= depth) {
    ttBest = ttEntry.bestMove
    if (ttEntry.flag === 'EXACT') return ttEntry.score
    if (ttEntry.flag === 'LOWER') alpha = Math.max(alpha, ttEntry.score)
    if (ttEntry.flag === 'UPPER') beta = Math.min(beta, ttEntry.score)
    if (alpha >= beta) return ttEntry.score
  } else if (ttEntry) {
    ttBest = ttEntry.bestMove
  }

  if (lastMove) {
    const ended = checkWinResult(board, lastMove, nextPlayer(turn), { forbiddenEnabled: config.forbiddenEnabled })
    if (ended) return ended.winner === turn ? 9_000_000 + depth : -9_000_000 - depth
  }

  if (depth === 0) return quiescence(board, hash, currentEval, alpha, beta, turn, config, ply, config.qDepth)

  if (depth >= 3 && Math.abs(currentEval) < 8_000_000) {
    const nullHash = config.context.tt.applyNullHash(hash)
    const nullScore = -negamax(board, nullHash, -currentEval, depth - 3, -beta, -beta + 1, nextPlayer(turn), lastMove, config, ply + 1)
    if (nullScore >= beta) return nullScore
  }

  const moves = generateCandidates(board, hash, turn, config.forbiddenEnabled, config.context, 24, true)
  if (moves.length === 0) return currentEval

  const killers = config.context.killers[ply] ?? [null, null]
  const [killerA, killerB] = killers
  moves.sort((a, b) => {
    const threatA = evaluateMoveThreat(board, a.row, a.col, turn)
    const threatB = evaluateMoveThreat(board, b.row, b.col, turn)
    const threatOrder = (t: ReturnType<typeof evaluateMoveThreat>): number => {
      if (t.level === 'five') return 4_500_000
      if (t.level === 'open-four') return 3_000_000
      if (t.level === 'blocked-four') return 1_200_000
      if (t.level === 'open-three') return 400_000
      return 0
    }
    const scoreA =
      a.score +
      threatOrder(threatA) +
      (samePos(ttBest, a) ? 10_000_000 : 0) +
      (samePos(killerA, a) ? 700_000 : 0) +
      (samePos(killerB, a) ? 400_000 : 0) +
      (config.context.history.get(moveKey(a.row, a.col)) ?? 0) * 4
    const scoreB =
      b.score +
      threatOrder(threatB) +
      (samePos(ttBest, b) ? 10_000_000 : 0) +
      (samePos(killerA, b) ? 700_000 : 0) +
      (samePos(killerB, b) ? 400_000 : 0) +
      (config.context.history.get(moveKey(b.row, b.col)) ?? 0) * 4
    return scoreB - scoreA
  })

  let best = -INF
  let bestMove: Position | null = null
  let a = alpha

  for (let i = 0; i < moves.length; i += 1) {
    const move = moves[i]
    const idx = moveKey(move.row, move.col)
    if (board[idx] !== EMPTY) continue

    place(board, move.row, move.col, turn)
    const nextHash = config.context.tt.applyMoveHash(hash, move.row, move.col, turn)
    const opponent = nextPlayer(turn)
    const nextEval = evaluatePositionForTurn(board, opponent)

    let score: number
    if (i === 0) {
      score = -negamax(board, nextHash, nextEval, depth - 1, -beta, -a, opponent, move, config, ply + 1)
    } else {
      const isTactical = samePos(ttBest, move) || samePos(killerA, move) || samePos(killerB, move)
      const reduction = (!isTactical && i >= 4 && depth >= 3) ? 2 : 0

      score = -negamax(board, nextHash, nextEval, depth - 1 - reduction, -a - 1, -a, opponent, move, config, ply + 1)
      if (score > a) {
        if (reduction > 0) {
          score = -negamax(board, nextHash, nextEval, depth - 1, -a - 1, -a, opponent, move, config, ply + 1)
        }
        if (score > a && score < beta) {
          score = -negamax(board, nextHash, nextEval, depth - 1, -beta, -a, opponent, move, config, ply + 1)
        }
      }
    }
    unplace(board, move.row, move.col)

    if (score > best) {
      best = score
      bestMove = move
    }
    if (best > a) a = best

    if (a >= beta) {
      addKiller(config.context, ply, move)
      addHistory(config.context, move, depth)
      break
    }
  }

  let flag: 'EXACT' | 'LOWER' | 'UPPER' = 'EXACT'
  if (best <= originalAlpha) flag = 'UPPER'
  else if (best >= beta) flag = 'LOWER'
  config.context.tt.set(hash, depth, best, flag, bestMove)
  if (bestMove) addHistory(config.context, bestMove, Math.max(1, depth - 1))

  return best
}

export function findBestMoveScored(
  board: Board,
  currentPlayer: Player,
  aiPlayer: Player,
  forbiddenEnabled: boolean,
  difficulty: Difficulty,
  options: SearchOptions = {},
): SearchResult {
  const stones = countStones(board)
  if (stones <= 2) {
    const book = getOpeningMoveWithConfig(board, currentPlayer, forbiddenEnabled)
    if (book && isLegalMove(board, book.row, book.col, currentPlayer, forbiddenEnabled)) return { move: book, score: 0 }
  }
  if (stones === 0) return { move: { row: 7, col: 7 }, score: 0 }

  const myImmediateWins = findImmediateWins(board, currentPlayer, forbiddenEnabled)
  if (myImmediateWins.length > 0) return { move: myImmediateWins[0], score: 9_500_000 }

  const oppImmediateWins = findImmediateWins(board, nextPlayer(currentPlayer), forbiddenEnabled)
  if (oppImmediateWins.length > 0) {
    const defensive = oppImmediateWins.find((p) => isLegalMove(board, p.row, p.col, currentPlayer, forbiddenEnabled))
    if (defensive) return { move: defensive, score: 8_500_000 }
  }

  const doubleThreeHint = collectFrontier(board, 2)
    .filter((p) => isLegalMove(board, p.row, p.col, currentPlayer, forbiddenEnabled))
    .map((p) => ({ p, t: evaluateMoveThreat(board, p.row, p.col, currentPlayer), s: evaluateMove(board, p.row, p.col, currentPlayer) }))
    .filter((x) => x.t.openThree >= 2)
    .sort((a, b) => b.s - a.s)

  const profile = getDifficultyProfile(difficulty)
  const complexity = estimateComplexity(board, currentPlayer, forbiddenEnabled)
  const deadline = Date.now() + getTimeBudget(difficulty) + complexity * 60
  const context: SearchContext = { tt: new GomokuTransTable(), history: new Map(), killers: [], candidateCache: new Map() }
  const rootHash = context.tt.hash(board, currentPlayer)

  let bestMove: Position | null = null
  let bestScore = -INF
  let guess = 0
  let depth = 1
  let pvMove: Position | null = doubleThreeHint.length > 0 ? doubleThreeHint[0].p : null

  while (Date.now() < deadline && depth <= 15) {
    const config: SearchConfig = {
      forbiddenEnabled,
      deadline,
      context,
      qDepth: profile.qDepth,
      forcingLimit: profile.forcingLimit,
    }
    const dynamicRootLimit = Math.min(48, profile.rootCandidates + complexity)
    let candidates = generateCandidates(board, rootHash, currentPlayer, forbiddenEnabled, context, dynamicRootLimit, true)
    if (options.partitionModulo && options.partitionIndex !== undefined) {
      candidates = candidates.filter((m) => moveKey(m.row, m.col) % options.partitionModulo! === options.partitionIndex)
    }
    if (candidates.length === 0) break

    if (pvMove) {
      candidates.sort((a, b) => Number(samePos(pvMove, b)) - Number(samePos(pvMove, a)))
    }

    let currentBestMove: Position | null = null
    let currentBestScore = -INF
    let window = depth <= 2 ? 20000 : 8000
    let alpha = depth > 1 ? guess - window : -INF
    let beta = depth > 1 ? guess + window : INF

    for (const move of candidates) {
      if (Date.now() >= deadline) break
      const idx = moveKey(move.row, move.col)
      if (board[idx] !== EMPTY) continue

      place(board, move.row, move.col, currentPlayer)
      const ended = checkWinResult(board, move, currentPlayer, { forbiddenEnabled })
      const nextHash = context.tt.applyMoveHash(rootHash, move.row, move.col, currentPlayer)
      const opponent = nextPlayer(currentPlayer)
      const nextEval = evaluatePositionForTurn(board, opponent)

      let score: number
      if (ended?.winner === currentPlayer) {
        score = 9_600_000
      } else {
        score = -negamax(board, nextHash, nextEval, depth - 1, -beta, -alpha, opponent, move, config, 1)
        if (score <= alpha || score >= beta) {
          window *= 2
          alpha = -INF
          beta = INF
          score = -negamax(board, nextHash, nextEval, depth - 1, -beta, -alpha, opponent, move, config, 1)
        }
      }
      unplace(board, move.row, move.col)

      if (score > currentBestScore) {
        currentBestScore = score
        currentBestMove = { row: move.row, col: move.col }
      }
      if (score > alpha) alpha = score
    }

    if (currentBestMove) {
      bestMove = currentBestMove
      bestScore = currentBestScore
      guess = currentBestScore
      pvMove = currentBestMove
    }
    depth += 1
  }

  if (!bestMove) {
    const fallback = generateCandidates(board, rootHash, currentPlayer, forbiddenEnabled, context, 1, true)
    if (fallback.length > 0) return { move: { row: fallback[0].row, col: fallback[0].col }, score: -1000 }
    const fresh = createEmptyBoard()
    if (board.every((v, i) => v === fresh[i])) return { move: { row: 7, col: 7 }, score: 0 }
  }

  if (bestScore < -8_000_000 && oppImmediateWins.length > 0) return { move: oppImmediateWins[0], score: bestScore }
  return { move: bestMove, score: bestScore }
}

export function findBestMove(
  board: Board,
  currentPlayer: Player,
  aiPlayer: Player,
  forbiddenEnabled: boolean,
  difficulty: Difficulty,
  options: SearchOptions = {},
): Position | null {
  return findBestMoveScored(board, currentPlayer, aiPlayer, forbiddenEnabled, difficulty, options).move
}

export function findTopMovesScored(
  board: Board,
  currentPlayer: Player,
  forbiddenEnabled: boolean,
  difficulty: Difficulty,
  topK = 3,
): ScoredMove[] {
  const profile = getDifficultyProfile(difficulty)
  const complexity = estimateComplexity(board, currentPlayer, forbiddenEnabled)
  const context: SearchContext = { tt: new GomokuTransTable(), history: new Map(), killers: [], candidateCache: new Map() }
  const rootHash = context.tt.hash(board, currentPlayer)
  const dynamicRootLimit = Math.min(48, profile.rootCandidates + complexity)
  const candidates = generateCandidates(board, rootHash, currentPlayer, forbiddenEnabled, context, dynamicRootLimit, true)
  return candidates.slice(0, topK).map((c) => ({ row: c.row, col: c.col, score: c.score }))
}
