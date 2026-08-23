import { useEffect, useMemo, useState } from 'react'
import { VariationNode, VariationTree } from '../types'
import { buildBranchComparison } from '../variations/comparison'

interface VariationPanelProps {
  tree: VariationTree
  currentNodeId: string
  children: VariationNode[]
  mainChildId?: string
  branchCount: number
  analysisThinking: boolean
  analysisProgress: { completed: number; total: number; cached: number }
  analysisStatus: string
  canAnalyzeNode: boolean
  canAnalyzeBranch: boolean
  onAnalyzeNode: () => void
  onAnalyzeBranch: () => void
  onStopAnalysis: () => void
  onSelect: (nodeId: string) => void
  onSetMain: (nodeId: string) => void
  onDelete: (node: VariationNode) => void
}

function formatScore(score: number): string {
  return `${score >= 0 ? '+' : ''}${(score / 100).toFixed(2)}`
}

export default function VariationPanel({
  tree,
  currentNodeId,
  children,
  mainChildId,
  branchCount,
  analysisThinking,
  analysisProgress,
  analysisStatus,
  canAnalyzeNode,
  canAnalyzeBranch,
  onAnalyzeNode,
  onAnalyzeBranch,
  onStopAnalysis,
  onSelect,
  onSetMain,
  onDelete,
}: VariationPanelProps) {
  const childIds = children.map((node) => node.id)
  const childKey = childIds.join('|')
  const [leftId, setLeftId] = useState(childIds[0] || '')
  const [rightId, setRightId] = useState(childIds[1] || '')

  useEffect(() => {
    setLeftId((current) => (childIds.includes(current) ? current : childIds[0] || ''))
    setRightId((current) =>
      childIds.includes(current) && current !== leftId
        ? current
        : childIds.find((id) => id !== leftId) || '',
    )
  }, [childKey, leftId])

  const comparison = useMemo(
    () => buildBranchComparison(tree, currentNodeId, leftId, rightId),
    [currentNodeId, leftId, rightId, tree],
  )
  const percent =
    analysisProgress.total > 0
      ? Math.round((analysisProgress.completed / analysisProgress.total) * 100)
      : 0

  return (
    <section className="variation-panel">
      <div className="variation-header">
        <div>
          <h3>变招树</h3>
          <span>已保留 {branchCount} 条支线</span>
        </div>
      </div>

      <div className="variation-analysis-actions">
        {analysisThinking ? (
          <button className="variation-stop-analysis" onClick={onStopAnalysis}>
            停止分析 {percent}%
          </button>
        ) : (
          <>
            <button disabled={!canAnalyzeNode} onClick={onAnalyzeNode}>
              分析当前节点
            </button>
            <button disabled={!canAnalyzeBranch} onClick={onAnalyzeBranch}>
              分析当前分支
            </button>
          </>
        )}
      </div>
      {(analysisThinking || analysisStatus) && (
        <div className="variation-analysis-status" aria-live="polite">
          {analysisThinking && (
            <span className="variation-analysis-meter">
              <i style={{ width: `${percent}%` }} />
            </span>
          )}
          <small>
            {analysisStatus}
            {analysisProgress.total > 0
              ? ` · ${analysisProgress.completed}/${analysisProgress.total}`
              : ''}
            {analysisProgress.cached > 0 ? ` · 缓存 ${analysisProgress.cached}` : ''}
          </small>
        </div>
      )}

      {branchCount > 0 && children.length > 0 ? (
        <div className="variation-options">
          <span className="variation-help">当前局面的后续走法</span>
          {children.map((node) => {
            const isMain = node.id === mainChildId
            return (
              <div className={`variation-option ${isMain ? 'main' : ''}`} key={node.id}>
                <button className="variation-select" onClick={() => onSelect(node.id)}>
                  <strong>{node.move?.notation || '未命名走法'}</strong>
                  <span>{isMain ? '主线' : '支线'}</span>
                </button>
                <div className="variation-option-actions">
                  {!isMain && (
                    <button className="variation-promote" onClick={() => onSetMain(node.id)}>
                      设为主线
                    </button>
                  )}
                  <button className="variation-delete" onClick={() => onDelete(node)}>
                    删除
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="variation-empty">悔棋或跳回分叉局面后，可在这里切换已有变化。</p>
      )}

      {children.length >= 2 && (
        <section className="branch-comparison">
          <div className="branch-comparison-header">
            <strong>双分支比较</strong>
            <span>只读比较，不会改写主线</span>
          </div>
          <div className="branch-comparison-selectors">
            <label>
              分支 A
              <select
                value={leftId}
                onChange={(event) => {
                  const next = event.target.value
                  setLeftId(next)
                  if (next === rightId) setRightId(childIds.find((id) => id !== next) || '')
                }}
              >
                {children.map((node) => (
                  <option value={node.id} key={node.id}>
                    {node.move?.notation || '未命名走法'}
                    {node.id === mainChildId ? '（主线）' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              分支 B
              <select
                value={rightId}
                onChange={(event) => {
                  const next = event.target.value
                  setRightId(next)
                  if (next === leftId) setLeftId(childIds.find((id) => id !== next) || '')
                }}
              >
                {children.map((node) => (
                  <option value={node.id} key={node.id}>
                    {node.move?.notation || '未命名走法'}
                    {node.id === mainChildId ? '（主线）' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {comparison && (
            <>
              <div className="branch-summary-grid">
                {[comparison.left, comparison.right].map((branch) => (
                  <article key={branch.childId}>
                    <strong>{branch.label}</strong>
                    <span>
                      已分析 {branch.analyzedCount}/{branch.totalCount} 个节点
                    </span>
                    {branch.latest ? (
                      <>
                        <b>
                          红方估算胜率 {branch.latest.redWinRate}% ·{' '}
                          {formatScore(branch.latest.score)}
                        </b>
                        <small>推荐：{branch.latest.recommendedLine.join(' ') || '暂无推荐'}</small>
                      </>
                    ) : (
                      <small>分析当前分支后显示胜率和推荐变化。</small>
                    )}
                  </article>
                ))}
              </div>
              {comparison.keyPoints.length > 0 ? (
                <div className="branch-key-points">
                  <span>主要分歧</span>
                  {comparison.keyPoints.map((point) => (
                    <article key={`${point.left.nodeId}-${point.right.nodeId}`}>
                      <strong>分叉后第 {point.offset} 层</strong>
                      <span>
                        {formatScore(point.left.score)} / {formatScore(point.right.score)} · 差值{' '}
                        {formatScore(point.scoreDelta)}
                      </span>
                      <small>
                        A：{point.left.recommendedLine.join(' ') || '暂无推荐'} · B：
                        {point.right.recommendedLine.join(' ') || '暂无推荐'}
                      </small>
                      <div>
                        <button onClick={() => onSelect(point.left.nodeId)}>查看 A</button>
                        <button onClick={() => onSelect(point.right.nodeId)}>查看 B</button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="variation-empty">两个分支尚无同层分析结果。</p>
              )}
            </>
          )}
        </section>
      )}
    </section>
  )
}
