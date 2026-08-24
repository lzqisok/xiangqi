import {
  ConnectionState,
  GameMode,
  Difficulty,
  GameStatus,
  GameStatusReason,
  PieceColor,
  PlayerConfig,
} from '../types'

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
  studySaveStatus: 'saved' | 'unsaved' | 'shared' | null
  trainingFeedback: string
  trainingHint: string
  trainingHintHistory: string
  naturalLimitReminder: string
  repetitionReminder: string
  canRequestTrainingHint: boolean
  aiThinking: boolean
  connectionState: ConnectionState
  engineAvailable: boolean | null
  engineStatusMessage: string
  aiAutoPlaying: boolean
  aiAutoDelay: number
  studyAutoPlaying: boolean
  studyReplayDelay: number
  canStudyReplay: boolean
  canJumpToPrevMarked: boolean
  canJumpToNextMarked: boolean
  onOpenReview: () => void
  onUndo: () => void
  onRedo: () => void
  onFlip: () => void
  onToggleAnalysis: () => void
  onExportFen: () => void
  onImportFen: () => void
  onCopyMoveText: () => void
  onCopyReplayLink: () => void
  onSaveRecentFen: () => void
  onSaveAsEndgame: () => void
  onSaveStudy: () => void
  onExportImage: () => void
  onTrainingHint: () => void
  onHint: () => void
  onNextAiMove: () => void
  onDeclareDraw: () => void
  onResign: () => void
  onToggleAiAutoPlay: () => void
  onAiAutoDelayChange: (delay: number) => void
  onToggleStudyAutoPlay: () => void
  onStudyReplayDelayChange: (delay: number) => void
  onJumpToPrevMarked: () => void
  onJumpToNextMarked: () => void
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

const DIFFICULTY_DEPTH: Record<Difficulty, number> = {
  easy: 8,
  medium: 14,
  hard: 20,
  master: 26,
}

function formatDifficulty(difficulty: Difficulty): string {
  return `${DIFFICULTY_NAMES[difficulty]} · D${DIFFICULTY_DEPTH[difficulty]}`
}

function formatStatus(status: GameStatus, reason?: GameStatusReason): string {
  if (status === 'playing') return ''
  if (status === 'draw') {
    const drawReason: Partial<Record<GameStatusReason, string>> = {
      repetition: '三次重复局面',
      'natural-limit': '连续 60 回合未吃子',
      'move-limit': '达到 300 回合上限',
      manual: '双方议和',
    }
    return reason && drawReason[reason] ? `和棋（${drawReason[reason]}）` : '和棋'
  }

  const winner = status === 'red-wins' ? '红方胜' : '黑方胜'
  const reasonText: Record<GameStatusReason, string> = {
    checkmate: '将死',
    stalemate: '困毙',
    'illegal-position': '非法局面',
    manual: '手动结束',
    resignation: '认输',
    repetition: '重复局面',
    'natural-limit': '自然限着',
    'move-limit': '回合上限',
  }
  return reason ? `${winner}（${reasonText[reason]}）` : `${winner}！`
}

function formatPlayerConfig(config: PlayerConfig): string {
  if (config.type === 'human') return '人类'
  return `AI ${formatDifficulty(config.difficulty || 'medium')}`
}

function formatEngineStatus(
  connectionState: ConnectionState,
  engineAvailable: boolean | null,
  message: string,
): string {
  if (connectionState === 'connecting') return '后端连接中'
  if (connectionState === 'disconnected') return '后端未连接'
  if (engineAvailable === false) return message || '引擎不可用'
  if (engineAvailable === null) return '引擎检测中'
  if (message && message !== 'Engine ready') return message
  return '引擎可用'
}

