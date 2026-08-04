import { VariationNode } from '../types'

interface VariationPanelProps {
  children: VariationNode[]
  mainChildId?: string
  branchCount: number
  onSelect: (nodeId: string) => void
  onSetMain: (nodeId: string) => void
}

export default function VariationPanel({ children, mainChildId, branchCount, onSelect, onSetMain }: VariationPanelProps) {
  if (branchCount === 0 && children.length <= 1) return null

  return (
    <section className="variation-panel">
      <div className="variation-header">
        <div>
          <h3>变招树</h3>
          <span>已保留 {branchCount} 条支线</span>
        </div>
      </div>

      {children.length > 0 ? (
        <div className="variation-options">
          <span className="variation-help">当前局面的后续走法</span>
          {children.map(node => {
            const isMain = node.id === mainChildId
            return (
              <div className={`variation-option ${isMain ? 'main' : ''}`} key={node.id}>
                <button className="variation-select" onClick={() => onSelect(node.id)}>
                  <strong>{node.move?.notation || '未命名走法'}</strong>
                  <span>{isMain ? '主线' : '支线'}</span>
                </button>
                {!isMain && (
                  <button className="variation-promote" onClick={() => onSetMain(node.id)}>设为主线</button>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <p className="variation-empty">悔棋或跳回分叉局面后，可在这里切换已有变化。</p>
      )}
    </section>
  )
}
