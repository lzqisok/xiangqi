import { useEffect, useMemo, useRef, useState } from 'react'
import { BLACK, EMPTY } from '../core/types'
import { useGameStore } from '../store/gameStore'
import { applyMove, getCell } from '../core/board'
import { isForbiddenMove } from '../core/rules'
import { buildMoveOrderMap } from '../core/reviewMarkers'

const GRID_COUNT = 15
const CELL = 36
const PADDING = 24
const SIZE = PADDING * 2 + CELL * (GRID_COUNT - 1)

const STARS = [
  [3, 3],
  [3, 7],
  [3, 11],
  [7, 3],
  [7, 7],
  [7, 11],
  [11, 3],
  [11, 7],
  [11, 11],
]

function pointToCanvas(row: number, col: number) {
  return {
    x: PADDING + col * CELL,
    y: PADDING + row * CELL,
  }
}

export function Board() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [hoverForbidden, setHoverForbidden] = useState<{
    row: number
    col: number
  } | null>(null)
  const hoverTimeoutRef = useRef<number | null>(null)

  const board = useGameStore((s) => s.board)
  const mode = useGameStore((s) => s.mode)
  const currentPlayer = useGameStore((s) => s.currentPlayer)
  const humanPlayer = useGameStore((s) => s.humanPlayer)
  const forbiddenEnabled = useGameStore((s) => s.forbiddenEnabled)
  const lastMove = useGameStore((s) => s.lastMove)
  const moveHistory = useGameStore((s) => s.moveHistory)
  const winningLine = useGameStore((s) => s.winningLine)
  const makeMove = useGameStore((s) => s.makeMove)
  const winner = useGameStore((s) => s.winner)
  const draw = useGameStore((s) => s.draw)
  const aiThinking = useGameStore((s) => s.aiThinking)
  const isStarted = useGameStore((s) => s.isStarted)

  const dpr = useMemo(() => window.devicePixelRatio || 1, [])
  const moveOrder = useMemo(() => buildMoveOrderMap(moveHistory), [moveHistory])
  const showMoveOrder = winner !== null || draw

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    canvas.width = SIZE * dpr
    canvas.height = SIZE * dpr
    canvas.style.width = '100%'
    canvas.style.height = 'auto'

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, SIZE, SIZE)

    ctx.fillStyle = '#ddb974'
    ctx.fillRect(0, 0, SIZE, SIZE)

    ctx.strokeStyle = '#62411d'
    ctx.lineWidth = 1
    for (let i = 0; i < GRID_COUNT; i += 1) {
      const offset = PADDING + i * CELL
      ctx.beginPath()
      ctx.moveTo(PADDING, offset)
      ctx.lineTo(SIZE - PADDING, offset)
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(offset, PADDING)
      ctx.lineTo(offset, SIZE - PADDING)
      ctx.stroke()
    }

    ctx.fillStyle = '#5a3919'
    for (const [row, col] of STARS) {
      const p = pointToCanvas(row, col)
      ctx.beginPath()
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
      ctx.fill()
    }

    if (winningLine.length > 1) {
      const start = pointToCanvas(winningLine[0].row, winningLine[0].col)
      const end = pointToCanvas(
        winningLine[winningLine.length - 1].row,
        winningLine[winningLine.length - 1].col,
      )
      ctx.strokeStyle = '#c92020'
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.moveTo(start.x, start.y)
      ctx.lineTo(end.x, end.y)
      ctx.stroke()
    }

    for (let row = 0; row < GRID_COUNT; row += 1) {
      for (let col = 0; col < GRID_COUNT; col += 1) {
        const cell = board[row * GRID_COUNT + col]
        if (!cell) continue
        const { x, y } = pointToCanvas(row, col)
        const radial = ctx.createRadialGradient(x - 3, y - 3, 2, x, y, 14)

        if (cell === BLACK) {
          radial.addColorStop(0, '#636363')
          radial.addColorStop(1, '#111')
        } else {
          radial.addColorStop(0, '#fff')
          radial.addColorStop(1, '#d9d9d9')
        }
        ctx.fillStyle = radial
        ctx.beginPath()
        ctx.arc(x, y, 14, 0, Math.PI * 2)
        ctx.fill()

        if (showMoveOrder) {
          const order = moveOrder.get(row * GRID_COUNT + col)
          if (order !== undefined) {
            ctx.fillStyle = cell === BLACK ? '#fff8ed' : '#2d241b'
            ctx.font = `700 ${order >= 100 ? 9 : order >= 10 ? 10 : 12}px 'Noto Sans SC', sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(String(order), x, y + 0.5)
          }
        }
      }
    }

    if (lastMove) {
      const p = pointToCanvas(lastMove.row, lastMove.col)
      ctx.strokeStyle = '#0a70ff'
      ctx.lineWidth = 2
      ctx.strokeRect(p.x - 7, p.y - 7, 14, 14)
    }
  }, [board, dpr, lastMove, moveOrder, showMoveOrder, winningLine])

  return (
    <div className="gomoku-board-surface">
      <canvas
        aria-label="十五路五子棋棋盘"
        className={`gomoku-board-canvas${winner || aiThinking || mode === 'ai-vs-ai' ? ' gomoku-board-canvas--busy' : ''}`}
        ref={canvasRef}
        onClick={(event) => {
          const canvas = canvasRef.current
          if (!canvas) return
          if (winner || aiThinking || mode === 'ai-vs-ai') return
          if (!isStarted) return // 游戏未开始时不允许直接在棋盘上落子

          const rect = canvas.getBoundingClientRect()
          const x = (event.clientX - rect.left) * (SIZE / rect.width)
          const y = (event.clientY - rect.top) * (SIZE / rect.height)

          const col = Math.round((x - PADDING) / CELL)
          const row = Math.round((y - PADDING) / CELL)
          if (row < 0 || row >= GRID_COUNT || col < 0 || col >= GRID_COUNT) return

          // Prevent click and show hover tip if it's a forbidden move for current human
          if (
            forbiddenEnabled &&
            currentPlayer === BLACK &&
            (mode === 'pvp' || humanPlayer === BLACK) &&
            getCell(board, row, col) === EMPTY
          ) {
            const tempBoard = applyMove(board, { row, col, player: BLACK })
            if (isForbiddenMove(tempBoard, row, col, { forbiddenEnabled })) {
              setHoverForbidden({ row, col })
              if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
              hoverTimeoutRef.current = window.setTimeout(() => setHoverForbidden(null), 1500)
              return
            }
          }

          makeMove(row, col)
        }}
      />
      {hoverForbidden && (
        <div
          className="gomoku-forbidden-tip"
          style={{
            left: pointToCanvas(hoverForbidden.row, hoverForbidden.col).x,
            top: pointToCanvas(hoverForbidden.row, hoverForbidden.col).y - 20,
          }}
        >
          禁手
        </div>
      )}
    </div>
  )
}