export default function GamePanel({
  currentTurn,
  gameMode,
  difficulty,
  aiRedDifficulty,
  aiBlackDifficulty,
  redPlayerConfig,
  blackPlayerConfig,
  gameStatus,
  gameStatusReason,
  showAnalysis,
  scenarioName,
  studySaveStatus,
  trainingFeedback,
  trainingHint,
  trainingHintHistory,
  naturalLimitReminder,
  repetitionReminder,
  canRequestTrainingHint,
  aiThinking,
  connectionState,
  engineAvailable,
  engineStatusMessage,
  aiAutoPlaying,
  aiAutoDelay,
  studyAutoPlaying,
  studyReplayDelay,
  canStudyReplay,
  canJumpToPrevMarked,
  canJumpToNextMarked,
  onOpenReview,
  onUndo,
  onRedo,
  onFlip,
  onToggleAnalysis,
  onExportFen,
  onImportFen,
  onCopyMoveText,
  onCopyReplayLink,
  onSaveRecentFen,
  onSaveAsEndgame,
  onSaveStudy,
  onExportImage,
  onTrainingHint,
  onHint,
  onNextAiMove,
  onDeclareDraw,
  onResign,
  onToggleAiAutoPlay,
  onAiAutoDelayChange,
  onToggleStudyAutoPlay,
  onStudyReplayDelayChange,
  onJumpToPrevMarked,
  onJumpToNextMarked,
  canUndo,
  canRedo,
  canRequestHint,
  canStepAi,
  hintThinking,
}: Props) {
  const isAiVsAi = gameMode === 'ai-vs-ai'
  const isJieqi = gameMode === 'jieqi'
  const isHumanVsAi = gameMode === 'human-vs-ai' || isJieqi
  const canManualEnd = gameStatus === 'playing' && !aiThinking && !hintThinking
  const canDeclareDraw = canManualEnd && gameMode === 'human-vs-human'
  const modeText = isJieqi
    ? '揭棋对弈'
    : isHumanVsAi
      ? '人机对弈'
      : isAiVsAi
        ? 'AI 对战'
        : gameMode === 'endgame'
          ? '残局模式'
          : gameMode === 'study'
            ? '研究局面'
            : '双人对弈'
  const activeDifficulty =
    currentTurn === 'red' ? redPlayerConfig.difficulty : blackPlayerConfig.difficulty

  return (
    <div className="game-panel">
      <div className="status">
        {gameStatus === 'playing' ? (
          <div className={`turn-indicator ${currentTurn}`}>
            {aiThinking
              ? `${currentTurn === 'red' ? '红方' : '黑方'} AI · ${formatDifficulty(activeDifficulty || difficulty)}`
              : currentTurn === 'red'
                ? '红方走棋'
                : '黑方走棋'}
          </div>
        ) : (
          <div className="game-over">{formatStatus(gameStatus, gameStatusReason)}</div>
        )}
      </div>
      {isJieqi && (
        <div className="jieqi-rule-note">
          暗子按棋盘原位走法移动，落子后翻开；暗吃身份仅捕获方知晓。
        </div>
      )}

      <div className="info-row">
        <span className="info-chip">{modeText}</span>
        {isHumanVsAi && <span className="info-chip">{formatDifficulty(difficulty)}</span>}
        {isAiVsAi && (
          <span className="info-chip">
            红 {formatDifficulty(aiRedDifficulty)} / 黑 {formatDifficulty(aiBlackDifficulty)}
          </span>
        )}
        {gameMode === 'endgame' && (
          <span className="info-chip">
            红: {formatPlayerConfig(redPlayerConfig)} / 黑: {formatPlayerConfig(blackPlayerConfig)}
          </span>
        )}
      </div>
      {scenarioName && (
        <div className="scenario-name">
          <span>{scenarioName}</span>
          {studySaveStatus && (
            <span className={`study-save-status ${studySaveStatus}`}>
              {studySaveStatus === 'saved'
                ? '已自动保存'
                : studySaveStatus === 'unsaved'
                  ? '等待自动保存'
                  : '分享回放 · 尚未保存'}
            </span>
          )}
        </div>
      )}
      {trainingFeedback && <div className="training-feedback">{trainingFeedback}</div>}
      {trainingHint && <div className="training-hint">{trainingHint}</div>}
      {trainingHintHistory && <div className="training-hint-history">{trainingHintHistory}</div>}
      {naturalLimitReminder && <div className="natural-limit-reminder">{naturalLimitReminder}</div>}
      {repetitionReminder && <div className="natural-limit-reminder">{repetitionReminder}</div>}

      {gameStatus !== 'playing' && !isJieqi && (
        <div className="panel-section phase-primary-action">
          <button className="review-entry-action" onClick={onOpenReview}>
            <span>开始复盘</span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      )}

      <div
        className={`engine-status ${connectionState} ${engineAvailable === false ? 'engine-offline' : ''}`}
      >
        <span className="engine-status-dot" />
        <span>{formatEngineStatus(connectionState, engineAvailable, engineStatusMessage)}</span>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">常用操作</div>
        <div className="panel-buttons">
          <button onClick={onUndo} disabled={!canUndo} title="回到上一手">
            悔棋
          </button>
          <button onClick={onRedo} disabled={!canRedo} title="前进到下一手">
            重做
          </button>
          {!isAiVsAi && (
            <button onClick={onHint} disabled={!canRequestHint} title="请求引擎给出当前方建议">
              {hintThinking ? '提示中...' : '提示'}
            </button>
          )}
          {gameMode === 'endgame' && (
            <button
              onClick={onTrainingHint}
              disabled={!canRequestTrainingHint}
              title="按标准解法逐层提示"
            >
              训练提示
            </button>
          )}
          {isAiVsAi && (
            <button onClick={onNextAiMove} disabled={!canStepAi} title="让当前 AI 走一步">
              {aiThinking ? '思考中...' : '下一步'}
            </button>
          )}
        </div>
      </div>

      {isAiVsAi && (
        <div className="panel-section">
          <div className="panel-section-title">自动播放</div>
          <div className="panel-buttons panel-buttons-primary">
            <button
              className="primary-action accent-action"
              onClick={onToggleAiAutoPlay}
              disabled={!canStepAi && !aiAutoPlaying}
            >
              {aiAutoPlaying ? '暂停自动' : '开始自动'}
            </button>
          </div>
          <select
            className="speed-select"
            value={aiAutoDelay}
            onChange={(e) => onAiAutoDelayChange(Number(e.target.value))}
          >
            <option value={400}>快速</option>
            <option value={900}>标准</option>
            <option value={1600}>慢速</option>
          </select>
        </div>
      )}

      {gameMode === 'study' && (
        <div className="panel-section">
          <div className="panel-section-title">研究回放</div>
          <div className="panel-buttons panel-buttons-primary">
            <button
              className="primary-action accent-action"
              onClick={onToggleStudyAutoPlay}
              disabled={!canStudyReplay && !studyAutoPlaying}
            >
              {studyAutoPlaying ? '暂停回放' : '自动回放'}
            </button>
            <button
              className="primary-action"
              onClick={onJumpToPrevMarked}
              disabled={!canJumpToPrevMarked}
            >
              上一星标
            </button>
            <button
              className="primary-action"
              onClick={onJumpToNextMarked}
              disabled={!canJumpToNextMarked}
            >
              下一星标
            </button>
          </div>
          <select
            className="speed-select"
            value={studyReplayDelay}
            onChange={(e) => onStudyReplayDelayChange(Number(e.target.value))}
          >
            <option value={400}>快速</option>
            <option value={900}>标准</option>
            <option value={1600}>慢速</option>
          </select>
        </div>
      )}

      <details className="panel-section secondary-actions">
        <summary>更多工具</summary>
        <div className="panel-buttons">
          <button onClick={onFlip}>翻转棋盘</button>
          {!isJieqi && (
            <button className={showAnalysis ? 'analysis-active' : ''} onClick={onToggleAnalysis}>
              {showAnalysis ? '关闭分析' : '引擎分析'}
            </button>
          )}
          {!isJieqi && <button onClick={onExportFen}>导出 FEN</button>}
          {!isJieqi && <button onClick={onImportFen}>导入 FEN</button>}
          {!isJieqi && <button onClick={onSaveRecentFen}>保存局面</button>}
          {!isJieqi && <button onClick={onSaveStudy}>保存研究</button>}
          <button onClick={onExportImage}>导出图片</button>
          {!isJieqi && <button onClick={onCopyMoveText}>复制棋谱</button>}
          {!isJieqi && <button onClick={onCopyReplayLink}>复制回放链接</button>}
          {!isJieqi && <button onClick={onSaveAsEndgame}>另存残局</button>}
        </div>
      </details>
      {(gameMode === 'human-vs-human' || !isAiVsAi) && (
        <details className="panel-section danger-actions">
          <summary>结束棋局</summary>
          <div className="panel-buttons">
            {gameMode === 'human-vs-human' && (
              <button onClick={onDeclareDraw} disabled={!canDeclareDraw}>
                和棋
              </button>
            )}
            {!isAiVsAi && (
              <button className="danger-action" onClick={onResign} disabled={!canManualEnd}>
                认输
              </button>
            )}
          </div>
        </details>
      )}
    </div>
  )
}
