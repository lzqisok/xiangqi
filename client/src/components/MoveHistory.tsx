import { useEffect, useRef } from 'react'
import { MoveRecord } from '../types'

interface Props {
  moves: MoveRecord[]
  currentIndex: number
  onJumpTo: (index: number) => void
  onToggleMark: (index: number) => void
  onUpdateNote: (index: number, note: string) => void
}

function formatElapsedMs(elapsedMs: number): string {
  if (elapsedMs >= 10000) return `${Math.round(elapsedMs / 1000)}s`
  return `${(elapsedMs / 1000).toFixed(1)}s`
}

export default function MoveHistory({ moves, currentIndex, onJumpTo, onToggleMark, onUpdateNote }: Props) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (listRef.current) {
      const activeEl = listRef.current.querySelector('.move-row.active')
      activeEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [currentIndex])

  return (
    <div className="move-history">
      <h3>走棋记录</h3>
      <div className="move-list" ref={listRef}>
        {moves.length === 0 && (
          <div style={{ color: 'var(--text-secondary)', fontSize: '13px', padding: '8px 0' }}>
            暂无走棋记录
          </div>
        )}
        {moves.map((record, i) => {
          const moveNum = Math.floor(i / 2) + 1
          const isRed = i % 2 === 0
          return (
            <div
              key={i}
              className={`move-row ${i === currentIndex ? 'active' : ''}`}
              onClick={() => onJumpTo(i)}
            >
              {isRed && <span className="move-number">{moveNum}.</span>}
              {!isRed && <span className="move-number" />}
              <span className={`move-text ${isRed ? 'red' : 'black'}`}>
                {record.notation}
              </span>
              {record.note && <span className="move-note" title={record.note}>注</span>}
              <button
                className={`move-mark ${record.marked ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleMark(i)
                }}
                title={record.marked ? '取消标记' : '标记关键局面'}
              >
                {record.marked ? '★' : '☆'}
              </button>
              <button
                className="move-note-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  const note = window.prompt('备注', record.note || '')
                  if (note !== null) onUpdateNote(i, note)
                }}
                title="编辑备注"
              >
                记
              </button>
              {record.elapsedMs !== undefined && record.source?.startsWith('ai-') && (
                <span className="move-meta">{formatElapsedMs(record.elapsedMs)}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
