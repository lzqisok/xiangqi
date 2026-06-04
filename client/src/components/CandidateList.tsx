import { Difficulty, EngineSearchMode, MoveCandidate } from '../types'

interface Props {
  candidates: MoveCandidate[]
  thinking: boolean
  onRequest: () => void
  canRequest: boolean
  autoRefresh: boolean
  onAutoRefreshChange: (enabled: boolean) => void
  candidateCount: number
  onCandidateCountChange: (count: number) => void
  autoRefreshDelay: number
  onAutoRefreshDelayChange: (delay: number) => void
  hintDifficulty: Difficulty
  onHintDifficultyChange: (difficulty: Difficulty) => void
  searchMode: EngineSearchMode
  onSearchModeChange: (mode: EngineSearchMode) => void
  searchDepth: number
  onSearchDepthChange: (depth: number) => void
  searchTimeMs: number
  onSearchTimeMsChange: (timeMs: number) => void
}

function formatScore(score: number): string {
  if (Math.abs(score) >= 10000) return score > 0 ? '红方将杀' : '黑方将杀'
  if (score === 0) return '均势'
  return `${score > 0 ? '红' : '黑'} +${(Math.abs(score) / 100).toFixed(1)}`
}

const difficultyLabels: Record<Difficulty, string> = {
  easy: '入门',
  medium: '普通',
  hard: '困难',
  master: '大师',
}

export default function CandidateList({
  candidates,
  thinking,
  onRequest,
  canRequest,
  autoRefresh,
  onAutoRefreshChange,
  candidateCount,
  onCandidateCountChange,
  autoRefreshDelay,
  onAutoRefreshDelayChange,
  hintDifficulty,
  onHintDifficultyChange,
  searchMode,
  onSearchModeChange,
  searchDepth,
  onSearchDepthChange,
  searchTimeMs,
  onSearchTimeMsChange,
}: Props) {
  return (
    <div className="candidate-list">
      <div className="candidate-header">
        <h3>候选走法</h3>
        <button onClick={onRequest} disabled={!canRequest}>{thinking ? '计算中...' : '刷新'}</button>
      </div>
      <label className="candidate-auto-refresh">
        <input
          type="checkbox"
          checked={autoRefresh}
          onChange={e => onAutoRefreshChange(e.target.checked)}
        />
        自动刷新
      </label>
      <div className="engine-settings-panel">
        <label>
          候选数量
          <select value={candidateCount} onChange={e => onCandidateCountChange(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map(count => (
              <option value={count} key={count}>{count} 路</option>
            ))}
          </select>
        </label>
        <label>
          刷新间隔
          <select value={autoRefreshDelay} onChange={e => onAutoRefreshDelayChange(Number(e.target.value))}>
            <option value={500}>0.5 秒</option>
            <option value={900}>0.9 秒</option>
            <option value={1500}>1.5 秒</option>
            <option value={2500}>2.5 秒</option>
            <option value={5000}>5 秒</option>
          </select>
        </label>
        <label>
          提示强度
          <select value={hintDifficulty} onChange={e => onHintDifficultyChange(e.target.value as Difficulty)}>
            {Object.entries(difficultyLabels).map(([value, label]) => (
              <option value={value} key={value}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          搜索上限
          <select value={searchMode} onChange={e => onSearchModeChange(e.target.value as EngineSearchMode)}>
            <option value="depth">按深度</option>
            <option value="time">按时间</option>
          </select>
        </label>
        {searchMode === 'depth' ? (
          <label>
            最大深度
            <select value={searchDepth} onChange={e => onSearchDepthChange(Number(e.target.value))}>
              {[8, 12, 16, 20, 24, 28, 30].map(depth => (
                <option value={depth} key={depth}>D{depth}</option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            最大时间
            <select value={searchTimeMs} onChange={e => onSearchTimeMsChange(Number(e.target.value))}>
              <option value={500}>0.5 秒</option>
              <option value={1000}>1 秒</option>
              <option value={2500}>2.5 秒</option>
              <option value={5000}>5 秒</option>
              <option value={10000}>10 秒</option>
            </select>
          </label>
        )}
      </div>
      {candidates.length === 0 ? (
        <div className="candidate-empty">{thinking ? '正在计算候选走法' : '暂无候选走法'}</div>
      ) : (
        candidates.map((candidate, index) => (
          <div className="candidate-item" key={`${candidate.move}-${index}`}>
            <div className="candidate-row">
              <span className="candidate-rank">{index + 1}</span>
              <strong>{candidate.notation || candidate.move}</strong>
              <span>{formatScore(candidate.score)}</span>
              <small>D{candidate.depth}</small>
            </div>
            {candidate.pvNotation && candidate.pvNotation.length > 1 && (
              <div className="candidate-pv">
                {candidate.pvNotation.slice(1).join('  ')}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}
