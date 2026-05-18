import { ConnectionState, GameMode, Difficulty, GameStatus, GameStatusReason, PieceColor, PlayerConfig } from '../types'

interface Props {
  currentTurn: PieceColor
  gameMode: GameMode
  difficulty: Difficulty
  aiRedDifficulty: Difficulty
  aiBlackDifficulty: Difficulty
  redPlayerConfig: PlayerConfig
  blackPlayerConfig: PlayerConfig
  gameStatus: GameStatus
  gameStatusReason?: GameStatusReason
  flipped: boolean
  showAnalysis: boolean
  scenarioName: string | null
  trainingFeedback: string
  trainingHint: string
  naturalLimitReminder: string
  canRequestTrainingHint: boolean
  aiThinking: boolean
  connectionState: ConnectionState
  engineAvailable: boolean | null
  engineStatusMessage: string
  aiAutoPlaying: boolean
  aiAutoDelay: number
  onNewGame: () => void
  onUndo: () => void
  onRedo: () => void
  onFlip: () => void
  onToggleAnalysis: () => void
  onExportFen: () => void
  onImportFen: () => void
  onCopyMoveText: () => void
  onSaveRecentFen: () => void
  onSaveAsEndgame: () => void
  onSaveStudy: () => void
  onExportImage: () => void
  onTrainingHint: () => void
  onHint: () => void
  onNextAiMove: () => void
  onToggleAiAutoPlay: () => void
  onAiAutoDelayChange: (delay: number) => void
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

function formatStatus(status: GameStatus, reason?: GameStatusReason): string {
  if (status === 'playing') return ''
  if (status === 'draw') return '和棋'

  const winner = status === 'red-wins' ? '红方胜' : '黑方胜'
  const reasonText: Record<GameStatusReason, string> = {
    checkmate: '将死',
    stalemate: '困毙',
    'illegal-position': '非法局面',
    manual: '手动结束',
  }
  return reason ? `${winner}（${reasonText[reason]}）` : `${winner}！`
}

function formatPlayerConfig(config: PlayerConfig): string {
  if (config.type === 'human') return '人类'
  return `AI(${DIFFICULTY_NAMES[config.difficulty || 'medium']})`
}

function formatEngineStatus(connectionState: ConnectionState, engineAvailable: boolean | null, message: string): string {
  if (connectionState === 'connecting') return '后端连接中'
  if (connectionState === 'disconnected') return '后端未连接'
  if (engineAvailable === false) return message || '引擎不可用'
  if (engineAvailable === null) return '引擎检测中'
  return '引擎可用'
}

export default function GamePanel({
  currentTurn, gameMode, difficulty, aiRedDifficulty, aiBlackDifficulty, redPlayerConfig, blackPlayerConfig, gameStatus, gameStatusReason,
  showAnalysis,
  scenarioName,
  trainingFeedback,
  trainingHint,
  naturalLimitReminder,
  canRequestTrainingHint,
  aiThinking,
  connectionState,
  engineAvailable,
  engineStatusMessage,
  aiAutoPlaying,
  aiAutoDelay,
  onNewGame, onUndo, onRedo, onFlip, onToggleAnalysis,
  onExportFen, onImportFen, onCopyMoveText, onSaveRecentFen, onSaveAsEndgame, onSaveStudy, onExportImage, onTrainingHint,
  onHint, onNextAiMove, onToggleAiAutoPlay, onAiAutoDelayChange,
  canUndo, canRedo, canRequestHint, canStepAi, hintThinking,
}: Props) {
  const isAiVsAi = gameMode === 'ai-vs-ai'
  const isHumanVsAi = gameMode === 'human-vs-ai'
  const modeText = isHumanVsAi ? '人机对弈' : isAiVsAi ? 'AI 对战' : gameMode === 'endgame' ? '残局模式' : gameMode === 'study' ? '研究局面' : '双人对弈'

  return (
    <div className="game-panel">
      <div className="status">
        {gameStatus === 'playing' ? (
          <div className={`turn-indicator ${currentTurn}`}>
            {aiThinking ? `${currentTurn === 'red' ? '红方' : '黑方'} AI 思考中...` : currentTurn === 'red' ? '红方走棋' : '黑方走棋'}
          </div>
        ) : (
          <div className="game-over">{formatStatus(gameStatus, gameStatusReason)}</div>
        )}
      </div>

      <div className="info-row">
        <span className="info-chip">{modeText}</span>
        {isHumanVsAi && <span className="info-chip">{DIFFICULTY_NAMES[difficulty]}</span>}
        {isAiVsAi && <span className="info-chip">红 {DIFFICULTY_NAMES[aiRedDifficulty]} / 黑 {DIFFICULTY_NAMES[aiBlackDifficulty]}</span>}
        {gameMode === 'endgame' && (
          <span className="info-chip">
            红: {formatPlayerConfig(redPlayerConfig)} / 黑: {formatPlayerConfig(blackPlayerConfig)}
          </span>
        )}
      </div>
      {scenarioName && <div className="scenario-name">{scenarioName}</div>}
      {trainingFeedback && <div className="training-feedback">{trainingFeedback}</div>}
      {trainingHint && <div className="training-hint">{trainingHint}</div>}
      {naturalLimitReminder && <div className="natural-limit-reminder">{naturalLimitReminder}</div>}

      <div className={`engine-status ${connectionState} ${engineAvailable === false ? 'engine-offline' : ''}`}>
        <span className="engine-status-dot" />
        <span>{formatEngineStatus(connectionState, engineAvailable, engineStatusMessage)}</span>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">常用操作</div>
        <div className="panel-buttons panel-buttons-primary">
          <button className="primary-action" onClick={onUndo} disabled={!canUndo} title="回到上一手">悔棋</button>
          <button className="primary-action" onClick={onRedo} disabled={!canRedo} title="前进到下一手">重做</button>
          {!isAiVsAi && (
            <button className="primary-action accent-action" onClick={onHint} disabled={!canRequestHint} title="请求引擎给出当前方建议">
              {hintThinking ? '提示中...' : '提示'}
            </button>
          )}
          {gameMode === 'endgame' && (
            <button className="primary-action" onClick={onTrainingHint} disabled={!canRequestTrainingHint} title="按标准解法逐层提示">
              训练提示
            </button>
          )}
          {isAiVsAi && (
            <button className="primary-action accent-action" onClick={onNextAiMove} disabled={!canStepAi} title="让当前 AI 走一步">
              {aiThinking ? '思考中...' : '下一步'}
            </button>
          )}
        </div>
      </div>

      {isAiVsAi && (
        <div className="panel-section">
          <div className="panel-section-title">自动播放</div>
          <div className="panel-buttons panel-buttons-primary">
            <button className="primary-action accent-action" onClick={onToggleAiAutoPlay} disabled={!canStepAi && !aiAutoPlaying}>
              {aiAutoPlaying ? '暂停自动' : '开始自动'}
            </button>
          </div>
          <select
            className="speed-select"
            value={aiAutoDelay}
            onChange={e => onAiAutoDelayChange(Number(e.target.value))}
          >
            <option value={400}>快速</option>
            <option value={900}>标准</option>
            <option value={1600}>慢速</option>
          </select>
        </div>
      )}

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
          <button onClick={onSaveRecentFen}>保存局面</button>
          <button onClick={onSaveStudy}>保存研究</button>
          <button onClick={onExportImage}>导出图片</button>
          <button onClick={onCopyMoveText}>复制棋谱</button>
          <button onClick={onSaveAsEndgame}>另存残局</button>
          <button className="new-game" onClick={onNewGame}>新游戏</button>
        </div>
      </div>
    </div>
  )
}
