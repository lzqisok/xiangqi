import { forwardRef, useImperativeHandle, useRef, useEffect, useCallback, useState } from 'react'
import {
  Board as BoardType,
  BoardAnnotation,
  BoardAnnotationColor,
  BoardAnnotationType,
  Position,
  Move,
  GameStatus,
  GameStatusReason,
} from '../types'
import { ROWS, COLS } from '../engine/board'

interface Props {
  board: BoardType
  gameStatus: GameStatus
  gameStatusReason?: GameStatusReason
  selectedPos: Position | null
  legalMoves: Position[]
  lastMove: Move | null
  hintMove: Move | null
  inCheck: Position | null
  flipped: boolean
  aiThinking: boolean
  thinkingText: string
  interactionDisabled?: boolean
  annotations?: BoardAnnotation[]
  annotationTool?: {
    type: BoardAnnotationType
    color: BoardAnnotationColor
  } | null
  onAnnotationCreate?: (
    type: BoardAnnotationType,
    color: BoardAnnotationColor,
    from: Position,
    to?: Position,
  ) => void
  onCellClick: (pos: Position) => void
  onCancelSelection: () => void
}

export interface BoardHandle {
  exportPng: () => string | null
}

const CELL_SIZE = 64
const PADDING = 40
const PIECE_RADIUS = 27
const BOARD_WIDTH = (COLS - 1) * CELL_SIZE + PADDING * 2
const BOARD_HEIGHT = (ROWS - 1) * CELL_SIZE + PADDING * 2

const PIECE_CHARS: Record<string, Record<string, string>> = {
  red: { k: '帅', a: '仕', b: '相', n: '馬', r: '車', c: '炮', p: '兵' },
  black: { k: '将', a: '士', b: '象', n: '馬', r: '車', c: '砲', p: '卒' },
}

const GAME_OVER_CLASS: Record<Exclude<GameStatus, 'playing'>, string> = {
  'red-wins': 'red-win',
  'black-wins': 'black-win',
  draw: 'draw',
}

function formatGameOverText(
  status: Exclude<GameStatus, 'playing'>,
  reason?: GameStatusReason,
): string {
  if (status === 'draw') {
    const drawReason: Partial<Record<GameStatusReason, string>> = {
      repetition: '三次重复',
      'natural-limit': '自然限着',
      'move-limit': '回合上限',
      manual: '双方议和',
    }
    return reason && drawReason[reason] ? `和棋 ${drawReason[reason]}` : '和棋'
  }
  const winner = status === 'red-wins' ? '红方胜' : '黑方胜'
  const reasonText: Partial<Record<GameStatusReason, string>> = {
    checkmate: '将死',
    stalemate: '困毙',
    'illegal-position': '非法局面',
    manual: '手动结束',
    resignation: '认输',
    repetition: '长将或长捉违规',
    'natural-limit': '自然限着',
    'move-limit': '回合上限',
  }
  return reason && reasonText[reason] ? `${winner} ${reasonText[reason]}` : winner
}

