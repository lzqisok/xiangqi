import { useEffect, useState } from 'react'
import Board from './components/Board'
import GamePanel from './components/GamePanel'
import MoveHistory from './components/MoveHistory'
import AnalysisBar from './components/AnalysisBar'
import EndgameLibrary from './components/EndgameLibrary'
import EndgameEditor from './components/EndgameEditor'
import { useGame } from './hooks/useGame'
import { BUILTIN_ENDGAMES } from './endgames/builtin'
import { deleteCustomEndgame, loadCustomEndgames, loadFavoriteEndgameIds, toggleFavoriteEndgame, upsertCustomEndgame } from './endgames/storage'
import { loadRecentFenPositions, RecentFenPosition, saveRecentFenPosition } from './fen/storage'
import { validateFenPosition } from './engine/validation'
import { EndgameDefinition, EndgameStartConfig, GameMode, Difficulty, MoveRecord, PlayerSide } from './types'

export default function App() {
  const [gameMode, setGameMode] = useState<GameMode | null>(null)
  const [difficulty, setDifficulty] = useState<Difficulty>('medium')
  const [playerSide, setPlayerSide] = useState<PlayerSide>('red')
  const [aiRedDifficulty, setAiRedDifficulty] = useState<Difficulty>('medium')
  const [aiBlackDifficulty, setAiBlackDifficulty] = useState<Difficulty>('medium')
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [showFenDialog, setShowFenDialog] = useState<'import' | 'export' | null>(null)
  const [selectedEndgame, setSelectedEndgame] = useState<EndgameDefinition | null>(null)
  const [customEndgames, setCustomEndgames] = useState<EndgameDefinition[]>([])
  const [favoriteEndgameIds, setFavoriteEndgameIds] = useState<string[]>([])
  const [recentFenPositions, setRecentFenPositions] = useState<RecentFenPosition[]>([])
  const [editingEndgame, setEditingEndgame] = useState(false)
  const [aiAutoPlaying, setAiAutoPlaying] = useState(false)
  const [aiAutoDelay, setAiAutoDelay] = useState(900)
  const [editorDraft, setEditorDraft] = useState<{ id: string | null; name: string; description: string; fen: string }>({
    id: null,
    name: '',
    description: '',
    fen: '',
  })
  const [endgameConfig, setEndgameConfig] = useState<EndgameStartConfig>({
    red: { type: 'human' },
    black: { type: 'ai', difficulty: 'medium' },
  })

  useEffect(() => {
    setCustomEndgames(loadCustomEndgames())
    setFavoriteEndgameIds(loadFavoriteEndgameIds())
    setRecentFenPositions(loadRecentFenPositions())
  }, [])

  const game = useGame({
    gameMode,
    difficulty,
    playerSide,
    aiRedDifficulty,
    aiBlackDifficulty,
    analysisEnabled: showAnalysis,
    initialFen: selectedEndgame?.fen,
    redPlayerConfig: gameMode === 'endgame' ? endgameConfig.red : undefined,
    blackPlayerConfig: gameMode === 'endgame' ? endgameConfig.black : undefined,
  })

  useEffect(() => {
    if (gameMode !== 'ai-vs-ai' || game.gameStatus !== 'playing') {
      setAiAutoPlaying(false)
    }
  }, [gameMode, game.gameStatus])

  useEffect(() => {
    if (!aiAutoPlaying || gameMode !== 'ai-vs-ai' || !game.canStepAi) return
    const timer = setTimeout(() => {
      game.nextAiMove()
    }, aiAutoDelay)
    return () => clearTimeout(timer)
  }, [aiAutoDelay, aiAutoPlaying, gameMode, game.canStepAi, game.nextAiMove])

  if (!gameMode) {
    return <StartScreen onStart={(mode, diff, side, redDiff, blackDiff) => {
      setGameMode(mode)
      setDifficulty(diff)
      setPlayerSide(side)
      setAiRedDifficulty(redDiff)
      setAiBlackDifficulty(blackDiff)
      setSelectedEndgame(null)
      setEditingEndgame(false)
    }} />
  }

  if (editingEndgame) {
    return (
      <EndgameEditor
        initialName={editorDraft.name}
        initialDescription={editorDraft.description}
        initialFen={editorDraft.fen}
        onCancel={() => setEditingEndgame(false)}
        onSave={({ name, description, fen }) => {
          const saved = upsertCustomEndgame({
            id: editorDraft.id || `custom-${Date.now()}`,
            name,
            description,
            fen,
            source: 'custom',
          })
          setCustomEndgames(saved)
          setEditingEndgame(false)
          if (gameMode === 'endgame' && !selectedEndgame) {
            setEditorDraft({ id: null, name: '', description: '', fen: '' })
          }
        }}
      />
    )
  }

  if (gameMode === 'endgame' && !selectedEndgame) {
    return (
      <EndgameLibrary
        builtinEndgames={BUILTIN_ENDGAMES}
        customEndgames={customEndgames}
        favoriteIds={favoriteEndgameIds}
        onBack={() => {
          setGameMode(null)
          setEditingEndgame(false)
        }}
        onCreate={() => {
          setEditorDraft({ id: null, name: '', description: '', fen: '' })
          setEditingEndgame(true)
        }}
        onDelete={(id) => setCustomEndgames(deleteCustomEndgame(id))}
        onEdit={(endgame) => {
          setEditorDraft({
            id: endgame.id,
            name: endgame.name,
            description: endgame.description || '',
            fen: endgame.fen,
          })
          setEditingEndgame(true)
        }}
        onDuplicate={(endgame) => {
          const saved = upsertCustomEndgame({
            ...endgame,
            id: `custom-${Date.now()}`,
            name: `${endgame.name}-副本`,
            source: 'custom',
          })
          setCustomEndgames(saved)
        }}
        onToggleFavorite={(id) => setFavoriteEndgameIds(toggleFavoriteEndgame(id))}
        onStart={(endgame, config) => {
          setSelectedEndgame(endgame)
          setEndgameConfig(config)
        }}
      />
    )
  }

  return (
    <div className="app">
      <div className="game-container">
        {showAnalysis && (
          <AnalysisBar
            evaluation={game.evaluation}
            bestLine={game.bestLine}
            bestLineNotation={game.bestLineNotation}
            depth={game.analysisDepth}
          />
        )}
        <Board
          board={game.board}
          gameStatus={game.gameStatus}
          gameStatusReason={game.gameStatusReason}
          selectedPos={game.selectedPos}
          legalMoves={game.legalMoves}
          lastMove={game.lastMove}
          hintMove={game.hintMove}
          inCheck={game.inCheck}
          flipped={game.flipped}
          aiThinking={game.aiThinking}
          thinkingText={`${game.currentTurn === 'red' ? '红方' : '黑方'} AI 思考中...`}
          onCellClick={game.handleCellClick}
          onCancelSelection={game.cancelSelection}
        />
        <div className="side-panel">
          <GamePanel
            currentTurn={game.currentTurn}
            gameMode={gameMode}
            difficulty={difficulty}
            aiRedDifficulty={aiRedDifficulty}
            aiBlackDifficulty={aiBlackDifficulty}
            redPlayerConfig={game.redPlayerConfig}
            blackPlayerConfig={game.blackPlayerConfig}
            gameStatus={game.gameStatus}
            gameStatusReason={game.gameStatusReason}
            flipped={game.flipped}
            showAnalysis={showAnalysis}
            scenarioName={gameMode === 'endgame' ? selectedEndgame?.name ?? null : null}
            aiThinking={game.aiThinking}
            connectionState={game.connectionState}
            engineAvailable={game.engineAvailable}
            engineStatusMessage={game.engineStatusMessage}
            aiAutoPlaying={aiAutoPlaying}
            aiAutoDelay={aiAutoDelay}
            onNewGame={() => {
              setAiAutoPlaying(false)
              if (gameMode === 'endgame') {
                setSelectedEndgame(null)
                setEditingEndgame(false)
              } else {
                setGameMode(null)
              }
            }}
            onUndo={game.undo}
            onRedo={game.redo}
            onFlip={game.flip}
            onToggleAnalysis={() => setShowAnalysis(!showAnalysis)}
            onExportFen={() => setShowFenDialog('export')}
            onImportFen={() => setShowFenDialog('import')}
            onCopyMoveText={() => {
              navigator.clipboard.writeText(formatMoveRecords(game.moveRecords))
            }}
            onSaveRecentFen={() => {
              setRecentFenPositions(saveRecentFenPosition(game.getCurrentFen(), '手动保存'))
            }}
            onSaveAsEndgame={() => {
              setEditorDraft({
                id: null,
                name: scenarioNameFromState(gameMode, selectedEndgame),
                description: gameMode === 'endgame' && selectedEndgame
                  ? `基于残局「${selectedEndgame.name}」另存`
                  : '从当前局面保存',
                fen: game.getCurrentFen(),
              })
              setEditingEndgame(true)
            }}
            onHint={game.requestHint}
            onNextAiMove={game.nextAiMove}
            onToggleAiAutoPlay={() => setAiAutoPlaying(value => !value)}
            onAiAutoDelayChange={setAiAutoDelay}
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
          recentPositions={recentFenPositions}
          onClose={() => setShowFenDialog(null)}
          onLoad={(fen) => {
            const loaded = game.loadFen(fen)
            if (loaded) {
              setRecentFenPositions(saveRecentFenPosition(fen, '导入局面'))
              setShowFenDialog(null)
            }
            return loaded
          }}
        />
      )}
    </div>
  )
}

