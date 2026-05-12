import { MoveCandidate } from '../types'

interface Props {
  candidates: MoveCandidate[]
  thinking: boolean
  onRequest: () => void
  canRequest: boolean
}

function formatScore(score: number): string {
  if (Math.abs(score) >= 10000) return score > 0 ? '红方将杀' : '黑方将杀'
  if (score === 0) return '均势'
  return `${score > 0 ? '红' : '黑'} +${(Math.abs(score) / 100).toFixed(1)}`
}

export default function CandidateList({ candidates, thinking, onRequest, canRequest }: Props) {
  return (
    <div className="candidate-list">
      <div className="candidate-header">
        <h3>候选走法</h3>
        <button onClick={onRequest} disabled={!canRequest}>{thinking ? '计算中...' : '刷新'}</button>
      </div>
      {candidates.length === 0 ? (
        <div className="candidate-empty">{thinking ? '正在计算候选走法' : '暂无候选走法'}</div>
      ) : (
        candidates.map((candidate, index) => (
          <div className="candidate-row" key={`${candidate.move}-${index}`}>
            <span className="candidate-rank">{index + 1}</span>
            <strong>{candidate.notation || candidate.move}</strong>
            <span>{formatScore(candidate.score)}</span>
            <small>D{candidate.depth}</small>
          </div>
        ))
      )}
    </div>
  )
}
