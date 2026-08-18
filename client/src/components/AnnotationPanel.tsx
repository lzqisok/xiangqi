import { ANNOTATION_COLOR_LABELS, ANNOTATION_TYPE_LABELS, formatAnnotation } from '../annotations/model'
import { BoardAnnotation, BoardAnnotationColor, BoardAnnotationType } from '../types'

export default function AnnotationPanel({ annotations, tool, color, onToolChange, onColorChange, onRemove, onUndo, onClear }: {
  annotations: BoardAnnotation[]
  tool: BoardAnnotationType | null
  color: BoardAnnotationColor
  onToolChange: (tool: BoardAnnotationType | null) => void
  onColorChange: (color: BoardAnnotationColor) => void
  onRemove: (id: string) => void
  onUndo: () => void
  onClear: () => void
}) {
  return <section className="annotation-panel">
    <div className="annotation-header">
      <div><h3>局面标注</h3><span>标注仅属于当前变招节点</span></div>
      <b>{annotations.length}</b>
    </div>

    <div className="annotation-tool-group" aria-label="标注类型">
      {(['arrow', 'circle'] as const).map(type => <button
        key={type}
        className={tool === type ? 'active' : ''}
        aria-pressed={tool === type}
        onClick={() => onToolChange(tool === type ? null : type)}
      >{ANNOTATION_TYPE_LABELS[type]}</button>)}
    </div>
    <div className="annotation-colors" aria-label="标注颜色">
      {(['red', 'green', 'blue'] as const).map(item => <button
        key={item}
        className={`${item} ${color === item ? 'active' : ''}`}
        aria-label={ANNOTATION_COLOR_LABELS[item]}
        aria-pressed={color === item}
        onClick={() => onColorChange(item)}
      ><span aria-hidden="true" /></button>)}
    </div>

    <p className="annotation-help">选择工具后，在棋盘上拖动绘制箭头，或点按棋子位置添加圈点。再次点击当前工具可退出。</p>
    <div className="annotation-actions">
      <button onClick={onUndo} disabled={annotations.length === 0}>撤销最近</button>
      <button onClick={onClear} disabled={annotations.length === 0}>清空当前节点</button>
    </div>

    {annotations.length > 0 ? <ol className="annotation-list">
      {annotations.map(annotation => <li key={annotation.id}>
        <span className={`annotation-swatch ${annotation.color}`} aria-hidden="true" />
        <span>{formatAnnotation(annotation)}</span>
        <button aria-label={`删除${formatAnnotation(annotation)}`} onClick={() => onRemove(annotation.id)}>删除</button>
      </li>)}
    </ol> : <p className="annotation-empty">当前节点还没有标注。</p>}
  </section>
}
