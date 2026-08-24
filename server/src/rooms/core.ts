import { randomInt } from 'node:crypto'
import {
  RoomBoard,
  RoomColor,
  RoomMove,
  RoomPiece,
  RoomStatus,
  RoomStatusReason,
  RoomVariant,
} from './types.js'

export const ROOM_INITIAL_FEN =
  'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'
const TYPES: RoomPiece['type'][] = [
  'r',
  'r',
  'a',
  'a',
  'b',
  'b',
  'n',
  'n',
  'c',
  'c',
  'p',
  'p',
  'p',
  'p',
  'p',
]
const MAP: Record<string, RoomPiece> = {}
for (const [char, type] of Object.entries({
  k: 'k',
  a: 'a',
  b: 'b',
  n: 'n',
  r: 'r',
  c: 'c',
  p: 'p',
} as const)) {
  MAP[char] = { type, color: 'black' }
  MAP[char.toUpperCase()] = { type, color: 'red' }
}

function clone(board: RoomBoard): RoomBoard {
  return board.map((row) => row.map((piece) => (piece ? { ...piece } : null)))
}
function inside(row: number, col: number) {
  return row >= 0 && row < 10 && col >= 0 && col < 9
}
function pos(text: string) {
  return { col: text.charCodeAt(0) - 97, row: 9 - Number(text[1]) }
}
export function roomUci(from: { row: number; col: number }, to: { row: number; col: number }) {
  return `${String.fromCharCode(97 + from.col)}${9 - from.row}${String.fromCharCode(97 + to.col)}${9 - to.row}`
}

const RED_FILES = ['九', '八', '七', '六', '五', '四', '三', '二', '一']
const BLACK_FILES = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
const RED_NAMES: Record<RoomPiece['type'], string> = {
  k: '帅',
  a: '仕',
  b: '相',
  n: '马',
  r: '车',
  c: '炮',
  p: '兵',
}
const BLACK_NAMES: Record<RoomPiece['type'], string> = {
  k: '将',
  a: '士',
  b: '象',
  n: '馬',
  r: '車',
  c: '砲',
  p: '卒',
}
const CHINESE_NUMBERS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']

function roomMoveNotation(
  board: RoomBoard,
  from: { row: number; col: number },
  to: { row: number; col: number },
) {
  const piece = board[from.row][from.col]!
  const type = piece.hidden ? piece.darkType || piece.type : piece.type
  const files = piece.color === 'red' ? RED_FILES : BLACK_FILES
  const names = piece.color === 'red' ? RED_NAMES : BLACK_NAMES
  const sameColumn = board.flatMap((row, index) =>
    row[from.col]?.color === piece.color &&
    (row[from.col]!.hidden
      ? row[from.col]!.darkType || row[from.col]!.type
      : row[from.col]!.type) === type
      ? [index]
      : [],
  )
  let prefix = `${names[type]}${files[from.col]}`
  if (!['k', 'a', 'b'].includes(type) && sameColumn.length === 2) {
    const ordered = [...sameColumn].sort((a, b) => (piece.color === 'red' ? a - b : b - a))
    prefix = `${ordered.indexOf(from.row) === 0 ? '前' : '后'}${names[type]}`
  }
  const delta = to.row - from.row
  if (delta === 0) return `${prefix}平${files[to.col]}`
  const action = delta * (piece.color === 'red' ? -1 : 1) > 0 ? '进' : '退'
  const target = ['n', 'a', 'b'].includes(type)
    ? files[to.col]
    : piece.color === 'red'
      ? CHINESE_NUMBERS[Math.abs(delta)] || String(Math.abs(delta))
      : String(Math.abs(delta))
  return `${prefix}${action}${target}`
}

export function parseRoomFen(fen = ROOM_INITIAL_FEN): { board: RoomBoard; turn: RoomColor } {
  const [placement, side] = fen.split(/\s+/)
  const board = placement.split('/').map((text) => {
    const row: RoomBoard[number] = []
    for (const char of text) {
      if (/^[1-9]$/.test(char)) for (let count = 0; count < Number(char); count++) row.push(null)
      else row.push({ ...MAP[char] })
    }
    return row
  })
  return { board, turn: side === 'b' ? 'black' : 'red' }
}

function shuffle(items: RoomPiece['type'][]): RoomPiece['type'][] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index--) {
    const swap = randomInt(index + 1)
    ;[result[index], result[swap]] = [result[swap], result[index]]
  }
  return result
}

