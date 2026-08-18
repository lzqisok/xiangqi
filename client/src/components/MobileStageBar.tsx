export type MobileStageItem<T extends string> = {
  id: T
  label: string
  badge?: number | string
  available?: boolean
}

export default function MobileStageBar<T extends string>({ items, active, open, onSelect, onClose }: {
  items: MobileStageItem<T>[]
  active: T
  open: boolean
  onSelect: (id: T) => void
  onClose: () => void
}) {
  return <nav className="mobile-stage-bar" aria-label="移动端阶段工具">
    {items.filter(item => item.available !== false).map(item => <button
      key={item.id}
      className={open && item.id === active ? 'active' : ''}
      aria-pressed={open && item.id === active}
      onClick={() => open && item.id === active ? onClose() : onSelect(item.id)}
    >
      <span>{item.label}</span>
      {item.badge ? <b>{item.badge}</b> : null}
    </button>)}
  </nav>
}
