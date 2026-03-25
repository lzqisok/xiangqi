import { useEffect, useMemo, useState } from 'react'
import Board from './Board'
import { boardToFen, parseFen, ROWS, COLS } from '../engine/board'
import { Board as BoardType, Piece, PieceColor, PieceType, Position } from '../types'

const DEFAULT_EDITOR_FEN = '4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1'

const PIECE_LABELS: Record<PieceColor, Record<PieceType, string>> = {
  red: { k: '帅', a: '仕', b: '相', n: '马', r: '车', c: '炮', p: '兵' },
  black: { k: '将', a: '士', b: '象', n: '马', r: '车', c: '砲', p: '卒' },
}

function createEmptyBoard(): BoardType {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => null))
}

function safeParseFen(fen: string): { board: BoardType; turn: PieceColor } {
  try {
    return parseFen(fen)
  } catch {
    return parseFen(DEFAULT_EDITOR_FEN)
  }
}

export default function EndgameBoardEditor({
  fen,
  onChange,
}: {
  fen: string
  onChange: (fen: string) => void
}) {
  const [{ board, turn }, setState] = useState(() => safeParseFen(fen || DEFAULT_EDITOR_FEN))
  const [selectedPiece, setSelectedPiece] = useState<Piece | null>({ type: 'r', color: 'red' })

  useEffect(() => {
    if (!fen.trim()) return
    try {
      const parsed = parseFen(fen)
      setState(parsed)
    } catch {
      // Keep the last valid visual board if manual FEN editing is temporarily invalid.
    }
  }, [fen])

  const sync = (nextBoard: BoardType, nextTurn: PieceColor) => {
    setState({ board: nextBoard, turn: nextTurn })
    onChange(boardToFen(nextBoard, nextTurn))
  }

  const handleCellClick = (pos: Position) => {
    const nextBoard = board.map(row => row.slice())
    nextBoard[pos.row][pos.col] = selectedPiece ? { ...selectedPiece } : null
    sync(nextBoard, turn)
  }

  const palette = useMemo(() => {
    const pieces: Piece[] = []
    ;(['red', 'black'] as const).forEach(color => {
      ;(['k', 'a', 'b', 'n', 'r', 'c', 'p'] as const).forEach(type => {
        pieces.push({ color, type })
      })
    })
    return pieces
  }, [])

  return (
    <div className="endgame-board-editor">
      <div className="endgame-board-toolbar">
        <div className="endgame-board-turn">
          <span>轮到：</span>
          <button
            className={turn === 'red' ? 'active' : ''}
            onClick={() => sync(board, 'red')}
          >
            红方
          </button>
          <button
            className={turn === 'black' ? 'active' : ''}
            onClick={() => sync(board, 'black')}
          >
            黑方
          </button>
        </div>
        <div className="endgame-board-actions">
          <button onClick={() => setSelectedPiece(null)} className={!selectedPiece ? 'active' : ''}>擦除</button>
          <button onClick={() => sync(createEmptyBoard(), turn)}>清空棋盘</button>
          <button onClick={() => sync(safeParseFen(DEFAULT_EDITOR_FEN).board, 'red')}>仅保留将帅</button>
        </div>
      </div>

      <div className="endgame-piece-palette">
        {palette.map(piece => {
          const active = selectedPiece?.color === piece.color && selectedPiece?.type === piece.type
          return (
            <button
              key={`${piece.color}-${piece.type}`}
              className={`palette-piece ${piece.color} ${active ? 'active' : ''}`}
              onClick={() => setSelectedPiece(piece)}
            >
              {PIECE_LABELS[piece.color][piece.type]}
            </button>
          )
        })}
      </div>

      <Board
        board={board}
        gameStatus="playing"
        selectedPos={null}
        legalMoves={[]}
        lastMove={null}
        hintMove={null}
        inCheck={null}
        flipped={false}
        onCellClick={handleCellClick}
      />
    </div>
  )
}
