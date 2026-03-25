import { GameMode, Difficulty, GameStatus, PieceColor, PlayerConfig } from '../types'

interface Props {
  currentTurn: PieceColor
  gameMode: GameMode
  difficulty: Difficulty
  aiRedDifficulty: Difficulty
  aiBlackDifficulty: Difficulty
  redPlayerConfig: PlayerConfig
  blackPlayerConfig: PlayerConfig
  gameStatus: GameStatus
  flipped: boolean
  showAnalysis: boolean
  scenarioName: string | null
  onNewGame: () => void
  onUndo: () => void
  onRedo: () => void
  onFlip: () => void
  onToggleAnalysis: () => void
  onExportFen: () => void
  onImportFen: () => void
  onSaveAsEndgame: () => void
  onHint: () => void
  onNextAiMove: () => void
  aiVsAiAutoStep: boolean
  onToggleAiVsAiAuto: () => void
  canUndo: boolean
  canRedo: boolean
  canRequestHint: boolean
  canStepAi: boolean
  hintThinking: boolean
}

const DIFFICULTY_NAMES: Record<Difficulty, string> = {
  easy: '初级',
  medium: '中级',
  hard: '高级',
  master: '大师',
}

const STATUS_TEXT: Record<GameStatus, string> = {
  playing: '',
  'red-wins': '红方胜！',
  'black-wins': '黑方胜！',
  draw: '和棋',
}

function formatPlayerConfig(config: PlayerConfig): string {
  if (config.type === 'human') return '人类'
  return `AI(${DIFFICULTY_NAMES[config.difficulty || 'medium']})`
}

export default function GamePanel({
  currentTurn, gameMode, difficulty, aiRedDifficulty, aiBlackDifficulty, redPlayerConfig, blackPlayerConfig, gameStatus,
  showAnalysis,
  scenarioName,
  onNewGame, onUndo, onRedo, onFlip, onToggleAnalysis,
  onExportFen, onImportFen, onSaveAsEndgame,
  onHint, onNextAiMove, aiVsAiAutoStep, onToggleAiVsAiAuto,
  canUndo, canRedo, canRequestHint, canStepAi, hintThinking,
}: Props) {
  const isAiVsAi = gameMode === 'ai-vs-ai'
  const isHumanVsAi = gameMode === 'human-vs-ai'

  return (
    <div className="game-panel">
      <div className="status">
        {gameStatus === 'playing' ? (
          <div className={`turn-indicator ${currentTurn}`}>
            {currentTurn === 'red' ? '红方走棋' : '黑方走棋'}
          </div>
        ) : (
          <div className="game-over">{STATUS_TEXT[gameStatus]}</div>
        )}
      </div>

      <div className="info-row">
        <span>模式: {isHumanVsAi ? '人机对弈' : isAiVsAi ? 'AI 对战' : gameMode === 'endgame' ? '残局模式' : '双人对弈'}</span>
        {isHumanVsAi && <span>难度: {DIFFICULTY_NAMES[difficulty]}</span>}
        {isAiVsAi && <span>红: {DIFFICULTY_NAMES[aiRedDifficulty]} / 黑: {DIFFICULTY_NAMES[aiBlackDifficulty]}</span>}
        {gameMode === 'endgame' && (
          <span>
            红: {formatPlayerConfig(redPlayerConfig)} / 黑: {formatPlayerConfig(blackPlayerConfig)}
          </span>
        )}
      </div>
      {scenarioName && <div className="scenario-name">{scenarioName}</div>}

      <div className="panel-section">
        <div className="panel-section-title">常用操作</div>
        <div className="panel-buttons panel-buttons-primary">
          <button className="primary-action" onClick={onUndo} disabled={!canUndo}>悔棋</button>
          <button className="primary-action" onClick={onRedo} disabled={!canRedo}>重做</button>
          {!isAiVsAi && (
            <button className="primary-action accent-action" onClick={onHint} disabled={!canRequestHint}>
              {hintThinking ? '提示中...' : '提示'}
            </button>
          )}
          {isAiVsAi && (
            <>
              <button className="primary-action accent-action" onClick={onNextAiMove} disabled={!canStepAi}>
                下一步
              </button>
              <button
                type="button"
                className={`primary-action ${aiVsAiAutoStep ? 'auto-active' : ''}`}
                onClick={onToggleAiVsAiAuto}
                disabled={gameStatus !== 'playing' || (!aiVsAiAutoStep && !canStepAi)}
              >
                {aiVsAiAutoStep ? '暂停' : '自动'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">其他功能</div>
        <div className="panel-buttons">
          <button onClick={onFlip}>翻转棋盘</button>
          <button
            className={showAnalysis ? 'analysis-active' : ''}
            onClick={onToggleAnalysis}
          >
            {showAnalysis ? '关闭分析' : '引擎分析'}
          </button>
          <button onClick={onExportFen}>导出 FEN</button>
          <button onClick={onImportFen}>导入 FEN</button>
          <button onClick={onSaveAsEndgame}>另存残局</button>
          <button className="new-game" onClick={onNewGame}>新游戏</button>
        </div>
      </div>
    </div>
  )
}
