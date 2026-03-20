import { useState } from 'react'
import Board from './components/Board'
import GamePanel from './components/GamePanel'
import MoveHistory from './components/MoveHistory'
import AnalysisBar from './components/AnalysisBar'
import { useGame } from './hooks/useGame'
import { GameMode, Difficulty, PlayerSide } from './types'

export default function App() {
  const [gameMode, setGameMode] = useState<GameMode | null>(null)
  const [difficulty, setDifficulty] = useState<Difficulty>('medium')
  const [playerSide, setPlayerSide] = useState<PlayerSide>('red')
  const [aiRedDifficulty, setAiRedDifficulty] = useState<Difficulty>('medium')
  const [aiBlackDifficulty, setAiBlackDifficulty] = useState<Difficulty>('medium')
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [showFenDialog, setShowFenDialog] = useState<'import' | 'export' | null>(null)

  const game = useGame({ gameMode, difficulty, playerSide, aiRedDifficulty, aiBlackDifficulty })

  if (!gameMode) {
    return <StartScreen onStart={(mode, diff, side, redDiff, blackDiff) => {
      setGameMode(mode)
      setDifficulty(diff)
      setPlayerSide(side)
      setAiRedDifficulty(redDiff)
      setAiBlackDifficulty(blackDiff)
    }} />
  }

  return (
    <div className="app">
      <div className="game-container">
        {showAnalysis && (
          <AnalysisBar
            evaluation={game.evaluation}
            bestLine={game.bestLine}
            depth={game.analysisDepth}
          />
        )}
        <Board
          board={game.board}
          selectedPos={game.selectedPos}
          legalMoves={game.legalMoves}
          lastMove={game.lastMove}
          hintMove={game.hintMove}
          inCheck={game.inCheck}
          flipped={game.flipped}
          onCellClick={game.handleCellClick}
        />
        <div className="side-panel">
          <GamePanel
            currentTurn={game.currentTurn}
            gameMode={gameMode}
            difficulty={difficulty}
            aiRedDifficulty={aiRedDifficulty}
            aiBlackDifficulty={aiBlackDifficulty}
            gameStatus={game.gameStatus}
            flipped={game.flipped}
            showAnalysis={showAnalysis}
            onNewGame={() => setGameMode(null)}
            onUndo={game.undo}
            onRedo={game.redo}
            onFlip={game.flip}
            onToggleAnalysis={() => setShowAnalysis(!showAnalysis)}
            onExportFen={() => setShowFenDialog('export')}
            onImportFen={() => setShowFenDialog('import')}
            onHint={game.requestHint}
            onNextAiMove={game.nextAiMove}
            canUndo={game.canUndo}
            canRedo={game.canRedo}
            canRequestHint={game.canRequestHint}
            canStepAi={game.canStepAi}
            hintThinking={game.hintThinking}
          />
          <MoveHistory
            moves={game.moveRecords}
            currentIndex={game.currentMoveIndex}
            onJumpTo={game.jumpToMove}
          />
        </div>
      </div>

      {showFenDialog === 'export' && (
        <FenDialog
          mode="export"
          fen={game.getCurrentFen()}
          onClose={() => setShowFenDialog(null)}
        />
      )}
      {showFenDialog === 'import' && (
        <FenDialog
          mode="import"
          fen=""
          onClose={() => setShowFenDialog(null)}
          onLoad={(fen) => {
            game.loadFen(fen)
            setShowFenDialog(null)
          }}
        />
      )}
    </div>
  )
}

