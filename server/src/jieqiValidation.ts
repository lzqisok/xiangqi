type PieceColor = 'red' | 'black'
type PieceType = 'k' | 'a' | 'b' | 'n' | 'r' | 'c' | 'p'
type Position = { row: number; col: number }
type PublicPiece = {
  color: PieceColor
  type: PieceType
  hidden: boolean
}
type PublicBoard = (PublicPiece | null)[][]

const ROWS = 10
const COLS = 9
const IDENTITY_TYPES: Record<string, PieceType> = {
  R: 'r', A: 'a', C: 'c', P: 'p', N: 'n', B: 'b',
  r: 'r', a: 'a', c: 'c', p: 'p', n: 'n', b: 'b',
}

function failure(message: string) {
  return { ok: false as const, errors: [message] }
}

function identityColor(char: string): PieceColor {
  return char === char.toUpperCase() ? 'red' : 'black'
}

function hiddenMovementType(row: number, col: number, color: PieceColor): PieceType | null {
  const homeRow = color === 'red' ? row : ROWS - 1 - row
  if (homeRow === 9) {
    return (['r', 'n', 'b', 'a', 'k', 'a', 'b', 'n', 'r'] as PieceType[])[col]
  }
  if (homeRow === 7 && (col === 1 || col === 7)) return 'c'
  if (homeRow === 6 && col % 2 === 0) return 'p'
  return null
}

function parseJieqiPublicPosition(fen: string): {
  board: PublicBoard
  turn: PieceColor
  reserves: Record<string, number>
} | null {
  const fields = fen.trim().split(/\s+/)
  const ranks = fields[0]?.split('/') || []
  if (fields.length !== 5 || ranks.length !== ROWS) return null

  const board: PublicBoard = []
  for (let row = 0; row < ROWS; row++) {
    const cells: (PublicPiece | null)[] = []
    for (const char of ranks[row]) {
      if (/^[1-9]$/.test(char)) {
        for (let count = 0; count < Number(char); count++) cells.push(null)
        continue
      }
      if (char === 'K' || char === 'k') {
        cells.push({ color: char === 'K' ? 'red' : 'black', type: 'k', hidden: false })
      } else if (char === 'X' || char === 'x') {
        const color: PieceColor = char === 'X' ? 'red' : 'black'
        const type = hiddenMovementType(row, cells.length, color)
        if (!type || type === 'k') return null
        cells.push({ color, type, hidden: true })
      } else {
        return null
      }
    }
    if (cells.length !== COLS) return null
    board.push(cells)
  }

  const reserves: Record<string, number> = {}
  const reserveText = fields[2]
  if (!/^(?:[RACPNBracpnb][0-5])+$/.test(reserveText)) return null
  for (let index = 0; index < reserveText.length; index += 2) {
    const piece = reserveText[index]
    reserves[piece] = (reserves[piece] || 0) + Number(reserveText[index + 1])
  }
  return { board, turn: fields[1] === 'b' ? 'black' : 'red', reserves }
}

function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < ROWS && col >= 0 && col < COLS
}

function inPalace(row: number, col: number, color: PieceColor): boolean {
  return col >= 3 && col <= 5 && (color === 'red' ? row >= 7 && row <= 9 : row >= 0 && row <= 2)
}

function pseudoMoves(board: PublicBoard, from: Position): Position[] {
  const piece = board[from.row]?.[from.col]
  if (!piece) return []
  const moves: Position[] = []
  const add = (row: number, col: number) => {
    if (!inBounds(row, col) || board[row][col]?.color === piece.color) return
    moves.push({ row, col })
  }
  const isRed = piece.color === 'red'

  switch (piece.type) {
    case 'k':
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const row = from.row + dr
        const col = from.col + dc
        if (inPalace(row, col, piece.color)) add(row, col)
      }
      break
    case 'a':
      for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const row = from.row + dr
        const col = from.col + dc
        if (!piece.hidden || inPalace(row, col, piece.color)) add(row, col)
      }
      break
    case 'b':
      for (const [dr, dc] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
        const row = from.row + dr
        const col = from.col + dc
        const staysHome = isRed ? row >= 5 : row <= 4
        if ((!piece.hidden || staysHome) && inBounds(row, col) && !board[from.row + dr / 2][from.col + dc / 2]) add(row, col)
      }
      break
    case 'n':
      for (const [dr, dc, blockDr, blockDc] of [
        [-2, -1, -1, 0], [-2, 1, -1, 0], [2, -1, 1, 0], [2, 1, 1, 0],
        [-1, -2, 0, -1], [-1, 2, 0, 1], [1, -2, 0, -1], [1, 2, 0, 1],
      ]) {
        if (!board[from.row + blockDr]?.[from.col + blockDc]) add(from.row + dr, from.col + dc)
      }
      break
    case 'r':
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        let row = from.row + dr
        let col = from.col + dc
        while (inBounds(row, col)) {
          if (board[row][col]) {
            add(row, col)
            break
          }
          add(row, col)
          row += dr
          col += dc
        }
      }
      break
    case 'c':
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        let row = from.row + dr
        let col = from.col + dc
        let screen = false
        while (inBounds(row, col)) {
          if (board[row][col]) {
            if (!screen) screen = true
            else {
              add(row, col)
              break
            }
          } else if (!screen) {
            add(row, col)
          }
          row += dr
          col += dc
        }
      }
      break
    case 'p': {
      const forward = isRed ? -1 : 1
      add(from.row + forward, from.col)
      const crossed = isRed ? from.row <= 4 : from.row >= 5
      if (crossed) {
        add(from.row, from.col - 1)
        add(from.row, from.col + 1)
      }
      break
    }
  }
  return moves
}

