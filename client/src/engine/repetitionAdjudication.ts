import type { Board, MoveRecord, PieceColor, PieceType, Position } from '../types'
import { applyMove, parseFen } from './board'
import { getRepetitionKey } from './repetition'
import { getLegalMoves, isInCheck } from './rules'

export type RepetitionMoveKind = 'check' | 'chase' | 'idle'
export type RepetitionViolation = 'perpetual-check' | 'perpetual-chase' | 'check-and-chase'

export interface RepetitionSideAnalysis {
  moveKinds: RepetitionMoveKind[]
  violation?: RepetitionViolation
  chasedPieceIds: string[]
}

export type RepetitionCaseAnalysis =
  | { kind: 'not-ready'; occurrences: number }
  | {
      kind: 'adjudicated'
      occurrences: number
      outcome: 'draw' | 'red-wins' | 'black-wins'
      liableSide?: PieceColor
      violation?: RepetitionViolation
      cycleStartPly: number
      cycleEndPly: number
      sides: Record<PieceColor, RepetitionSideAnalysis>
    }

type PieceIds = (string | null)[][]

const PIECE_VALUE: Record<PieceType, number> = {
  k: 10_000,
  r: 900,
  c: 450,
  n: 400,
  b: 200,
  a: 200,
  p: 100,
}

function opposite(side: PieceColor): PieceColor {
  return side === 'red' ? 'black' : 'red'
}

function samePosition(left: Position, right: Position): boolean {
  return left.row === right.row && left.col === right.col
}

function initialPieceIds(board: Board): PieceIds {
  const counts = new Map<string, number>()
  return board.map((row) =>
    row.map((piece) => {
      if (!piece) return null
      const prefix = `${piece.color}-${piece.type}`
      const ordinal = (counts.get(prefix) || 0) + 1
      counts.set(prefix, ordinal)
      return `${prefix}-${ordinal}`
    }),
  )
}

function applyMoveToIds(ids: PieceIds, from: Position, to: Position): PieceIds {
  const next = ids.map((row) => [...row])
  next[to.row][to.col] = next[from.row][from.col]
  next[from.row][from.col] = null
  return next
}

function isUncrossedPawn(type: PieceType, color: PieceColor, row: number): boolean {
  return type === 'p' && (color === 'red' ? row >= 5 : row <= 4)
}

/**
 * CXA 2020 treats a directly capturable piece as protected when the defender can
 * legally recapture on the same square. A cheaper attacker taking a dearer
 * victim is still a net material gain, so it remains a chase candidate.
 */
function isProtectedCapture(
  board: Board,
  attackerFrom: Position,
  victimAt: Position,
): boolean {
  const attacker = board[attackerFrom.row][attackerFrom.col]
  const victim = board[victimAt.row][victimAt.col]
  if (!attacker || !victim || PIECE_VALUE[victim.type] > PIECE_VALUE[attacker.type]) return false

  const { newBoard } = applyMove(board, attackerFrom, victimAt)
  for (let row = 0; row < newBoard.length; row++) {
    for (let col = 0; col < newBoard[row].length; col++) {
      const defender = newBoard[row][col]
      if (!defender || defender.color !== victim.color) continue
      if (getLegalMoves(newBoard, { row, col }).some((target) => samePosition(target, victimAt))) {
        return true
      }
    }
  }
  return false
}

/**
 * Returns stable IDs of pieces that can currently be won by the attacker. King
 * and pawn attacks are intentionally excluded (CXA 2020 rule 26.1), as are
 * un-crossed pawns, protected pieces and equal exchanges.
 */
function getChasablePieceIds(board: Board, ids: PieceIds, attacker: PieceColor): Set<string> {
  const targets = new Set<string>()
  for (let row = 0; row < board.length; row++) {
    for (let col = 0; col < board[row].length; col++) {
      const piece = board[row][col]
      if (!piece || piece.color !== attacker || piece.type === 'k' || piece.type === 'p') continue
      const from = { row, col }
      for (const to of getLegalMoves(board, from)) {
        const victim = board[to.row][to.col]
        const id = ids[to.row][to.col]
        if (
          !victim ||
          victim.color === attacker ||
          victim.type === 'k' ||
          !id ||
          isUncrossedPawn(victim.type, victim.color, to.row) ||
          isProtectedCapture(board, from, to)
        ) {
          continue
        }
        targets.add(id)
      }
    }
  }
  return targets
}

function intersect(left: Set<string>, right: Set<string>): Set<string> {
  return new Set([...left].filter((item) => right.has(item)))
}

