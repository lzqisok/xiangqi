import { useEffect, useMemo, useState } from 'react'
import { buildJieqiReplayFrames } from '../jieqi-record/replay'
import type {
  JieqiPublicMoveEvent,
  JieqiPublicProjection,
  JieqiReplayCapture,
  JieqiReplayFrame,
  JieqiSeatProjection,
} from '../jieqi-record/types'
import type { Board as BoardType, Move, Piece, PieceColor, PieceType } from '../types'
import Board from './Board'

export interface JieqiRecordReplayProps {
  record: JieqiPublicProjection | JieqiSeatProjection
  onBack: () => void
  initialPly?: number
  backLabel?: string
}

const PIECE_CHARS: Record<PieceColor, Record<PieceType, string>> = {
  red: { k: '帅', a: '仕', b: '相', n: '馬', r: '車', c: '炮', p: '兵' },
  black: { k: '将', a: '士', b: '象', n: '馬', r: '車', c: '砲', p: '卒' },
}

const ignoreBoardClick = () => undefined
const ignoreBoardCancel = () => undefined

function copyPublicEvent(event: JieqiPublicMoveEvent): JieqiPublicMoveEvent {
  return {
    kind: 'move',
    ply: event.ply,
    color: event.color,
    from: { row: event.from.row, col: event.from.col },
    to: { row: event.to.row, col: event.to.col },
    revealed: event.revealed,
    capture: event.capture
      ? event.capture.state === 'covered'
        ? { state: 'covered', color: event.capture.color }
        : { state: 'revealed', color: event.capture.color, type: event.capture.type }
      : undefined,
    elapsedMs: event.elapsedMs,
  }
}

/** Runtime guard plus field whitelist: referee identities and unknown import fields are dropped. */
function copySafeProjection(
  record: JieqiPublicProjection | JieqiSeatProjection,
): JieqiPublicProjection | JieqiSeatProjection | null {
  if (record.audience !== 'public' && record.audience !== 'red' && record.audience !== 'black') {
    return null
  }
  const base = {
    kind: 'jieqi-record-projection' as const,
    schemaVersion: 1 as const,
    recordId: record.recordId,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    startingTurn: record.startingTurn,
    audience: record.audience,
    initialBoard: record.initialBoard.map((row) =>
      row.map((piece) => {
        if (!piece) return null
        return piece.state === 'covered'
          ? {
              state: 'covered' as const,
              color: piece.color,
              movementType: piece.movementType,
            }
          : { state: 'revealed' as const, color: piece.color, type: piece.type }
      }),
    ),
    events: record.events.map(copyPublicEvent),
  }
  if (record.audience === 'public') return { ...base, audience: 'public' }
  return {
    ...base,
    audience: record.audience,
    privateEvents: record.privateEvents.map((event) => ({
      kind: 'hidden-capture',
      ply: event.ply,
      capturedBy: event.capturedBy,
      capturedColor: event.capturedColor,
      capturedType: event.capturedType,
    })),
  }
}

function toBoard(frame: JieqiReplayFrame): BoardType {
  return frame.board.map((row) =>
    row.map((piece): Piece | null => {
      if (!piece) return null
      if (piece.state === 'covered') {
        // `movementType` is public. Deliberately never read the replay piece's `identity` field.
        return {
          color: piece.color,
          type: piece.movementType,
          hidden: true,
          darkType: piece.movementType,
        }
      }
      return { color: piece.color, type: piece.type }
    }),
  )
}

function formatCoordinate(event: JieqiPublicMoveEvent): string {
  return `${event.from.col + 1},${event.from.row + 1} → ${event.to.col + 1},${event.to.row + 1}`
}

function formatPublicMove(event: JieqiPublicMoveEvent): string {
  const details: string[] = []
  if (event.revealed) details.push(`揭${PIECE_CHARS[event.color][event.revealed]}`)
  if (event.capture?.state === 'covered') details.push('吃暗子')
  if (event.capture?.state === 'revealed') {
    details.push(`吃${PIECE_CHARS[event.capture.color][event.capture.type]}`)
  }
  return `${formatCoordinate(event)}${details.length > 0 ? ` · ${details.join(' · ')}` : ''}`
}

function viewLabel(audience: 'public' | PieceColor): string {
  return audience === 'public'
    ? '公开视角 · 观战'
    : `本人视角 · ${audience === 'red' ? '红方' : '黑方'}`
}

function turnLabel(color: PieceColor): string {
  return color === 'red' ? '红方走' : '黑方走'
}

function captureLabel(capture: JieqiReplayCapture): string {
  if (capture.visibleType) return PIECE_CHARS[capture.color][capture.visibleType]
  return capture.wasCovered ? '暗' : '未知'
}

function lastMoveForFrame(board: BoardType, event: JieqiPublicMoveEvent | undefined): Move | null {
  if (!event) return null
  const piece = board[event.to.row]?.[event.to.col]
  if (!piece) return null
  return {
    from: { row: event.from.row, col: event.from.col },
    to: { row: event.to.row, col: event.to.col },
    piece,
  }
}

