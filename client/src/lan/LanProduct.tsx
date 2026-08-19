import { ReactNode } from 'react'

export function LanQuickMatch<T extends string>({
  nickname,
  onNickname,
  options,
  selected,
  onSelect,
  matching,
  onMatch,
}: {
  nickname: string
  onNickname: (value: string) => void
  options: Array<{ value: T; label: string; description: string }>
  selected: T
  onSelect: (value: T) => void
  matching: boolean
  onMatch: () => void
}) {
  const choice = options.find((option) => option.value === selected)!
  return (
    <section className="lan-quick-match card" aria-label="快速匹配">
      <div className="lan-quick-copy">
        <small>QUICK MATCH</small>
        <h2>快速开始</h2>
        <p>自动寻找相同玩法的在线棋友，双方到齐后立即开局。</p>
      </div>
      <label>
        你的昵称
        <input
          value={nickname}
          maxLength={20}
          onChange={(event) => onNickname(event.target.value)}
          placeholder="输入昵称后开始匹配"
          autoComplete="nickname"
        />
      </label>
      <div className="lan-quick-options" aria-label="匹配玩法">
        {options.map((option) => (
          <button
            type="button"
            className={selected === option.value ? 'active' : ''}
            key={option.value}
            onClick={() => onSelect(option.value)}
          >
            <strong>{option.label}</strong>
            <span>{option.description}</span>
          </button>
        ))}
      </div>
      <button
        className="lan-quick-submit"
        disabled={!nickname.trim() || matching}
        onClick={onMatch}
      >
        {matching ? '正在寻找对手…' : `快速匹配${choice.label}`}
      </button>
    </section>
  )
}

export function LanRoomCard({
  name,
  meta,
  details,
  actionLabel,
  onOpen,
}: {
  name: string
  meta: string
  details: string
  actionLabel: string
  onOpen: () => void
}) {
  return (
    <button className="lan-room-card" onClick={onOpen} aria-label={`${name}，${meta}，${details}`}>
      <strong>{name}</strong>
      <span className="lan-room-meta">{meta}</span>
      <span className="lan-room-details">{details}</span>
      <em className="lan-room-action">{actionLabel}</em>
    </button>
  )
}

export function LanReadySeat({
  side,
  mark,
  title,
  status,
  current,
  disabled,
  actionLabel,
  onAction,
  onRemove,
  removeDisabled,
}: {
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
  return (
    <article
      className={`lan-ready-seat ${side} ${typeof mark === 'string' && (mark === '●' || mark === '○') ? 'gomoku' : ''} ${current ? 'current' : ''}`}
    >
      <div>
        <i>{mark}</i>
        <span>
          <strong>{title}</strong>
          <small>{status}</small>
        </span>
      </div>
      <button
        className={current && status.includes('已准备') ? 'ready' : ''}
        disabled={disabled}
        onClick={onAction}
      >
        {actionLabel}
      </button>
      {onRemove && (
        <button className="remove" disabled={removeDisabled} onClick={onRemove}>
          移除成员
        </button>
      )}
    </article>
  )
}