function classifySide(
  moves: Array<{ kind: RepetitionMoveKind; targets: Set<string> }>,
): RepetitionSideAnalysis {
  const moveKinds = moves.map((move) => move.kind)
  const hasCheck = moveKinds.includes('check')
  const hasChase = moveKinds.includes('chase')
  const hasIdle = moveKinds.includes('idle')
  const chaseMoves = moves.filter((move) => move.kind === 'chase')
  const chased = chaseMoves.reduce<Set<string>>(
    (current, move, index) => (index === 0 ? new Set(move.targets) : intersect(current, move.targets)),
    new Set(),
  )

  let violation: RepetitionViolation | undefined
  if (!hasIdle && hasCheck && !hasChase) violation = 'perpetual-check'
  else if (!hasIdle && hasChase && chased.size > 0) {
    violation = hasCheck ? 'check-and-chase' : 'perpetual-chase'
  }
  return { moveKinds, violation, chasedPieceIds: [...chased].sort() }
}

function decideOutcome(
  sides: Record<PieceColor, RepetitionSideAnalysis>,
): Pick<Extract<RepetitionCaseAnalysis, { kind: 'adjudicated' }>, 'outcome' | 'liableSide' | 'violation'> {
  // Long check has priority when the other side is committing a different violation.
  const redCheck = sides.red.violation === 'perpetual-check'
  const blackCheck = sides.black.violation === 'perpetual-check'
  if (redCheck !== blackCheck) {
    const liableSide = redCheck ? 'red' : 'black'
    return {
      outcome: liableSide === 'red' ? 'black-wins' : 'red-wins',
      liableSide,
      violation: 'perpetual-check',
    }
  }

  const redViolation = sides.red.violation
  const blackViolation = sides.black.violation
  if (Boolean(redViolation) !== Boolean(blackViolation)) {
    const liableSide = redViolation ? 'red' : 'black'
    return {
      outcome: liableSide === 'red' ? 'black-wins' : 'red-wins',
      liableSide,
      violation: redViolation || blackViolation,
    }
  }
  return { outcome: 'draw' }
}

/**
 * Classifies the latest two complete cycles of a threefold repetition according
 * to the project's CXA 2020 baseline. Chase evidence is tied to stable piece
 * identities and only counts when the opponent's reply evades or resolves the
 * immediate material threat.
 */
export function analyzeRepetitionCase(
  initialFen: string,
  records: MoveRecord[],
): RepetitionCaseAnalysis {
  const positions = [initialFen, ...records.map((record) => record.fen)]
  const currentKey = getRepetitionKey(positions[positions.length - 1])
  const occurrences = positions
    .map((fen, index) => ({ key: getRepetitionKey(fen), index }))
    .filter((item) => item.key === currentKey)
    .map((item) => item.index)

  if (occurrences.length < 3) return { kind: 'not-ready', occurrences: occurrences.length }

  const cycleStartPly = occurrences[occurrences.length - 3]
  const cycleEndPly = occurrences[occurrences.length - 1]
  const boards = positions.map((fen) => parseFen(fen).board)
  const ids: PieceIds[] = [initialPieceIds(boards[0])]
  for (let ply = 0; ply < records.length; ply++) {
    ids.push(applyMoveToIds(ids[ply], records[ply].move.from, records[ply].move.to))
  }

  const classified: Record<PieceColor, Array<{ kind: RepetitionMoveKind; targets: Set<string> }>> = {
    red: [],
    black: [],
  }
  for (let ply = cycleStartPly; ply < cycleEndPly; ply++) {
    const mover = records[ply].move.piece.color
    const defender = opposite(mover)
    if (isInCheck(boards[ply + 1], defender)) {
      classified[mover].push({ kind: 'check', targets: new Set() })
      continue
    }

    const threatened = getChasablePieceIds(boards[ply + 1], ids[ply + 1], mover)
    const replyPosition = ply + 2 <= cycleEndPly ? ply + 2 : cycleStartPly + 1
    const afterReply = getChasablePieceIds(boards[replyPosition], ids[replyPosition], mover)
    const resolved = new Set([...threatened].filter((target) => !afterReply.has(target)))
    classified[mover].push({ kind: resolved.size > 0 ? 'chase' : 'idle', targets: resolved })
  }

  const sides = {
    red: classifySide(classified.red),
    black: classifySide(classified.black),
  }
  return {
    kind: 'adjudicated',
    occurrences: occurrences.length,
    cycleStartPly,
    cycleEndPly,
    sides,
    ...decideOutcome(sides),
  }
}
