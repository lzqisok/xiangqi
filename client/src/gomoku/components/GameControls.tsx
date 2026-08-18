import {
  BLACK,
  GOMOKU_DIFFICULTIES,
  GOMOKU_DIFFICULTY_LABELS,
  WHITE,
  type Difficulty,
} from '../core/types'
import { useGameStore } from '../store/gameStore'

interface DifficultyButtonsProps {
  value: Difficulty
  disabled: boolean
  onChange: (difficulty: Difficulty) => void
}

function DifficultyButtons({ value, disabled, onChange }: DifficultyButtonsProps) {
  return (
    <div className="gomoku-radio-group gomoku-difficulty-group">
      {GOMOKU_DIFFICULTIES.map((difficulty) => (
        <button
          key={difficulty}
          className={`gomoku-radio-btn ${value === difficulty ? 'active' : ''}`}
          disabled={disabled}
          onClick={() => onChange(difficulty)}
        >
          {GOMOKU_DIFFICULTY_LABELS[difficulty]}
        </button>
      ))}
    </div>
  )
}

export function GameControls() {
  const mode = useGameStore((s) => s.mode)
  const forbiddenEnabled = useGameStore((s) => s.forbiddenEnabled)
  const difficulty = useGameStore((s) => s.difficulty)
  const blackAiDifficulty = useGameStore((s) => s.blackAiDifficulty)
  const whiteAiDifficulty = useGameStore((s) => s.whiteAiDifficulty)
  const humanPlayer = useGameStore((s) => s.humanPlayer)
  const aiThinking = useGameStore((s) => s.aiThinking)
  const setMode = useGameStore((s) => s.setMode)
  const setForbiddenEnabled = useGameStore((s) => s.setForbiddenEnabled)
  const setDifficulty = useGameStore((s) => s.setDifficulty)
  const setAiMatchDifficulty = useGameStore((s) => s.setAiMatchDifficulty)
  const setAiSide = useGameStore((s) => s.setAiSide)

  const locked = useGameStore((s) => s.isStarted)

  return (
    <section className={`gomoku-panel gomoku-settings-panel gomoku-settings-panel--${mode}`}>
      <h3>对局设置</h3>

      <div className="gomoku-control-group gomoku-control-group--mode">
        <label className="gomoku-control-label">模式</label>
        <div className="gomoku-radio-group">
          <button
            className={`gomoku-radio-btn ${mode === 'pvp' ? 'active' : ''}`}
            disabled={locked}
            onClick={() => setMode('pvp')}
          >
            本地双人
          </button>
          <button
            className={`gomoku-radio-btn ${mode === 'ai' ? 'active' : ''}`}
            disabled={locked}
            onClick={() => setMode('ai')}
          >
            人机对战
          </button>
          <button
            className={`gomoku-radio-btn ${mode === 'ai-vs-ai' ? 'active' : ''}`}
            disabled={locked}
            onClick={() => setMode('ai-vs-ai')}
          >
            AI 对战
          </button>
        </div>
      </div>

      <div className="gomoku-mode-config">
        {mode === 'pvp' && (
          <>
            <div className="gomoku-control-group">
              <label className="gomoku-control-label">双方执子</label>
              <div className="gomoku-radio-group gomoku-static-options">
                <span>黑方玩家</span>
                <span>白方玩家</span>
              </div>
            </div>
            <div className="gomoku-control-group">
              <label className="gomoku-control-label">落子方式</label>
              <div className="gomoku-radio-group gomoku-static-options">
                <span>双方轮流落子</span>
              </div>
            </div>
          </>
        )}

        {mode === 'ai' && (
          <>
            <div className="gomoku-control-group gomoku-control-group--side">
              <label className="gomoku-control-label">执子</label>
              <div className="gomoku-radio-group">
                <button
                  className={`gomoku-radio-btn ${humanPlayer === BLACK ? 'active' : ''}`}
                  disabled={locked}
                  onClick={() => setAiSide(BLACK)}
                >
                  我执黑
                </button>
                <button
                  className={`gomoku-radio-btn ${humanPlayer === WHITE ? 'active' : ''}`}
                  disabled={locked}
                  onClick={() => setAiSide(WHITE)}
                >
                  我执白
                </button>
              </div>
            </div>

            <div className="gomoku-control-group gomoku-control-group--difficulty">
              <label className="gomoku-control-label">难度</label>
              <DifficultyButtons
                value={difficulty}
                disabled={aiThinking}
                onChange={setDifficulty}
              />
            </div>
          </>
        )}

        {mode === 'ai-vs-ai' && (
          <>
            <div className="gomoku-control-group gomoku-control-group--black-ai">
              <label className="gomoku-control-label">黑方强度</label>
              <DifficultyButtons
                value={blackAiDifficulty}
                disabled={locked || aiThinking}
                onChange={(difficulty) => setAiMatchDifficulty(BLACK, difficulty)}
              />
            </div>
            <div className="gomoku-control-group gomoku-control-group--white-ai">
              <label className="gomoku-control-label">白方强度</label>
              <DifficultyButtons
                value={whiteAiDifficulty}
                disabled={locked || aiThinking}
                onChange={(difficulty) => setAiMatchDifficulty(WHITE, difficulty)}
              />
            </div>
          </>
        )}
      </div>

      <label className="gomoku-switch-control">
        <span>启用禁手（仅黑方）</span>
        <button
          type="button"
          role="switch"
          aria-checked={forbiddenEnabled}
          aria-label="启用黑方禁手"
          disabled={locked}
          className={`gomoku-switch ${forbiddenEnabled ? 'gomoku-switch--on' : ''} ${locked ? 'gomoku-switch--disabled' : ''}`}
          onClick={() => setForbiddenEnabled(!forbiddenEnabled)}
        >
          <span className="gomoku-switch-knob" />
        </button>
      </label>

      {locked && <p className="gomoku-tip">已开局，模式/禁手设置将在下一局生效。</p>}
    </section>
  )
}
