interface Props {
  evaluation: number | null
  bestLine: string[]
  depth: number
}

export default function AnalysisBar({ evaluation, bestLine, depth }: Props) {
  if (evaluation === null) {
    return (
      <div className="analysis-bar" style={{ height: 576 }}>
        <div className="analysis-fill" style={{ height: '50%' }} />
        <div className="analysis-score">...</div>
      </div>
    )
  }

  const clampedEval = Math.max(-2000, Math.min(2000, evaluation))
  const percentage = 50 + (clampedEval / 2000) * 50
  const displayEval = Math.abs(evaluation) >= 10000
    ? (evaluation > 0 ? '+M' : '-M')
    : (evaluation > 0 ? '+' : '') + (evaluation / 100).toFixed(1)

  return (
    <div className="analysis-bar" style={{ height: 576 }} title={`深度: ${depth} | 最优: ${bestLine.join(' ')}`}>
      <div
        className={`analysis-fill ${evaluation < 0 ? 'black-advantage' : ''}`}
        style={{ height: evaluation >= 0 ? `${percentage}%` : `${100 - percentage}%` }}
      />
      <div className="analysis-score">{displayEval}</div>
      {depth > 0 && <div className="analysis-details">D{depth}</div>}
    </div>
  )
}
