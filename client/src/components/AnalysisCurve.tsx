import { AnalysisPoint } from '../types'

interface Props {
  points: AnalysisPoint[]
}

function formatScore(score: number): string {
  if (Math.abs(score) >= 10000) return score > 0 ? '红方将杀' : '黑方将杀'
  return `${score > 0 ? '红 +' : score < 0 ? '黑 +' : '均势'}${score === 0 ? '' : (Math.abs(score) / 100).toFixed(1)}`
}

export default function AnalysisCurve({ points }: Props) {
  const sorted = [...points].sort((a, b) => a.moveIndex - b.moveIndex)
  const latest = sorted[sorted.length - 1]
  const width = 240
  const height = 86
  const padding = 10
  const maxEval = 1200

  const path = sorted
    .map((point, index) => {
      const x =
        sorted.length === 1
          ? width / 2
          : padding + (index / (sorted.length - 1)) * (width - padding * 2)
      const clamped = Math.max(-maxEval, Math.min(maxEval, point.evaluation))
      const y = height / 2 - (clamped / maxEval) * (height / 2 - padding)
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <div className="analysis-curve">
      <div className="analysis-curve-header">
        <span>分析曲线</span>
        <span>{latest ? formatScore(latest.evaluation) : '等待分析'}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="分析曲线">
        <line
          x1={padding}
          y1={height / 2}
          x2={width - padding}
          y2={height / 2}
          className="analysis-curve-zero"
        />
        <rect
          x={padding}
          y={padding}
          width={width - padding * 2}
          height={height - padding * 2}
          className="analysis-curve-frame"
        />
        {path && <path d={path} className="analysis-curve-line" />}
        {sorted.map((point, index) => {
          const x =
            sorted.length === 1
              ? width / 2
              : padding + (index / (sorted.length - 1)) * (width - padding * 2)
          const clamped = Math.max(-maxEval, Math.min(maxEval, point.evaluation))
          const y = height / 2 - (clamped / maxEval) * (height / 2 - padding)
          return (
            <circle
              key={point.moveIndex}
              cx={x}
              cy={y}
              r="2.8"
              className={point.evaluation >= 0 ? 'red-point' : 'black-point'}
            />
          )
        })}
      </svg>
    </div>
  )
}