const Board = forwardRef<BoardHandle, Props>(function Board(
  {
    board,
    gameStatus,
    gameStatusReason,
    selectedPos,
    legalMoves,
    lastMove,
    hintMove,
    inCheck,
    flipped,
    aiThinking,
    thinkingText,
    interactionDisabled = false,
    annotations = [],
    annotationTool = null,
    onAnnotationCreate,
    onCellClick,
    onCancelSelection,
  },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressHandledRef = useRef(false)
  const [annotationDraft, setAnnotationDraft] = useState<{
    from: Position
    to: Position
  } | null>(null)
  const animRef = useRef<{
    piece: BoardType[0][0]
    fromX: number
    fromY: number
    toX: number
    toY: number
    progress: number
    startTime: number
  } | null>(null)

  const getPixelPos = useCallback(
    (row: number, col: number): [number, number] => {
      const r = flipped ? ROWS - 1 - row : row
      const c = flipped ? COLS - 1 - col : col
      return [PADDING + c * CELL_SIZE, PADDING + r * CELL_SIZE]
    },
    [flipped],
  )

  useImperativeHandle(
    ref,
    () => ({
      exportPng: () => canvasRef.current?.toDataURL('image/png') || null,
    }),
    [],
  )

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const dpr = window.devicePixelRatio || 1
      ctx.save()
      ctx.scale(dpr, dpr)

      // Background
      ctx.fillStyle = '#e8c981'
      ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT)

      // Board border
      ctx.strokeStyle = '#6d3f22'
      ctx.lineWidth = 2.5
      ctx.strokeRect(
        PADDING - 2,
        PADDING - 2,
        (COLS - 1) * CELL_SIZE + 4,
        (ROWS - 1) * CELL_SIZE + 4,
      )

      ctx.lineWidth = 1.2
      ctx.strokeStyle = '#6d3f22'

      // Horizontal lines
      for (let r = 0; r < ROWS; r++) {
        const y = PADDING + r * CELL_SIZE
        ctx.beginPath()
        ctx.moveTo(PADDING, y)
        ctx.lineTo(PADDING + (COLS - 1) * CELL_SIZE, y)
        ctx.stroke()
      }

      // Vertical lines (split by river)
      for (let c = 0; c < COLS; c++) {
        const x = PADDING + c * CELL_SIZE
        if (c === 0 || c === COLS - 1) {
          ctx.beginPath()
          ctx.moveTo(x, PADDING)
          ctx.lineTo(x, PADDING + (ROWS - 1) * CELL_SIZE)
          ctx.stroke()
        } else {
          ctx.beginPath()
          ctx.moveTo(x, PADDING)
          ctx.lineTo(x, PADDING + 4 * CELL_SIZE)
          ctx.stroke()
          ctx.beginPath()
          ctx.moveTo(x, PADDING + 5 * CELL_SIZE)
          ctx.lineTo(x, PADDING + 9 * CELL_SIZE)
          ctx.stroke()
        }
      }

      // Palace diagonals
      const drawPalaceDiag = (topRow: number) => {
        const [x1, y1] = getPixelPos(topRow, 3)
        const [x2, y2] = getPixelPos(topRow + 2, 5)
        const [x3, y3] = getPixelPos(topRow, 5)
        const [x4, y4] = getPixelPos(topRow + 2, 3)
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(x3, y3)
        ctx.lineTo(x4, y4)
        ctx.stroke()
      }
      drawPalaceDiag(0)
      drawPalaceDiag(7)

      // River text
      ctx.fillStyle = '#6d3f22'
      ctx.font = '26px "Noto Serif SC", serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const riverY = PADDING + 4.5 * CELL_SIZE
      ctx.fillText('楚 河', PADDING + 1.5 * CELL_SIZE, riverY)
      ctx.fillText('汉 界', PADDING + 6.5 * CELL_SIZE, riverY)

      // Star points (position markers)
      const starPoints = [
        [2, 1],
        [2, 7],
        [3, 0],
        [3, 2],
        [3, 4],
        [3, 6],
        [3, 8],
        [6, 0],
        [6, 2],
        [6, 4],
        [6, 6],
        [6, 8],
        [7, 1],
        [7, 7],
      ]
      for (const [r, c] of starPoints) {
        drawStarPoint(ctx, ...getPixelPos(r, c), c, r)
      }

      // Highlights
      if (lastMove) {
        highlightCell(
          ctx,
          ...getPixelPos(lastMove.from.row, lastMove.from.col),
          'rgba(70, 132, 123, 0.38)',
        )
        highlightCell(
          ctx,
          ...getPixelPos(lastMove.to.row, lastMove.to.col),
          'rgba(70, 132, 123, 0.38)',
        )
      }
      if (hintMove) {
        outlineCell(
          ctx,
          ...getPixelPos(hintMove.from.row, hintMove.from.col),
          'rgba(214, 166, 75, 0.9)',
        )
        outlineCell(
          ctx,
          ...getPixelPos(hintMove.to.row, hintMove.to.col),
          'rgba(47, 158, 111, 0.9)',
        )
      }
      if (selectedPos) {
        highlightCell(
          ctx,
          ...getPixelPos(selectedPos.row, selectedPos.col),
          'rgba(232, 178, 55, 0.48)',
        )
      }
      if (inCheck) {
        highlightCell(ctx, ...getPixelPos(inCheck.row, inCheck.col), 'rgba(216, 73, 56, 0.34)')
      }

      // Legal move dots
      for (const m of legalMoves) {
        const [mx, my] = getPixelPos(m.row, m.col)
        const isCapture = board[m.row][m.col] !== null
        if (isCapture) {
          ctx.strokeStyle = 'rgba(47, 158, 111, 0.62)'
          ctx.lineWidth = 3
          ctx.beginPath()
          ctx.arc(mx, my, PIECE_RADIUS + 2, 0, Math.PI * 2)
          ctx.stroke()
        } else {
          ctx.fillStyle = 'rgba(47, 158, 111, 0.48)'
          ctx.beginPath()
          ctx.arc(mx, my, 8, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // Pieces
      const animating = animRef.current
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const piece = board[r][c]
          if (!piece) continue
          if (animating && animating.piece === piece) continue
          const [px, py] = getPixelPos(r, c)
          drawPiece(
            ctx,
            px,
            py,
            piece.color,
            piece.hidden ? '暗' : PIECE_CHARS[piece.color][piece.type],
            piece.hidden,
          )
        }
      }

      // Animated piece
      if (animating && animating.piece) {
        const t = easeOutCubic(animating.progress)
        const x = animating.fromX + (animating.toX - animating.fromX) * t
        const y = animating.fromY + (animating.toY - animating.fromY) * t
        drawPiece(
          ctx,
          x,
          y,
          animating.piece.color,
          animating.piece.hidden ? '暗' : PIECE_CHARS[animating.piece.color][animating.piece.type],
          animating.piece.hidden,
        )
      }

      for (const annotation of annotations) drawBoardAnnotation(ctx, annotation, getPixelPos)
      if (annotationTool && annotationDraft) {
        drawBoardAnnotation(
          ctx,
          {
            id: 'annotation-draft',
            type: annotationTool.type,
            color: annotationTool.color,
            from: annotationDraft.from,
            to: annotationTool.type === 'arrow' ? annotationDraft.to : undefined,
          },
          getPixelPos,
          true,
        )
      }

      ctx.restore()
    },
    [
      annotationDraft,
      annotationTool,
      annotations,
      board,
      selectedPos,
      legalMoves,
      lastMove,
      hintMove,
      inCheck,
      flipped,
      getPixelPos,
    ],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = BOARD_WIDTH * dpr
    canvas.height = BOARD_HEIGHT * dpr
    canvas.style.width = `${BOARD_WIDTH}px`
    canvas.style.height = `${BOARD_HEIGHT}px`
    const ctx = canvas.getContext('2d')!
    draw(ctx)
  }, [draw])

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  const getClosestPosition = useCallback(
    (clientX: number, clientY: number, toleranceRatio: number): Position | null => {
      const canvas = canvasRef.current
      if (!canvas) return null
      const rect = canvas.getBoundingClientRect()
      const x = (clientX - rect.left) * (BOARD_WIDTH / rect.width)
      const y = (clientY - rect.top) * (BOARD_HEIGHT / rect.height)

      let minDist = Infinity
      let closest: Position | null = null
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const [px, py] = getPixelPos(r, c)
          const dist = Math.hypot(x - px, y - py)
          if (dist < CELL_SIZE * toleranceRatio && dist < minDist) {
            minDist = dist
            closest = { row: r, col: c }
          }
        }
      }
      return closest
    },
    [getPixelPos],
  )

  const getPointerTolerance = useCallback((pointerType: string) => {
    const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches
    return pointerType === 'touch' || pointerType === 'pen' || coarsePointer ? 0.68 : 0.5
  }, [])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (interactionDisabled) return
      if (annotationTool) {
        const position = getClosestPosition(
          e.clientX,
          e.clientY,
          getPointerTolerance(e.pointerType),
        )
        if (position) {
          e.currentTarget.setPointerCapture(e.pointerId)
          setAnnotationDraft({ from: position, to: position })
        }
        return
      }
      longPressHandledRef.current = false
      clearLongPressTimer()
      const pointerType = e.pointerType
      const supportsLongPress =
        pointerType === 'touch' ||
        pointerType === 'pen' ||
        window.matchMedia?.('(pointer: coarse)').matches
      if (!supportsLongPress) return

      longPressTimerRef.current = setTimeout(() => {
        longPressHandledRef.current = true
        onCancelSelection()
        if (pointerType === 'touch') navigator.vibrate?.(12)
      }, 520)
    },
    [
      annotationTool,
      clearLongPressTimer,
      getClosestPosition,
      getPointerTolerance,
      interactionDisabled,
      onCancelSelection,
    ],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!annotationTool || !annotationDraft || interactionDisabled) return
      const position = getClosestPosition(e.clientX, e.clientY, getPointerTolerance(e.pointerType))
      if (position) setAnnotationDraft((current) => (current ? { ...current, to: position } : null))
    },
    [annotationDraft, annotationTool, getClosestPosition, getPointerTolerance, interactionDisabled],
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (interactionDisabled) return
      if (annotationTool && annotationDraft) {
        const position =
          getClosestPosition(e.clientX, e.clientY, getPointerTolerance(e.pointerType)) ||
          annotationDraft.to
        onAnnotationCreate?.(
          annotationTool.type,
          annotationTool.color,
          annotationDraft.from,
          position,
        )
        setAnnotationDraft(null)
        if (e.pointerType === 'touch') navigator.vibrate?.(8)
        return
      }
      clearLongPressTimer()
      if (longPressHandledRef.current) return

      const closest = getClosestPosition(e.clientX, e.clientY, getPointerTolerance(e.pointerType))
      if (closest) {
        if (e.pointerType === 'touch') navigator.vibrate?.(8)
        onCellClick(closest)
      }
    },
    [
      annotationDraft,
      annotationTool,
      clearLongPressTimer,
      getClosestPosition,
      getPointerTolerance,
      interactionDisabled,
      onAnnotationCreate,
      onCellClick,
    ],
  )

  const handlePointerCancel = useCallback(() => {
    clearLongPressTimer()
    setAnnotationDraft(null)
  }, [clearLongPressTimer])

  useEffect(() => clearLongPressTimer, [clearLongPressTimer])

  useEffect(() => {
    if (!annotationTool) setAnnotationDraft(null)
  }, [annotationTool])

  return (
    <div className="board-wrapper">
      <canvas
        ref={canvasRef}
        aria-label={`中国象棋棋盘，${annotationTool ? `${annotationTool.type === 'arrow' ? '箭头' : '圈点'}标注模式` : interactionDisabled ? '当前不可操作' : '可落子'}`}
        className={`board-canvas ${interactionDisabled ? 'interaction-disabled' : ''} ${annotationTool ? 'annotation-active' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerCancel}
      />
      {aiThinking && gameStatus === 'playing' && (
        <div className="board-thinking-banner" aria-live="polite">
          {thinkingText}
        </div>
      )}
      {gameStatus !== 'playing' && (
        <div className={`board-game-over-banner ${GAME_OVER_CLASS[gameStatus]}`} aria-live="polite">
          {formatGameOverText(gameStatus, gameStatusReason)}
        </div>
      )}
    </div>
  )
})

export default Board

function drawPiece(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  char: string,
  hidden = false,
) {
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.beginPath()
  ctx.arc(x + 1.5, y + 2.5, PIECE_RADIUS, 0, Math.PI * 2)
  ctx.fill()

  // Piece body
  const grad = ctx.createRadialGradient(x - 6, y - 6, 2, x, y, PIECE_RADIUS)
  grad.addColorStop(0, hidden ? '#665846' : '#fff4d8')
  grad.addColorStop(1, hidden ? '#2e2923' : '#e3c37d')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(x, y, PIECE_RADIUS, 0, Math.PI * 2)
  ctx.fill()

  // Border
  ctx.strokeStyle = '#9a6a32'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(x, y, PIECE_RADIUS, 0, Math.PI * 2)
  ctx.stroke()

  // Inner border
  ctx.strokeStyle = hidden
    ? color === 'red'
      ? '#d98c72'
      : '#c9bca8'
    : color === 'red'
      ? '#d84938'
      : '#1d2421'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(x, y, PIECE_RADIUS - 4, 0, Math.PI * 2)
  ctx.stroke()

  // Text
  ctx.fillStyle = hidden
    ? color === 'red'
      ? '#f0b09c'
      : '#e1d5c3'
    : color === 'red'
      ? '#d84938'
      : '#1d2421'
  ctx.font = `${hidden ? '600' : 'bold'} ${hidden ? 20 : 24}px "Noto Serif SC", serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(char, x, y + 1)
}

function highlightCell(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.fillStyle = color
  ctx.fillRect(x - CELL_SIZE / 2, y - CELL_SIZE / 2, CELL_SIZE, CELL_SIZE)
}

const ANNOTATION_COLORS: Record<BoardAnnotationColor, string> = {
  red: '#c83f36',
  green: '#2c8b64',
  blue: '#347aaa',
}

function drawBoardAnnotation(
  ctx: CanvasRenderingContext2D,
  annotation: BoardAnnotation,
  getPixelPos: (row: number, col: number) => [number, number],
  draft = false,
) {
  const [fromX, fromY] = getPixelPos(annotation.from.row, annotation.from.col)
  const color = ANNOTATION_COLORS[annotation.color]
  ctx.save()
  ctx.globalAlpha = draft ? 0.68 : 0.86
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.shadowColor = 'rgba(255,248,232,.72)'
  ctx.shadowBlur = 3

  if (annotation.type === 'circle') {
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.arc(fromX, fromY, PIECE_RADIUS + 6, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
    return
  }

  if (!annotation.to) {
    ctx.restore()
    return
  }
  const [targetX, targetY] = getPixelPos(annotation.to.row, annotation.to.col)
  const angle = Math.atan2(targetY - fromY, targetX - fromX)
  const distance = Math.hypot(targetX - fromX, targetY - fromY)
  if (distance < 1) {
    ctx.restore()
    return
  }
  const startOffset = 18
  const endOffset = 26
  const startX = fromX + Math.cos(angle) * startOffset
  const startY = fromY + Math.sin(angle) * startOffset
  const endX = targetX - Math.cos(angle) * endOffset
  const endY = targetY - Math.sin(angle) * endOffset
  ctx.lineWidth = 7
  ctx.beginPath()
  ctx.moveTo(startX, startY)
  ctx.lineTo(endX, endY)
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.beginPath()
  ctx.moveTo(targetX - Math.cos(angle) * 12, targetY - Math.sin(angle) * 12)
  ctx.lineTo(endX + Math.cos(angle + Math.PI / 2) * 11, endY + Math.sin(angle + Math.PI / 2) * 11)
  ctx.lineTo(endX + Math.cos(angle - Math.PI / 2) * 11, endY + Math.sin(angle - Math.PI / 2) * 11)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function outlineCell(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.strokeStyle = color
  ctx.lineWidth = 3
  ctx.strokeRect(x - CELL_SIZE / 2 + 2, y - CELL_SIZE / 2 + 2, CELL_SIZE - 4, CELL_SIZE - 4)
}

function drawStarPoint(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  col: number,
  _row: number,
) {
  const len = 6
  const gap = 4
  ctx.strokeStyle = '#6d3f22'
  ctx.lineWidth = 1

  const dirs: [number, number][] = []
  if (col > 0) {
    dirs.push([-1, -1])
    dirs.push([-1, 1])
  }
  if (col < COLS - 1) {
    dirs.push([1, -1])
    dirs.push([1, 1])
  }

  for (const [dx, dy] of dirs) {
    ctx.beginPath()
    ctx.moveTo(x + dx * gap, y + dy * gap)
    ctx.lineTo(x + dx * gap, y + dy * (gap + len))
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x + dx * gap, y + dy * gap)
    ctx.lineTo(x + dx * (gap + len), y + dy * gap)
    ctx.stroke()
  }
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}