export function createRoomInitialState(variant: RoomVariant): {
  board: RoomBoard
  layout?: string
} {
  const { board } = parseRoomFen()
  if (variant === 'xiangqi') return { board }
  const pools = { red: shuffle(TYPES), black: shuffle(TYPES) }
  const offsets = { red: 0, black: 0 }
  const hidden = board.map((row) =>
    row.map((piece) => {
      if (!piece || piece.type === 'k') return piece
      const type = pools[piece.color][offsets[piece.color]++]
      return { color: piece.color, type, hidden: true, darkType: piece.type }
    }),
  )
  return { board: hidden, layout: [...pools.black, ...pools.red].join('') }
}

function boardFromLayout(layout: string): RoomBoard {
  const { board } = parseRoomFen()
  let offset = 0
  return board.map((row) =>
    row.map((piece) => {
      if (!piece || piece.type === 'k') return piece
      const type = (layout[offset++] || piece.type) as RoomPiece['type']
      return { color: piece.color, type, hidden: true, darkType: piece.type }
    }),
  )
}

function findKing(board: RoomBoard, color: RoomColor) {
  for (let row = 0; row < 10; row++)
    for (let col = 0; col < 9; col++)
      if (board[row][col]?.type === 'k' && board[row][col]?.color === color) return { row, col }
  return null
}

function pseudo(board: RoomBoard, from: { row: number; col: number }, variant: RoomVariant) {
  const piece = board[from.row]?.[from.col]
  if (!piece) return []
  const result: Array<{ row: number; col: number }> = []
  const own = (r: number, c: number) => board[r]?.[c]?.color === piece.color
  const add = (r: number, c: number) => {
    if (inside(r, c) && !own(r, c)) result.push({ row: r, col: c })
  }
  const red = piece.color === 'red'
  const type = variant === 'jieqi' && piece.hidden ? piece.darkType || piece.type : piece.type
  if (type === 'k') {
    for (const [dr, dc] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ]) {
      const row = from.row + dr,
        col = from.col + dc
      if (col >= 3 && col <= 5 && (red ? row >= 7 && row <= 9 : row >= 0 && row <= 2)) add(row, col)
    }
    const other = findKing(board, red ? 'black' : 'red')
    if (other?.col === from.col) {
      let blocked = false
      for (let row = Math.min(from.row, other.row) + 1; row < Math.max(from.row, other.row); row++)
        if (board[row][from.col]) blocked = true
      if (!blocked) add(other.row, other.col)
    }
  } else if (type === 'a') {
    for (const [dr, dc] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      const row = from.row + dr,
        col = from.col + dc
      if (
        (variant === 'jieqi' && !piece.hidden) ||
        (col >= 3 && col <= 5 && (red ? row >= 7 && row <= 9 : row >= 0 && row <= 2))
      )
        add(row, col)
    }
  } else if (type === 'b') {
    for (const [dr, dc] of [
      [2, 2],
      [2, -2],
      [-2, 2],
      [-2, -2],
    ]) {
      const row = from.row + dr,
        col = from.col + dc
      if (
        ((variant === 'jieqi' && !piece.hidden) || (red ? row >= 5 : row <= 4)) &&
        !board[from.row + dr / 2]?.[from.col + dc / 2]
      )
        add(row, col)
    }
  } else if (type === 'n') {
    for (const [dr, dc, br, bc] of [
      [-2, -1, -1, 0],
      [-2, 1, -1, 0],
      [2, -1, 1, 0],
      [2, 1, 1, 0],
      [-1, -2, 0, -1],
      [-1, 2, 0, 1],
      [1, -2, 0, -1],
      [1, 2, 0, 1],
    ]) {
      if (!board[from.row + br]?.[from.col + bc]) add(from.row + dr, from.col + dc)
    }
  } else if (type === 'r' || type === 'c') {
    for (const [dr, dc] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ]) {
      let row = from.row + dr,
        col = from.col + dc,
        screen = false
      while (inside(row, col)) {
        if (board[row][col]) {
          if (type === 'r') {
            add(row, col)
            break
          }
          if (!screen) screen = true
          else {
            add(row, col)
            break
          }
        } else if (type === 'r' || !screen) add(row, col)
        row += dr
        col += dc
      }
    }
  } else {
    add(from.row + (red ? -1 : 1), from.col)
    if (red ? from.row <= 4 : from.row >= 5) {
      add(from.row, from.col - 1)
      add(from.row, from.col + 1)
    }
  }
  return result
}

function apply(
  board: RoomBoard,
  from: { row: number; col: number },
  to: { row: number; col: number },
) {
  const next = clone(board),
    captured = next[to.row][to.col],
    moving = next[from.row][from.col]
  next[to.row][to.col] = moving
  next[from.row][from.col] = null
  let revealed: RoomPiece['type'] | undefined
  if (moving?.hidden) {
    moving.hidden = false
    delete moving.darkType
    revealed = moving.type
  }
  return { board: next, captured: captured ? { ...captured } : null, revealed }
}

