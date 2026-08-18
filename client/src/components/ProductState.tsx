export default function ProductState({
  kind = 'empty',
  title,
  description,
  action,
}: {
  kind?: 'empty' | 'loading' | 'error'
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className={`product-state ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span aria-hidden="true">{kind === 'loading' ? '候' : kind === 'error' ? '!' : '弈'}</span>
      <strong>{title}</strong>
      {description && <small>{description}</small>}
      {action && <button onClick={action.onClick}>{action.label}</button>}
    </div>
  )
}
