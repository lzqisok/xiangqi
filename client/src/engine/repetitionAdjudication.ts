import type { Board, MoveRecord, PieceColor, PieceType, Position } from '../types'
import { applyMove, parseFen } from './board'
import { getRepetitionKey } from './repetition'
import { getLegalMoves, isInCheck } from './rules'

export type RepetitionMoveKind = 'check' | 'chase' | 'idle'
export type RepetitionViolation = 'perpetual-check' | 'perpetual-chase' | 'check-and-chase'
export type RepetitionChaseMode = 'single' | 'joint'

export interface RepetitionSideAnalysis {
  moveKinds: RepetitionMoveKind[]
  violation?: RepetitionViolation
  chasedPieceIds: string[]
  chasedPieceTypes: PieceType[]
  chaseMode?: RepetitionChaseMode
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
type ChaseEvidence = {
  attackers: Set<string>
  jointAttackers: Set<string>
  mode: RepetitionChaseMode
  targetType: PieceType
}
type ClassifiedMove = {
  kind: RepetitionMoveKind
  targets: Map<string, ChaseEvidence>
}

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

function bestExchangeGain(board: Board, target: Position, attacker: PieceColor): number {
  const victim = board[target.row][target.col]
  if (!victim || victim.color === attacker || victim.type === 'k') return 0

  let best = 0
  for (let row = 0; row < board.length; row++) {
    for (let col = 0; col < board[row].length; col++) {
      const piece = board[row][col]
      if (!piece || piece.color !== attacker) continue
      const from = { row, col }
      if (!getLegalMoves(board, from).some((move) => samePosition(move, target))) continue
      const { newBoard } = applyMove(board, from, target)
      const gain = PIECE_VALUE[victim.type] - bestExchangeGain(newBoard, target, opposite(attacker))
      best = Math.max(best, gain)
    }
  }
  return best
}

function captureGain(
  board: Board,
  from: Position,
  target: Position,
  attacker: PieceColor,
): number {
  const victim = board[target.row][target.col]
  if (!victim || victim.color === attacker || victim.type === 'k') return 0
  const { newBoard } = applyMove(board, from, target)
  return PIECE_VALUE[victim.type] - bestExchangeGain(newBoard, target, opposite(attacker))
}

function liesBetween(candidate: Position, from: Position, target: Position): boolean {
  if (from.row === target.row && candidate.row === from.row)
    return candidate.col > Math.min(from.col, target.col) && candidate.col < Math.max(from.col, target.col)
  if (from.col === target.col && candidate.col === from.col)
    return candidate.row > Math.min(from.row, target.row) && candidate.row < Math.max(from.row, target.row)
  return false
}

function captureNeedsJointSupport(
  board: Board,
  from: Position,
  target: Position,
  attacker: PieceColor,
): boolean {
  for (let row = 0; row < board.length; row++) {
    for (let col = 0; col < board[row].length; col++) {
      if (row === from.row && col === from.col) continue
      const helper = board[row][col]
      if (!helper || helper.color !== attacker || helper.type === 'k') continue
      const helperAt = { row, col }
      const participates =
        liesBetween(helperAt, from, target) ||
        getLegalMoves(board, helperAt).some((move) => samePosition(move, target))
      if (!participates) continue
      const withoutHelper = board.map((boardRow) => [...boardRow])
      withoutHelper[row][col] = null
      const captureStillLegal = getLegalMoves(withoutHelper, from).some((move) =>
        samePosition(move, target),
      )
      if (!captureStillLegal || captureGain(withoutHelper, from, target, attacker) <= 0) return true
    }
  }
  return false
}

/**
 * Finds material-winning captures after complete legal recapture sequences.
 * Legal move generation naturally rejects pinned "roots"; equal or losing
 * exchanges return zero and remain idle under CXA 2020 rules 24.16 and 26.5-7.
 */
function getWinningThreats(
  board: Board,
  ids: PieceIds,
  attacker: PieceColor,
): Map<string, Omit<ChaseEvidence, 'mode'>> {
  const targets = new Map<string, Omit<ChaseEvidence, 'mode'>>()
  for (let row = 0; row < board.length; row++) {
    for (let col = 0; col < board[row].length; col++) {
      const victim = board[row][col]
      const targetId = ids[row][col]
      if (
        !victim ||
        victim.color === attacker ||
        victim.type === 'k' ||
        !targetId ||
        isUncrossedPawn(victim.type, victim.color, row)
      ) {
        continue
      }

      const attackers = new Set<string>()
      const jointAttackers = new Set<string>()
      for (let attackerRow = 0; attackerRow < board.length; attackerRow++) {
        for (let attackerCol = 0; attackerCol < board[attackerRow].length; attackerCol++) {
          const piece = board[attackerRow][attackerCol]
          const attackerId = ids[attackerRow][attackerCol]
          const from = { row: attackerRow, col: attackerCol }
          if (
            !piece ||
            piece.color !== attacker ||
            !attackerId ||
            !getLegalMoves(board, from).some((move) => move.row === row && move.col === col)
          ) {
            continue
          }
          const target = { row, col }
          const gain = captureGain(board, from, target, attacker)
          if (gain > 0) {
            attackers.add(attackerId)
            if (captureNeedsJointSupport(board, from, target, attacker))
              jointAttackers.add(attackerId)
          }
        }
      }
      if (attackers.size)
        targets.set(targetId, { attackers, jointAttackers, targetType: victim.type })
    }
  }
  return targets
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((item) => right.has(item))
}

function findPiecePosition(ids: PieceIds, targetId: string): Position | undefined {
  for (let row = 0; row < ids.length; row++)
    for (let col = 0; col < ids[row].length; col++)
      if (ids[row][col] === targetId) return { row, col }
  return undefined
}

function isEqualExchangeInvitation(
  board: Board,
  ids: PieceIds,
  moverId: string | null,
  targetId: string,
  evidence: Omit<ChaseEvidence, 'mode'>,
): boolean {
  if (!moverId || evidence.attackers.size !== 1 || !evidence.attackers.has(moverId)) return false
  const moverAt = findPiecePosition(ids, moverId)
  const targetAt = findPiecePosition(ids, targetId)
  if (!moverAt || !targetAt) return false
  const mover = board[moverAt.row][moverAt.col]
  const target = board[targetAt.row][targetAt.col]
  if (!mover || !target || mover.type !== target.type) return false
  if (!getLegalMoves(board, targetAt).some((move) => samePosition(move, moverAt))) return false
  const { newBoard } = applyMove(board, targetAt, moverAt)
  const defenderGain =
    PIECE_VALUE[mover.type] - bestExchangeGain(newBoard, moverAt, mover.color)
  return defenderGain >= 0
}

function classifySide(moves: ClassifiedMove[]): RepetitionSideAnalysis {
  const moveKinds = moves.map((move) => move.kind)
  const hasCheck = moveKinds.includes('check')
  const hasChase = moveKinds.includes('chase')
  const hasIdle = moveKinds.includes('idle')
  const chaseMoves = moves.filter((move) => move.kind === 'chase')
  const chasedIds = new Set<string>()
  const evidence: ChaseEvidence[] = []
  for (const move of chaseMoves) {
    for (const [targetId, targetEvidence] of move.targets) {
      chasedIds.add(targetId)
      evidence.push(targetEvidence)
    }
  }

  let violation: RepetitionViolation | undefined
  if (!hasIdle && hasCheck && !hasChase) violation = 'perpetual-check'
  else if (!hasIdle && hasChase) {
    violation = hasCheck ? 'check-and-chase' : 'perpetual-chase'
  }
  return {
    moveKinds,
    violation,
    chasedPieceIds: [...chasedIds].sort(),
    chasedPieceTypes: [...new Set(evidence.map((item) => item.targetType))].sort(),
    chaseMode:
      hasChase && evidence.length
        ? evidence.every((item) => item.mode === 'joint')
          ? 'joint'
          : 'single'
        : undefined,
  }
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

  if (
    redViolation === 'perpetual-chase' &&
    blackViolation === 'perpetual-chase' &&
    sides.red.chaseMode !== sides.black.chaseMode &&
    ((sides.red.chasedPieceTypes.includes('r') && sides.black.chasedPieceTypes.includes('r')) ||
      (sides.red.chasedPieceTypes.some((type) => type !== 'r') &&
        sides.black.chasedPieceTypes.some((type) => type !== 'r')))
  ) {
    const liableSide = sides.red.chaseMode === 'single' ? 'red' : 'black'
    return {
      outcome: liableSide === 'red' ? 'black-wins' : 'red-wins',
      liableSide,
      violation: 'perpetual-chase',
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

  const classified: Record<PieceColor, ClassifiedMove[]> = {
    red: [],
    black: [],
  }
  for (let ply = cycleStartPly; ply < cycleEndPly; ply++) {
    const mover = records[ply].move.piece.color
    const defender = opposite(mover)
    if (isInCheck(boards[ply + 1], defender)) {
      classified[mover].push({ kind: 'check', targets: new Map() })
      continue
    }

    const beforeMove = getWinningThreats(boards[ply], ids[ply], mover)
    const threatened = getWinningThreats(boards[ply + 1], ids[ply + 1], mover)
    const replyPosition = ply + 2 <= cycleEndPly ? ply + 2 : cycleStartPly + 1
    const afterReply = getWinningThreats(boards[replyPosition], ids[replyPosition], mover)
    const movedPiece = boards[ply][records[ply].move.from.row][records[ply].move.from.col]
    const moverId = ids[ply][records[ply].move.from.row][records[ply].move.from.col]
    const kingRespondedToCheck = movedPiece?.type === 'k' && isInCheck(boards[ply], mover)
    const resolved = new Map<string, ChaseEvidence>()
    for (const [targetId, evidence] of threatened) {
      const replyEvidence = afterReply.get(targetId)
      const originalThreatRemains =
        replyEvidence && [...evidence.attackers].some((attacker) => replyEvidence.attackers.has(attacker))
      if (originalThreatRemains || kingRespondedToCheck) continue
      const previous = beforeMove.get(targetId)
      const createdByMove =
        !previous ||
        !sameSet(previous.attackers, evidence.attackers) ||
        Boolean(moverId && evidence.attackers.has(moverId))
      if (!createdByMove) continue
      const ownKingOrPawnOnly =
        (movedPiece?.type === 'k' || movedPiece?.type === 'p') &&
        evidence.attackers.size === 1 &&
        Boolean(moverId && evidence.attackers.has(moverId))
      if (ownKingOrPawnOnly) continue
      if (isEqualExchangeInvitation(boards[ply + 1], ids[ply + 1], moverId, targetId, evidence))
        continue
      resolved.set(targetId, {
        ...evidence,
        mode:
          evidence.jointAttackers.size === evidence.attackers.size ? 'joint' : 'single',
      })
    }
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