function inCheck(board: RoomBoard, color: RoomColor, variant: RoomVariant): boolean {
  const king = findKing(board, color)
  if (!king) return true
  for (let row = 0; row < 10; row++)
    for (let col = 0; col < 9; col++) {
      const piece = board[row][col]
      if (
        piece?.color !== color &&
        !(variant === 'jieqi' && piece?.hidden) &&
        pseudo(board, { row, col }, variant).some(
          (move) => move.row === king.row && move.col === king.col,
        )
      )
        return true
    }
  return false
}

export function legalRoomMoves(
  board: RoomBoard,
  from: { row: number; col: number },
  variant: RoomVariant,
) {
  const piece = board[from.row]?.[from.col]
  if (!piece) return []
  return pseudo(board, from, variant).filter(
    (to) => !inCheck(apply(board, from, to).board, piece.color, variant),
  )
}

function status(
  board: RoomBoard,
  turn: RoomColor,
  variant: RoomVariant,
): { status: RoomStatus; reason?: RoomStatusReason } {
  if (!findKing(board, turn))
    return { status: turn === 'red' ? 'black-wins' : 'red-wins', reason: 'checkmate' }
  for (let row = 0; row < 10; row++)
    for (let col = 0; col < 9; col++) {
      if (board[row][col]?.color === turn && legalRoomMoves(board, { row, col }, variant).length)
        return { status: 'playing' }
    }
  return {
    status: turn === 'red' ? 'black-wins' : 'red-wins',
    reason: inCheck(board, turn, variant) ? 'checkmate' : 'stalemate',
  }
}

export function boardFen(board: RoomBoard, turn: RoomColor) {
  return `${board
    .map((row) => {
      let text = '',
        empty = 0
      for (const piece of row) {
        if (!piece) empty++
        else {
          if (empty) text += empty
          empty = 0
          const char = piece.type
          text += piece.color === 'red' ? char.toUpperCase() : char
        }
      }
      return text + (empty || '')
    })
    .join('/')} ${turn === 'red' ? 'w' : 'b'} - - 0 1`
}

function repetitionOccurrences(moves: RoomMove[], target: string) {
  let board = parseRoomFen().board
  let turn: RoomColor = 'red'
  let occurrences = boardFen(board, turn).startsWith(target) ? 1 : 0
  for (const move of moves) {
    const from = pos(move.uci.slice(0, 2)),
      to = pos(move.uci.slice(2))
    board = apply(board, from, to).board
    turn = turn === 'red' ? 'black' : 'red'
    if (boardFen(board, turn).startsWith(target)) occurrences++
  }
  return occurrences
}

type RoomRepetitionViolation = 'perpetual-check' | 'perpetual-chase' | 'check-and-chase'
type RoomRepetitionMoveKind = 'check' | 'chase' | 'idle'
type RoomPieceIds = (string | null)[][]

export interface RoomRepetitionResult {
  status: RoomStatus
  reason: 'repetition'
  liableSide?: RoomColor
  violation?: RoomRepetitionViolation
  sides: Record<
    RoomColor,
    {
      moveKinds: RoomRepetitionMoveKind[]
      violation?: RoomRepetitionViolation
      chasedPieceIds: string[]
    }
  >
  cycleStartPly: number
  cycleEndPly: number
}

const REPETITION_PIECE_VALUE: Record<RoomPiece['type'], number> = {
  k: 10_000,
  r: 900,
  c: 450,
  n: 400,
  b: 200,
  a: 200,
  p: 100,
}

