import { Board, Piece, PieceColor, Position } from '../types'
import { ROWS, COLS, applyMove, findKing } from './board'

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS
}

function isOwnPiece(board: Board, r: number, c: number, color: PieceColor): boolean {
  const p = board[r][c]
  return p !== null && p.color === color
}

function getPseudoMoves(board: Board, pos: Position): Position[] {
  const piece = board[pos.row][pos.col]
  if (!piece) return []

  const moves: Position[] = []
  const { row, col } = pos
  const color = piece.color
  const isRed = color === 'red'

  switch (piece.type) {
    case 'k': {
      // King: moves within palace, one step orthogonally
      const palaceRows = isRed ? [7, 8, 9] : [0, 1, 2]
      const palaceCols = [3, 4, 5]
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nr = row + dr, nc = col + dc
        if (palaceRows.includes(nr) && palaceCols.includes(nc) && !isOwnPiece(board, nr, nc, color)) {
          moves.push({ row: nr, col: nc })
        }
      }
      // Flying general: kings face each other on same column
      const opponentColor: PieceColor = isRed ? 'black' : 'red'
      const opKing = findKing(board, opponentColor)
      if (opKing && opKing.col === col) {
        let blocked = false
        const minR = Math.min(row, opKing.row)
        const maxR = Math.max(row, opKing.row)
        for (let r = minR + 1; r < maxR; r++) {
          if (board[r][col]) { blocked = true; break }
        }
        if (!blocked) {
          moves.push({ row: opKing.row, col: opKing.col })
        }
      }
      break
    }

    case 'a': {
      // Advisor: moves diagonally within palace
      const palaceRows = isRed ? [7, 8, 9] : [0, 1, 2]
      const palaceCols = [3, 4, 5]
      for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nr = row + dr, nc = col + dc
        if (palaceRows.includes(nr) && palaceCols.includes(nc) && !isOwnPiece(board, nr, nc, color)) {
          moves.push({ row: nr, col: nc })
        }
      }
      break
    }

    case 'b': {
      // Bishop/Elephant: moves diagonally 2 steps, cannot cross river, can be blocked
      const homeRows = isRed ? (r: number) => r >= 5 : (r: number) => r <= 4
      for (const [dr, dc] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
        const nr = row + dr, nc = col + dc
        const blockR = row + dr / 2, blockC = col + dc / 2
        if (inBounds(nr, nc) && homeRows(nr) && !isOwnPiece(board, nr, nc, color) && !board[blockR][blockC]) {
          moves.push({ row: nr, col: nc })
        }
      }
      break
    }

    case 'n': {
      // Horse/Knight: L-shape, can be blocked (蹩马脚)
      const knightMoves: [number, number, number, number][] = [
        [-2, -1, -1, 0], [-2, 1, -1, 0],
        [2, -1, 1, 0], [2, 1, 1, 0],
        [-1, -2, 0, -1], [-1, 2, 0, 1],
        [1, -2, 0, -1], [1, 2, 0, 1],
      ]
      for (const [dr, dc, blockDr, blockDc] of knightMoves) {
        const nr = row + dr, nc = col + dc
        const br = row + blockDr, bc = col + blockDc
        if (inBounds(nr, nc) && !isOwnPiece(board, nr, nc, color) && !board[br][bc]) {
          moves.push({ row: nr, col: nc })
        }
      }
      break
    }

    case 'r': {
      // Rook/Chariot: slides orthogonally
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        let nr = row + dr, nc = col + dc
        while (inBounds(nr, nc)) {
          if (board[nr][nc]) {
            if (board[nr][nc]!.color !== color) moves.push({ row: nr, col: nc })
            break
          }
          moves.push({ row: nr, col: nc })
          nr += dr; nc += dc
        }
      }
      break
    }

    case 'c': {
      // Cannon: slides orthogonally, captures by jumping over exactly one piece
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        let nr = row + dr, nc = col + dc
        let jumped = false
        while (inBounds(nr, nc)) {
          if (board[nr][nc]) {
            if (!jumped) {
              jumped = true
            } else {
              if (board[nr][nc]!.color !== color) moves.push({ row: nr, col: nc })
              break
            }
          } else if (!jumped) {
            moves.push({ row: nr, col: nc })
          }
          nr += dr; nc += dc
        }
      }
      break
    }

    case 'p': {
      // Pawn/Soldier: before crossing river, moves forward only; after, also sideways
      const forward = isRed ? -1 : 1
      const crossedRiver = isRed ? row <= 4 : row >= 5
      const nr = row + forward
      if (inBounds(nr, col) && !isOwnPiece(board, nr, col, color)) {
        moves.push({ row: nr, col: col })
      }
      if (crossedRiver) {
        for (const dc of [-1, 1]) {
          const nc = col + dc
          if (inBounds(row, nc) && !isOwnPiece(board, row, nc, color)) {
            moves.push({ row: row, col: nc })
          }
        }
      }
      break
    }
  }

  return moves
}

export function isInCheck(board: Board, color: PieceColor): boolean {
  const kingPos = findKing(board, color)
  if (!kingPos) return true

  const opponent: PieceColor = color === 'red' ? 'black' : 'red'
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = board[r][c]
      if (p && p.color === opponent) {
        const targets = getPseudoMoves(board, { row: r, col: c })
        if (targets.some(t => t.row === kingPos.row && t.col === kingPos.col)) {
          return true
        }
      }
    }
  }

  // Flying general check
  const opKing = findKing(board, opponent)
  if (opKing && opKing.col === kingPos.col) {
    let blocked = false
    const minR = Math.min(kingPos.row, opKing.row)
    const maxR = Math.max(kingPos.row, opKing.row)
    for (let r = minR + 1; r < maxR; r++) {
      if (board[r][kingPos.col]) { blocked = true; break }
    }
    if (!blocked) return true
  }

  return false
}

export function getLegalMoves(board: Board, pos: Position): Position[] {
  const piece = board[pos.row][pos.col]
  if (!piece) return []

  const pseudoMoves = getPseudoMoves(board, pos)
  return pseudoMoves.filter(to => {
    const { newBoard } = applyMove(board, pos, to)
    return !isInCheck(newBoard, piece.color)
  })
}

export function hasAnyLegalMove(board: Board, color: PieceColor): boolean {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = board[r][c]
      if (p && p.color === color) {
        const moves = getLegalMoves(board, { row: r, col: c })
        if (moves.length > 0) return true
      }
    }
  }
  return false
}

export function getGameStatus(board: Board, currentTurn: PieceColor): 'playing' | 'red-wins' | 'black-wins' | 'draw' {
  if (!hasAnyLegalMove(board, currentTurn)) {
    return currentTurn === 'red' ? 'black-wins' : 'red-wins'
  }
  return 'playing'
}
