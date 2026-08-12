import { BLACK, GOMOKU_DIFFICULTY_LABELS } from '../core/types'
import { useGameStore } from '../store/gameStore'

interface GameStatusProps {
  isStarted: boolean
  canUndo: boolean
  onUndo: () => void
  onRestart: () => void
}

export function GameStatus({ isStarted, canUndo, onUndo, onRestart }: GameStatusProps) {
  const winner = useGameStore((s) => s.winner)
  const draw = useGameStore((s) => s.draw)
  const currentPlayer = useGameStore((s) => s.currentPlayer)
  const aiThinking = useGameStore((s) => s.aiThinking)
  const message = useGameStore((s) => s.message)
  const mode = useGameStore((s) => s.mode)
  const aiEngine = useGameStore((s) => s.aiEngine)
  const difficulty = useGameStore((s) => s.difficulty)
  const humanPlayer = useGameStore((s) => s.humanPlayer)
  const blackAiDifficulty = useGameStore((s) => s.blackAiDifficulty)
  const whiteAiDifficulty = useGameStore((s) => s.whiteAiDifficulty)
  const aiAutoPlaying = useGameStore((s) => s.aiAutoPlaying)
  const aiAutoDelay = useGameStore((s) => s.aiAutoDelay)
  const nextAiMove = useGameStore((s) => s.nextAiMove)
  const toggleAiAutoPlay = useGameStore((s) => s.toggleAiAutoPlay)
  const setAiAutoDelay = useGameStore((s) => s.setAiAutoDelay)

  const turnText = currentPlayer === BLACK ? '黑方' : '白方'
  const winnerText = winner === BLACK ? '黑方' : '白方'
  const engineText = mode === 'pvp'
    ? '本地规则已就绪'
    : aiEngine === 'checking'
      ? '正在检测 Rapfi…'
      : aiEngine === 'rapfi'
        ? 'Rapfi 引擎已就绪'
        : 'Rapfi 不可用 · 使用内置 AI'

  return (
    <section className="gomoku-panel gomoku-status-panel">
      <h3>对局状态</h3>
      <p className="gomoku-status-main">{winner ? `${winnerText}获胜` : draw ? '平局' : `${turnText}行棋`}</p>
      <p className="gomoku-status-sub">{aiThinking ? 'AI 正在计算...' : message}</p>
      <p className={`gomoku-engine-source ${mode === 'pvp' ? 'local' : aiEngine}`}>{engineText}</p>
      <p className="gomoku-ai-match-meta">
        {mode === 'pvp' && <>本地双人 <span>·</span> 黑先白后</>}
        {mode === 'ai' && <>
          你执{humanPlayer === BLACK ? '黑' : '白'}
          <span>·</span>
          AI {GOMOKU_DIFFICULTY_LABELS[difficulty]}
        </>}
        {mode === 'ai-vs-ai' && <>
          黑 {GOMOKU_DIFFICULTY_LABELS[blackAiDifficulty]}
          <span>·</span>
          白 {GOMOKU_DIFFICULTY_LABELS[whiteAiDifficulty]}
        </>}
      </p>
      {isStarted && <div className="gomoku-status-actions">
        <button className="gomoku-btn-secondary" disabled={aiThinking || !canUndo} onClick={onUndo}>悔棋</button>
        <button className="gomoku-btn-primary" onClick={onRestart}>重开一局</button>
      </div>}
      {isStarted && mode === 'ai-vs-ai' && <div className="gomoku-ai-match-actions">
        <button className="gomoku-btn-secondary" disabled={aiThinking || winner !== null || draw} onClick={nextAiMove}>
          {aiThinking ? '思考中…' : '下一步'}
        </button>
        <button className="gomoku-btn-primary" disabled={winner !== null || draw} onClick={toggleAiAutoPlay}>
          {aiAutoPlaying ? '暂停自动' : '开始自动'}
        </button>
        <select aria-label="AI 对战速度" value={aiAutoDelay} onChange={event => setAiAutoDelay(Number(event.target.value))}>
          <option value={400}>快速</option>
          <option value={900}>标准</option>
          <option value={1600}>慢速</option>
        </select>
      </div>}
    </section>
  )
}
