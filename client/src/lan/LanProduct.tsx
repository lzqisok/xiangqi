import { ReactNode } from 'react'

export function LanRoomCard({ name, meta, details, onOpen }: { name: string; meta: string; details: string; onOpen: () => void }) {
  return <button className="lan-room-card" onClick={onOpen} aria-label={`${name}，${meta}，${details}`}>
    <strong>{name}</strong><span>{meta}</span><span>{details}</span>
  </button>
}

export function LanReadySeat({ side, mark, title, status, current, disabled, actionLabel, onAction, onRemove, removeDisabled }: {
  side: 'red' | 'black'
  mark: ReactNode
  title: string
  status: string
  current: boolean
  disabled: boolean
  actionLabel: string
  onAction: () => void
  onRemove?: () => void
  removeDisabled?: boolean
}) {
  return <article className={`lan-ready-seat ${side} ${typeof mark === 'string' && (mark === '●' || mark === '○') ? 'gomoku' : ''} ${current ? 'current' : ''}`}>
    <div><i>{mark}</i><span><strong>{title}</strong><small>{status}</small></span></div>
    <button className={current && status.includes('已准备') ? 'ready' : ''} disabled={disabled} onClick={onAction}>{actionLabel}</button>
    {onRemove && <button className="remove" disabled={removeDisabled} onClick={onRemove}>移除成员</button>}
  </article>
}
