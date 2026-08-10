import { useEffect, useRef } from 'react'
import { MoveRecord } from '../types'

interface Props {
  moves: MoveRecord[]
  currentIndex: number
  onJumpTo: (index: number) => void
  onToggleMark: (index: number) => void
  onUpdateNote: (index: number, note: string) => void
  navigationDisabled?: boolean
  showOnlyAnnotated?: boolean
  onShowOnlyAnnotatedChange?: (enabled: boolean) => void
}

function formatElapsedMs(elapsedMs: number): string {
  if (elapsedMs >= 10000) return `${Math.round(elapsedMs / 1000)}s`
  return `${(elapsedMs / 1000).toFixed(1)}s`
}

export default function MoveHistory({
  moves,
  currentIndex,
  onJumpTo,
  onToggleMark,
  onUpdateNote,
  navigationDisabled = false,
  showOnlyAnnotated = false,
  onShowOnlyAnnotatedChange,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const visibleMoves = showOnlyAnnotated
    ? moves.map((record, index) => ({ record, index })).filter(item => item.record.marked || item.record.note)
    : moves.map((record, index) => ({ record, index }))

  useEffect(() => {
    const listEl = listRef.current
    const activeEl = listEl?.querySelector<HTMLElement>('.move-row.active')
    if (!listEl || !activeEl) return

    const activeTop = activeEl.offsetTop
    const activeBottom = activeTop + activeEl.offsetHeight
    const visibleTop = listEl.scrollTop
    const visibleBottom = visibleTop + listEl.clientHeight

    if (activeTop < visibleTop) {
      listEl.scrollTop = activeTop
    } else if (activeBottom > visibleBottom) {
      listEl.scrollTop = activeBottom - listEl.clientHeight
    }
  }, [currentIndex])

  return (
    <div className="move-history">
      <div className="move-history-header">
        <h3>走棋记录</h3>
        {onShowOnlyAnnotatedChange && (
          <label>
            <input
              type="checkbox"
              checked={showOnlyAnnotated}
              onChange={e => onShowOnlyAnnotatedChange(e.target.checked)}
            />
            标注
          </label>
        )}
      </div>
      <div className="move-list" ref={listRef}>
        {moves.length === 0 && (
          <div style={{ color: 'var(--text-secondary)', fontSize: '13px', padding: '8px 0' }}>
            暂无走棋记录
          </div>
        )}
        {moves.length > 0 && visibleMoves.length === 0 && (
          <div style={{ color: 'var(--text-secondary)', fontSize: '13px', padding: '8px 0' }}>
            暂无标注记录
          </div>
        )}
        {visibleMoves.map(({ record, index: i }) => {
          const moveNum = Math.floor(i / 2) + 1
          const isRed = i % 2 === 0
          return (
            <div
              key={i}
              className={`move-row ${i === currentIndex ? 'active' : ''} ${navigationDisabled ? 'navigation-disabled' : ''}`}
              onClick={() => {
                if (!navigationDisabled) onJumpTo(i)
              }}
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