export default function JieqiRecordReplay({
  record,
  onBack,
  initialPly = 0,
  backLabel = '返回揭棋记录',
}: JieqiRecordReplayProps) {
  const safeRecord = useMemo(() => {
    try {
      return copySafeProjection(record)
    } catch {
      return null
    }
  }, [record])
  const replay = useMemo(() => {
    if (!safeRecord) return { frames: [] as JieqiReplayFrame[], invalid: true }
    try {
      return { frames: buildJieqiReplayFrames(safeRecord), invalid: false }
    } catch {
      return { frames: [] as JieqiReplayFrame[], invalid: true }
    }
  }, [safeRecord])
  const lastPly = Math.max(0, replay.frames.length - 1)
  const [ply, setPly] = useState(() => Math.min(Math.max(0, initialPly), lastPly))

  useEffect(() => {
    setPly((current) => Math.min(current, lastPly))
  }, [lastPly])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') setPly((current) => Math.max(0, current - 1))
      if (event.key === 'ArrowRight') setPly((current) => Math.min(lastPly, current + 1))
      if (event.key === 'Home') setPly(0)
      if (event.key === 'End') setPly(lastPly)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [lastPly])

  if (!safeRecord || replay.invalid || !replay.frames[ply]) {
    return (
      <main className="jieqi-record-replay jieqi-record-replay-invalid">
        <button className="jieqi-record-back" type="button" onClick={onBack}>
          <span aria-hidden="true">←</span>
          {backLabel}
        </button>
        <section role="alert">
          <h1>无法安全回放</h1>
          <p>这份文件不是有效的公开或本人席位揭棋记录，已停止读取。</p>
        </section>
      </main>
    )
  }

  const frame = replay.frames[ply]
  const board = toBoard(frame)
  const currentEvent = ply > 0 ? safeRecord.events[ply - 1] : undefined
  const lastMove = lastMoveForFrame(board, currentEvent)

  return (
    <main className="jieqi-record-replay">
      <header className="jieqi-record-replay-header">
        <button className="jieqi-record-back" type="button" onClick={onBack}>
          <span aria-hidden="true">←</span>
          {backLabel}
        </button>
        <div className="jieqi-record-replay-title">
          <small>JIEQI READ-ONLY REPLAY</small>
          <h1>{safeRecord.name}</h1>
        </div>
        <div className={`jieqi-record-view-banner ${safeRecord.audience}`}>
          <strong>{viewLabel(safeRecord.audience)}</strong>
          <span>只读前向回放 · 不含裁判视角</span>
        </div>
      </header>

      <div className="jieqi-record-replay-layout">
        <section className="jieqi-record-board-stage" aria-label="揭棋只读回放棋盘">
          <div className="jieqi-record-frame-status" aria-live="polite">
            <span>{turnLabel(frame.turn)}</span>
            <strong>
              第 {ply} / {lastPly} 手
            </strong>
          </div>
          <Board
            board={board}
            gameStatus="playing"
            selectedPos={null}
            legalMoves={[]}
            lastMove={lastMove}
            hintMove={null}
            inCheck={null}
            flipped={safeRecord.audience === 'black'}
            aiThinking={false}
            thinkingText=""
            interactionDisabled
            annotations={[]}
            onCellClick={ignoreBoardClick}
            onCancelSelection={ignoreBoardCancel}
          />
          <nav className="jieqi-record-replay-controls" aria-label="回放控制">
            <button
              type="button"
              onClick={() => setPly(0)}
              disabled={ply === 0}
              aria-label="回到开局"
            >
              |‹
            </button>
            <button
              type="button"
              onClick={() => setPly((current) => Math.max(0, current - 1))}
              disabled={ply === 0}
            >
              上一步
            </button>
            <input
              aria-label="回放手数"
              type="range"
              min={0}
              max={lastPly}
              value={ply}
              onChange={(event) => setPly(Number(event.target.value))}
            />
            <button
              type="button"
              onClick={() => setPly((current) => Math.min(lastPly, current + 1))}
              disabled={ply === lastPly}
            >
              下一步
            </button>
            <button
              type="button"
              onClick={() => setPly(lastPly)}
              disabled={ply === lastPly}
              aria-label="前往终局"
            >
              ›|
            </button>
          </nav>
        </section>

        <aside className="jieqi-record-replay-panel">
          <section className="jieqi-record-current-move">
            <small>当前公开走法</small>
            <strong>{currentEvent ? formatPublicMove(currentEvent) : '开局暗子阵型'}</strong>
            <span>走法信息为双方与观战者均可见的公开部分。</span>
          </section>

          <section className="jieqi-record-captures" aria-label="当前视角已知的吃子信息">
            <header>
              <h2>已吃棋子</h2>
              <small>按 {viewLabel(safeRecord.audience)} 授权显示</small>
            </header>
            {(['red', 'black'] as const).map((capturedBy) => {
              const captures = frame.captured.filter((capture) => capture.capturedBy === capturedBy)
              return (
                <div className={`jieqi-record-capture-side ${capturedBy}`} key={capturedBy}>
                  <strong>{capturedBy === 'red' ? '红方已吃' : '黑方已吃'}</strong>
                  <div className="jieqi-record-capture-list">
                    {captures.length === 0 && <span>暂无</span>}
                    {captures.map((capture) => (
                      <span
                        className={`jieqi-record-capture-piece ${capture.color} ${capture.visibleType ? '' : 'identity-hidden'}`}
                        key={`${capture.ply}-${capture.capturedBy}`}
                        title={
                          capture.visibleType
                            ? capture.wasCovered
                              ? '本人座位获知的暗子身份'
                              : '公开的明子身份'
                            : '该暗子身份不对当前座位公开'
                        }
                      >
                        {captureLabel(capture)}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </section>

          <section className="jieqi-record-move-list" aria-label="公开走法列表">
            <header>
              <h2>公开走法</h2>
              <span>{safeRecord.events.length} 手</span>
            </header>
            <ol>
              {safeRecord.events.slice(0, ply).map((event) => (
                <li className={event.ply === ply ? 'active' : ''} key={event.ply}>
                  <button type="button" onClick={() => setPly(event.ply)}>
                    <span>{event.ply}.</span>
                    <strong>{formatPublicMove(event)}</strong>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </main>
  )
}
