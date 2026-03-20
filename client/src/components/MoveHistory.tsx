import { useEffect, useRef } from 'react'
import { MoveRecord } from '../types'

interface Props {
  moves: MoveRecord[]
  currentIndex: number
  onJumpTo: (index: number) => void
}

function formatElapsedMs(elapsedMs: number): string {
  if (elapsedMs >= 10000) return `${Math.round(elapsedMs / 1000)}s`
  return `${(elapsedMs / 1000).toFixed(1)}s`
}

export default function MoveHistory({ moves, currentIndex, onJumpTo }: Props) {
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