function scenarioNameFromState(gameMode: GameMode, selectedEndgame: EndgameDefinition | null): string {
  if (gameMode === 'endgame' && selectedEndgame) {
    return `${selectedEndgame.name}-副本`
  }
  return '自定义残局'
}

function formatMoveRecords(records: MoveRecord[]): string {
  if (records.length === 0) return '暂无走棋记录'

  const lines: string[] = []
  for (let i = 0; i < records.length; i += 2) {
    const moveNum = Math.floor(i / 2) + 1
    const redMove = records[i]?.notation || ''
    const blackMove = records[i + 1]?.notation || ''
    lines.push(`${moveNum}. ${redMove}${blackMove ? ` ${blackMove}` : ''}`.trim())
  }
  return lines.join('\n')
}

function FenDialog({ mode, fen, recentPositions, onClose, onLoad }: {
  mode: 'import' | 'export'
  fen: string
  recentPositions?: RecentFenPosition[]
  onClose: () => void
  onLoad?: (fen: string) => boolean
}) {
  const [value, setValue] = useState(fen)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  const validation = mode === 'import' && value.trim()
    ? validateFenPosition(value)
    : null
  const canLoad = mode === 'export' || (Boolean(value.trim()) && validation?.ok !== false)

  return (
    <div className="fen-dialog" onClick={onClose}>
      <div className="fen-dialog-content" onClick={e => e.stopPropagation()}>
        <h3>{mode === 'export' ? '导出 FEN' : '导入 FEN'}</h3>
        <input
          type="text"
          value={value}
          onChange={e => {
            setValue(e.target.value)
            setError('')
          }}
          readOnly={mode === 'export'}
          placeholder="输入 FEN 字符串..."
          autoFocus
        />
        {mode === 'import' && value.trim() && validation && !validation.ok && (
          <div className="fen-dialog-error">
            <ul>
              {validation.errors.map(error => <li key={error}>{error}</li>)}
            </ul>
          </div>
        )}
        {error && <div className="fen-dialog-error">{error}</div>}
        {mode === 'import' && recentPositions && recentPositions.length > 0 && (
          <div className="recent-fen-list">
            <div className="recent-fen-title">最近局面</div>
            {recentPositions.map(item => (
              <button
                key={`${item.savedAt}-${item.fen}`}
                className="recent-fen-item"
                onClick={() => {
                  setValue(item.fen)
                  setError('')
                }}
              >
                <span>{item.label}</span>
                <code>{item.fen}</code>
              </button>
            ))}
          </div>
        )}
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
            <button
              className="confirm"
              disabled={!canLoad}
              onClick={() => {
                if (!onLoad?.(value)) setError('局面加载失败，请检查 FEN。')
              }}
            >
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

        <div className="option-group mode-option-group">
          <label>游戏模式</label>
          <div className="btn-group mode-btn-group">
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
            <button
              className={mode === 'endgame' ? 'active' : ''}
              onClick={() => setMode('endgame')}
            >残局模式</button>
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