function FenDialog({ mode, fen, onClose, onLoad }: {
  mode: 'import' | 'export'
  fen: string
  onClose: () => void
  onLoad?: (fen: string) => void
}) {
  const [value, setValue] = useState(fen)
  const [copied, setCopied] = useState(false)

  return (
    <div className="fen-dialog" onClick={onClose}>
      <div className="fen-dialog-content" onClick={e => e.stopPropagation()}>
        <h3>{mode === 'export' ? '导出 FEN' : '导入 FEN'}</h3>
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          readOnly={mode === 'export'}
          placeholder="输入 FEN 字符串..."
          autoFocus
        />
        <div className="btn-row">
          <button className="cancel" onClick={onClose}>取消</button>
          {mode === 'export' ? (
            <button className="confirm" onClick={() => {
              navigator.clipboard.writeText(value)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}>
              {copied ? '已复制' : '复制'}
            </button>
          ) : (
            <button className="confirm" onClick={() => onLoad?.(value)}>
              加载
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function StartScreen({ onStart }: {
  onStart: (mode: GameMode, difficulty: Difficulty, side: PlayerSide, redDifficulty: Difficulty, blackDifficulty: Difficulty) => void
}) {
  const [mode, setMode] = useState<GameMode>('human-vs-ai')
  const [diff, setDiff] = useState<Difficulty>('medium')
  const [side, setSide] = useState<PlayerSide>('red')
  const [redDiff, setRedDiff] = useState<Difficulty>('medium')
  const [blackDiff, setBlackDiff] = useState<Difficulty>('medium')

  return (
    <div className="start-screen">
      <div className="start-card">
        <h1>中国象棋</h1>
        <p className="subtitle">基于 Pikafish 引擎</p>

        <div className="option-group">
          <label>游戏模式</label>
          <div className="btn-group">
            <button
              className={mode === 'human-vs-ai' ? 'active' : ''}
              onClick={() => setMode('human-vs-ai')}
            >人机对弈</button>
            <button
              className={mode === 'human-vs-human' ? 'active' : ''}
              onClick={() => setMode('human-vs-human')}
            >双人对弈</button>
            <button
              className={mode === 'ai-vs-ai' ? 'active' : ''}
              onClick={() => setMode('ai-vs-ai')}
            >AI 对战</button>
          </div>
        </div>

        {mode === 'human-vs-ai' && (
          <>
            <div className="option-group">
              <label>难度等级</label>
              <div className="btn-group">
                <button className={diff === 'easy' ? 'active' : ''} onClick={() => setDiff('easy')}>初级</button>
                <button className={diff === 'medium' ? 'active' : ''} onClick={() => setDiff('medium')}>中级</button>
                <button className={diff === 'hard' ? 'active' : ''} onClick={() => setDiff('hard')}>高级</button>
                <button className={diff === 'master' ? 'active' : ''} onClick={() => setDiff('master')}>大师</button>
              </div>
            </div>
            <div className="option-group">
              <label>选择方</label>
              <div className="btn-group">
                <button className={side === 'red' ? 'active red-side' : ''} onClick={() => setSide('red')}>执红先行</button>
                <button className={side === 'black' ? 'active black-side' : ''} onClick={() => setSide('black')}>执黑后手</button>
              </div>
            </div>
          </>
        )}

        {mode === 'ai-vs-ai' && (
          <>
            <div className="option-group">
              <label>红方强度</label>
              <div className="btn-group">
                <button className={redDiff === 'easy' ? 'active' : ''} onClick={() => setRedDiff('easy')}>初级</button>
                <button className={redDiff === 'medium' ? 'active' : ''} onClick={() => setRedDiff('medium')}>中级</button>
                <button className={redDiff === 'hard' ? 'active' : ''} onClick={() => setRedDiff('hard')}>高级</button>
                <button className={redDiff === 'master' ? 'active' : ''} onClick={() => setRedDiff('master')}>大师</button>
              </div>
            </div>
            <div className="option-group">
              <label>黑方强度</label>
              <div className="btn-group">
                <button className={blackDiff === 'easy' ? 'active' : ''} onClick={() => setBlackDiff('easy')}>初级</button>
                <button className={blackDiff === 'medium' ? 'active' : ''} onClick={() => setBlackDiff('medium')}>中级</button>
                <button className={blackDiff === 'hard' ? 'active' : ''} onClick={() => setBlackDiff('hard')}>高级</button>
                <button className={blackDiff === 'master' ? 'active' : ''} onClick={() => setBlackDiff('master')}>大师</button>
              </div>
            </div>
          </>
        )}

        <button className="start-btn" onClick={() => onStart(mode, diff, side, redDiff, blackDiff)}>
          开始游戏
        </button>
      </div>
    </div>
  )
}