function findKing(board: PublicBoard, color: PieceColor): Position | null {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const piece = board[row][col]
      if (piece?.type === 'k' && piece.color === color) return { row, col }
    }
  }
  return null
}

function isInCheck(board: PublicBoard, color: PieceColor): boolean {
  const king = findKing(board, color)
  if (!king) return true
  const opponent: PieceColor = color === 'red' ? 'black' : 'red'
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const piece = board[row][col]
      // Covered pieces move by their square role but do not give check until
      // their identity is revealed by moving.
      if (piece?.color !== opponent || piece.hidden) continue
      if (pseudoMoves(board, { row, col }).some(move => move.row === king.row && move.col === king.col)) return true
    }
  }
  const opponentKing = findKing(board, opponent)
  if (!opponentKing || opponentKing.col !== king.col) return false
  for (let row = Math.min(king.row, opponentKing.row) + 1; row < Math.max(king.row, opponentKing.row); row++) {
    if (board[row][king.col]) return false
  }
  return true
}

function uciPosition(text: string): Position {
  return {
    col: text.charCodeAt(0) - 97,
    row: 9 - Number(text[1]),
  }
}

function consumeIdentity(reserves: Record<string, number>, identity: string): boolean {
  if (!IDENTITY_TYPES[identity] || (reserves[identity] || 0) < 1) return false
  reserves[identity]--
  return true
}

export function validateJieqiMoveSequence(fen: string, moves: string[]): { ok: boolean; errors: string[] } {
  const parsed = parseJieqiPublicPosition(fen)
  if (!parsed) return failure('Invalid Jieqi FEN')
  const { board, reserves } = parsed
  let turn = parsed.turn
  const viewer: PieceColor = moves.length % 2 === 0
    ? parsed.turn
    : parsed.turn === 'red' ? 'black' : 'red'

  for (let index = 0; index < moves.length; index++) {
    const text = moves[index]
    const invalid = () => failure(`Illegal Jieqi move at ${index + 1}: ${text}`)
    if (!/^[a-i][0-9][a-i][0-9](?:[RACPNBracpnb]{1,2})?$/.test(text)) return invalid()
    const from = uciPosition(text.slice(0, 2))
    const to = uciPosition(text.slice(2, 4))
    const suffix = text.slice(4)
    const moving = board[from.row]?.[from.col]
    const captured = board[to.row]?.[to.col]
    if (!moving || moving.color !== turn || captured?.color === turn || captured?.type === 'k') return invalid()
    if (!pseudoMoves(board, from).some(move => move.row === to.row && move.col === to.col)) return invalid()

    let revealedType: PieceType | null = null
    let capturedIdentity = ''
    if (moving.hidden) {
      if (suffix.length < 1 || identityColor(suffix[0]) !== moving.color) return invalid()
      revealedType = IDENTITY_TYPES[suffix[0]] || null
      if (!revealedType || !consumeIdentity(reserves, suffix[0])) return invalid()
      if (suffix.length === 2) capturedIdentity = suffix[1]
    } else {
      if (suffix.length > 1) return invalid()
      if (suffix.length === 1) capturedIdentity = suffix[0]
    }

    if (capturedIdentity) {
      if (!captured?.hidden || identityColor(capturedIdentity) !== captured.color || !consumeIdentity(reserves, capturedIdentity)) return invalid()
    } else if (suffix.length > 0 && !moving.hidden) {
      return invalid()
    }
    if (!captured?.hidden && capturedIdentity) return invalid()
    if (!captured?.hidden && moving.hidden && suffix.length === 2) return invalid()
    if (captured?.hidden && Boolean(capturedIdentity) !== (moving.color === viewer)) return invalid()

    board[from.row][from.col] = null
    board[to.row][to.col] = moving.hidden
      ? { color: moving.color, type: revealedType!, hidden: false }
      : moving
    if (isInCheck(board, turn)) return invalid()
    turn = turn === 'red' ? 'black' : 'red'
  }

  return { ok: true, errors: [] }
}

export function validateJieqiBoardPlacement(fen: string): { ok: boolean; errors: string[] } {
  const parsed = parseJieqiPublicPosition(fen)
  if (!parsed) return failure('Invalid Jieqi FEN board')
  const redKing = findKing(parsed.board, 'red')
  const blackKing = findKing(parsed.board, 'black')
  if (!redKing || !blackKing || !inPalace(redKing.row, redKing.col, 'red') || !inPalace(blackKing.row, blackKing.col, 'black')) {
    return failure('Jieqi kings must stay in their palaces')
  }
  if (isInCheck(parsed.board, parsed.turn) && isInCheck(parsed.board, parsed.turn === 'red' ? 'black' : 'red')) {
    return failure('Invalid Jieqi king position')
  }
  return { ok: true, errors: [] }
}