function initialRoomPieceIds(board: RoomBoard): RoomPieceIds {
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

function applyRoomMoveToIds(
  ids: RoomPieceIds,
  from: { row: number; col: number },
  to: { row: number; col: number },
) {
  const next = ids.map((row) => [...row])
  next[to.row][to.col] = next[from.row][from.col]
  next[from.row][from.col] = null
  return next
}

function protectedRoomCapture(
  board: RoomBoard,
  attackerFrom: { row: number; col: number },
  victimAt: { row: number; col: number },
) {
  const attacker = board[attackerFrom.row][attackerFrom.col]
  const victim = board[victimAt.row][victimAt.col]
  if (
    !attacker ||
    !victim ||
    REPETITION_PIECE_VALUE[victim.type] > REPETITION_PIECE_VALUE[attacker.type]
  )
    return false
  const next = apply(board, attackerFrom, victimAt).board
  for (let row = 0; row < 10; row++)
    for (let col = 0; col < 9; col++)
      if (
        next[row][col]?.color === victim.color &&
        legalRoomMoves(next, { row, col }, 'xiangqi').some(
          (move) => move.row === victimAt.row && move.col === victimAt.col,
        )
      )
        return true
  return false
}

function roomChasablePieceIds(board: RoomBoard, ids: RoomPieceIds, attacker: RoomColor) {
  const targets = new Set<string>()
  for (let row = 0; row < 10; row++)
    for (let col = 0; col < 9; col++) {
      const piece = board[row][col]
      if (!piece || piece.color !== attacker || piece.type === 'k' || piece.type === 'p') continue
      const from = { row, col }
      for (const to of legalRoomMoves(board, from, 'xiangqi')) {
        const victim = board[to.row][to.col]
        const id = ids[to.row][to.col]
        const uncrossedPawn =
          victim?.type === 'p' && (victim.color === 'red' ? to.row >= 5 : to.row <= 4)
        if (
          victim &&
          victim.color !== attacker &&
          victim.type !== 'k' &&
          id &&
          !uncrossedPawn &&
          !protectedRoomCapture(board, from, to)
        )
          targets.add(id)
      }
    }
  return targets
}

function classifyRoomRepetitionSide(
  moves: Array<{ kind: RoomRepetitionMoveKind; targets: Set<string> }>,
) {
  const moveKinds = moves.map((move) => move.kind)
  const hasCheck = moveKinds.includes('check')
  const hasChase = moveKinds.includes('chase')
  const hasIdle = moveKinds.includes('idle')
  const chaseMoves = moves.filter((move) => move.kind === 'chase')
  const chased = chaseMoves.reduce<Set<string>>(
    (current, move, index) =>
      index === 0
        ? new Set(move.targets)
        : new Set([...current].filter((target) => move.targets.has(target))),
    new Set(),
  )
  let violation: RoomRepetitionViolation | undefined
  if (!hasIdle && hasCheck && !hasChase) violation = 'perpetual-check'
  else if (!hasIdle && hasChase && chased.size > 0)
    violation = hasCheck ? 'check-and-chase' : 'perpetual-chase'
  return { moveKinds, violation, chasedPieceIds: [...chased].sort() }
}

/** Authoritative room counterpart of the local CXA 2020 repetition classifier. */
export function adjudicateRoomRepetition(
  initialFen: string,
  moves: RoomMove[],
): RoomRepetitionResult | undefined {
  const initial = parseRoomFen(initialFen)
  const boards = [initial.board]
  const turns: RoomColor[] = [initial.turn]
  const ids: RoomPieceIds[] = [initialRoomPieceIds(initial.board)]
  for (const move of moves) {
    const from = pos(move.uci.slice(0, 2)),
      to = pos(move.uci.slice(2))
    boards.push(apply(boards[boards.length - 1], from, to).board)
    turns.push(turns[turns.length - 1] === 'red' ? 'black' : 'red')
    ids.push(applyRoomMoveToIds(ids[ids.length - 1], from, to))
  }
  const currentKey = boardFen(boards[boards.length - 1], turns[turns.length - 1])
    .split(/\s+/)
    .slice(0, 2)
    .join(' ')
  const occurrences = boards.flatMap((board, index) => {
    const key = boardFen(board, turns[index]).split(/\s+/).slice(0, 2).join(' ')
    return key === currentKey ? [index] : []
  })
  if (occurrences.length < 3) return undefined
  const cycleStartPly = occurrences[occurrences.length - 3]
  const cycleEndPly = occurrences[occurrences.length - 1]
  const classified: Record<
    RoomColor,
    Array<{ kind: RoomRepetitionMoveKind; targets: Set<string> }>
  > = { red: [], black: [] }
  for (let ply = cycleStartPly; ply < cycleEndPly; ply++) {
    const mover = moves[ply].color
    const defender: RoomColor = mover === 'red' ? 'black' : 'red'
    if (inCheck(boards[ply + 1], defender, 'xiangqi')) {
      classified[mover].push({ kind: 'check', targets: new Set() })
      continue
    }
    const threatened = roomChasablePieceIds(boards[ply + 1], ids[ply + 1], mover)
    const replyPosition = ply + 2 <= cycleEndPly ? ply + 2 : cycleStartPly + 1
    const afterReply = roomChasablePieceIds(boards[replyPosition], ids[replyPosition], mover)
    const resolved = new Set([...threatened].filter((target) => !afterReply.has(target)))
    classified[mover].push({ kind: resolved.size ? 'chase' : 'idle', targets: resolved })
  }
  const sides = {
    red: classifyRoomRepetitionSide(classified.red),
    black: classifyRoomRepetitionSide(classified.black),
  }
  const redCheck = sides.red.violation === 'perpetual-check'
  const blackCheck = sides.black.violation === 'perpetual-check'
  if (redCheck !== blackCheck) {
    const liableSide: RoomColor = redCheck ? 'red' : 'black'
    return {
      status: liableSide === 'red' ? ('black-wins' as const) : ('red-wins' as const),
      reason: 'repetition' as const,
      liableSide,
      violation: 'perpetual-check' as const,
      sides,
      cycleStartPly,
      cycleEndPly,
    }
  }
  if (Boolean(sides.red.violation) !== Boolean(sides.black.violation)) {
    const liableSide: RoomColor = sides.red.violation ? 'red' : 'black'
    return {
      status: liableSide === 'red' ? ('black-wins' as const) : ('red-wins' as const),
      reason: 'repetition' as const,
      liableSide,
      violation: sides[liableSide].violation,
      sides,
      cycleStartPly,
      cycleEndPly,
    }
  }
  return {
    status: 'draw' as const,
    reason: 'repetition' as const,
    sides,
    cycleStartPly,
    cycleEndPly,
  }
}

export function rebuildRoomBoard(
  variant: RoomVariant,
  layout: string | undefined,
  moves: RoomMove[],
) {
  let board = variant === 'jieqi' ? boardFromLayout(layout || '') : parseRoomFen().board
  let turn: RoomColor = 'red'
  for (const move of moves) {
    const from = pos(move.uci.slice(0, 2)),
      to = pos(move.uci.slice(2))
    board = apply(board, from, to).board
    turn = turn === 'red' ? 'black' : 'red'
  }
  return { board, turn }
}

export function executeRoomMoveFromState(
  variant: RoomVariant,
  rebuilt: ReturnType<typeof rebuildRoomBoard>,
  moves: RoomMove[],
  uci: string,
  color: RoomColor,
) {
  if (!/^[a-i][0-9][a-i][0-9]$/.test(uci)) throw new Error('着法格式不正确')
  if (rebuilt.turn !== color) throw new Error('尚未轮到当前棋手')
  const from = pos(uci.slice(0, 2)),
    to = pos(uci.slice(2))
  const moving = rebuilt.board[from.row]?.[from.col]
  if (
    !moving ||
    moving.color !== color ||
    !legalRoomMoves(rebuilt.board, from, variant).some(
      (item) => item.row === to.row && item.col === to.col,
    )
  )
    throw new Error('非法着法')
  const result = apply(rebuilt.board, from, to)
  const turn: RoomColor = color === 'red' ? 'black' : 'red'
  const move: RoomMove = { uci, color, notation: roomMoveNotation(rebuilt.board, from, to) }
  if (result.revealed) move.revealed = result.revealed
  if (result.revealed)
    move.notation += `（揭${color === 'red' ? RED_NAMES[result.revealed] : BLACK_NAMES[result.revealed]}）`
  if (result.captured) {
    move.captured = result.captured.type
    move.capturedColor = result.captured.color
    if (result.captured.hidden) move.capturedHidden = true
  }
  let detail = status(result.board, turn, variant)
  const nextMoves = [...moves, move]
  if (detail.status === 'playing' && variant === 'xiangqi') {
    const key = boardFen(result.board, turn).split(/\s+/).slice(0, 2).join(' ')
    const occurrences = repetitionOccurrences(nextMoves, key)
    if (occurrences >= 3) detail = { status: 'draw', reason: 'repetition' }
    else if (
      nextMoves.slice(-120).length === 120 &&
      nextMoves.slice(-120).every((item) => !item.captured)
    )
      detail = { status: 'draw', reason: 'natural-limit' }
    else if (nextMoves.length >= 600) detail = { status: 'draw', reason: 'move-limit' }
  }
  return { ...result, turn, move, detail }
}

export function executeRoomMove(
  variant: RoomVariant,
  layout: string | undefined,
  moves: RoomMove[],
  uci: string,
  color: RoomColor,
) {
  return executeRoomMoveFromState(
    variant,
    rebuildRoomBoard(variant, layout, moves),
    moves,
    uci,
    color,
  )
}

export function projectBoard(board: RoomBoard): RoomBoard {
  return board.map((row) =>
    row.map((piece) =>
      piece?.hidden
        ? {
            color: piece.color,
            type: piece.darkType || piece.type,
            darkType: piece.darkType,
            hidden: true,
          }
        : piece
          ? { ...piece }
          : null,
    ),
  )
}
