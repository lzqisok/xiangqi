import { useEffect, useMemo, useRef } from 'react'
import { PieceColor } from '../../types'

const SIZE = 552, PAD = 24, CELL = 36
const STARS = [[3, 3], [3, 7], [3, 11], [7, 3], [7, 7], [7, 11], [11, 3], [11, 7], [11, 11]]

export function GomokuLanBoard({ board, moves, disabled, showOrder, winner, onMove }: {
  board: Array<Array<PieceColor | null>>
  moves: Array<{ row: number; col: number; color: PieceColor }>
  disabled: boolean
  showOrder: boolean
  winner: PieceColor | null
  onMove: (row: number, col: number) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const order = useMemo(() => new Map(moves.map((move, index) => [`${move.row},${move.col}`, index + 1])), [moves])
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = SIZE * dpr; canvas.height = SIZE * dpr
    const ctx = canvas.getContext('2d'); if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#ddb974'; ctx.fillRect(0, 0, SIZE, SIZE)
    ctx.strokeStyle = '#62411d'; ctx.lineWidth = 1
    for (let index = 0; index < 15; index++) {
      const offset = PAD + index * CELL
      ctx.beginPath(); ctx.moveTo(PAD, offset); ctx.lineTo(SIZE - PAD, offset); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(offset, PAD); ctx.lineTo(offset, SIZE - PAD); ctx.stroke()
    }
    ctx.fillStyle = '#5a3919'
    for (const [row, col] of STARS) { ctx.beginPath(); ctx.arc(PAD + col * CELL, PAD + row * CELL, 3, 0, Math.PI * 2); ctx.fill() }
    for (let row = 0; row < 15; row++) for (let col = 0; col < 15; col++) {
      const stone = board[row][col]; if (!stone) continue
      const x = PAD + col * CELL, y = PAD + row * CELL
      const gradient = ctx.createRadialGradient(x - 6, y - 7, 2, x, y, 17)
      if (stone === 'red') { gradient.addColorStop(0, '#555'); gradient.addColorStop(1, '#111') }
      else { gradient.addColorStop(0, '#fff'); gradient.addColorStop(1, '#ddd') }
      ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI * 2); ctx.fill()
      if (showOrder) { ctx.fillStyle = stone === 'red' ? '#fff' : '#333'; ctx.font = '700 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(order.get(`${row},${col}`) || ''), x, y) }
    }
    const lastMove = moves[moves.length - 1]
    if (winner && lastMove) {
      for (const [dr, dc] of [[1, 0], [0, 1], [1, 1], [1, -1]] as const) {
        const line = [{ row: lastMove.row, col: lastMove.col }]
        for (let row = lastMove.row + dr, col = lastMove.col + dc; board[row]?.[col] === winner; row += dr, col += dc) line.push({ row, col })
        for (let row = lastMove.row - dr, col = lastMove.col - dc; board[row]?.[col] === winner; row -= dr, col -= dc) line.unshift({ row, col })
        if (line.length < 5) continue
        const start = line[0], end = line[line.length - 1]
        ctx.strokeStyle = '#c92020'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(PAD + start.col * CELL, PAD + start.row * CELL); ctx.lineTo(PAD + end.col * CELL, PAD + end.row * CELL); ctx.stroke(); break
      }
    }
    const last = moves[moves.length - 1]
    if (last) { const x = PAD + last.col * CELL, y = PAD + last.row * CELL; ctx.strokeStyle = '#1677ff'; ctx.lineWidth = 2; ctx.strokeRect(x - 9, y - 9, 18, 18) }
  }, [board, moves, order, showOrder, winner])
  return <canvas ref={ref} className="gomoku-lan-board" aria-label="五子棋棋盘" onClick={event => {
    if (disabled) return
    const rect = event.currentTarget.getBoundingClientRect(), border = event.currentTarget.clientLeft
    const scale = SIZE / Math.max(1, rect.width - border * 2)
    const col = Math.round(((event.clientX - rect.left - border) * scale - PAD) / CELL)
    const row = Math.round(((event.clientY - rect.top - border) * scale - PAD) / CELL)
    if (row >= 0 && row < 15 && col >= 0 && col < 15 && !board[row][col]) onMove(row, col)
  }} />
}
