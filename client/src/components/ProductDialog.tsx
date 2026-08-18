import { FormEvent, useMemo, useState } from 'react'

export type ProductDialogField = {
  name: string
  label: string
  initialValue?: string
  placeholder?: string
  multiline?: boolean
  required?: boolean
  maxLength?: number
}

export type ProductDialogRequest = {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string | null
  dangerous?: boolean
  fields?: ProductDialogField[]
  steps?: Array<{ mark: string; title: string; description: string }>
}

type Props = ProductDialogRequest & {
  onCancel: () => void
  onConfirm: (values: Record<string, string>) => void
}

export default function ProductDialog({
  title,
  description,
  confirmLabel = '确定',
  cancelLabel = '取消',
  dangerous = false,
  fields = [],
  steps = [],
  onCancel,
  onConfirm,
}: Props) {
  const initialValues = useMemo(() => Object.fromEntries(fields.map(field => [field.name, field.initialValue || ''])), [fields])
  const [values, setValues] = useState<Record<string, string>>(initialValues)
  const canConfirm = fields.every(field => !field.required || values[field.name]?.trim())

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (canConfirm) onConfirm(values)
  }

  return <div className="product-dialog-backdrop" role="presentation" onMouseDown={() => {
    if (cancelLabel !== null) onCancel()
  }}>
    <form className="product-dialog" role="dialog" aria-modal="true" aria-labelledby="product-dialog-title" onSubmit={submit} onMouseDown={event => event.stopPropagation()}>
      <div className={`product-dialog-mark ${dangerous ? 'dangerous' : ''}`} aria-hidden="true">{dangerous ? '慎' : '弈'}</div>
      <h2 id="product-dialog-title">{title}</h2>
      {description && <p>{description}</p>}
      {steps.length > 0 && <div className="product-dialog-steps">
        {steps.map(step => <div key={step.title}>
          <b aria-hidden="true">{step.mark}</b>
          <span><strong>{step.title}</strong><small>{step.description}</small></span>
        </div>)}
      </div>}
      {fields.length > 0 && <div className="product-dialog-fields">
        {fields.map((field, index) => <label key={field.name}>
          <span>{field.label}</span>
          {field.multiline
            ? <textarea autoFocus={index === 0} rows={3} maxLength={field.maxLength} value={values[field.name] || ''} placeholder={field.placeholder} onChange={event => setValues(current => ({ ...current, [field.name]: event.target.value }))} />
            : <input autoFocus={index === 0} maxLength={field.maxLength} value={values[field.name] || ''} placeholder={field.placeholder} onChange={event => setValues(current => ({ ...current, [field.name]: event.target.value }))} />}
        </label>)}
      </div>}
      <div className="product-dialog-actions">
        {cancelLabel !== null && <button type="button" className="secondary" onClick={onCancel}>{cancelLabel}</button>}
        <button type="submit" className={dangerous ? 'dangerous' : 'primary'} disabled={!canConfirm}>{confirmLabel}</button>
      </div>
    </form>
  </div>
}
