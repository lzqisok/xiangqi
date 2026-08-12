import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Board, { BoardHandle } from './components/Board'
import GamePanel from './components/GamePanel'
import MoveHistory from './components/MoveHistory'
import JieqiCapturedPieces from './components/JieqiCapturedPieces'
import AnalysisBar from './components/AnalysisBar'
import AnalysisCurve from './components/AnalysisCurve'
import EndgameLibrary from './components/EndgameLibrary'
import EndgameEditor from './components/EndgameEditor'
import CandidateList from './components/CandidateList'
import CandidatePreviewControls from './components/CandidatePreviewControls'
import ReviewPanel from './components/ReviewPanel'
import VariationPanel from './components/VariationPanel'
import StudyLibrary from './components/StudyLibrary'
import { useGame } from './hooks/useGame'
import { BUILTIN_ENDGAMES } from './endgames/builtin'
import {
  deleteCustomEndgame,
  exportCustomEndgamesJson,
  importCustomEndgamesJson,
  loadCustomEndgames,
  loadFavoriteEndgameIds,
  normalizeTags,
  toggleFavoriteEndgame,
  upsertCustomEndgame,
} from './endgames/storage'
import { loadRecentFenPositions, RecentFenPosition, saveRecentFenPosition } from './fen/storage'
import {
  deleteStudyPosition,
  deleteStudyPositions,
  duplicateStudyPosition,
  exportStudyPositionsJson,
  importStudyPositionsJson,
  loadStudyPositions,
  renameStudyPosition,
  saveStudyPosition,
} from './studies/storage'
import { validateFenPosition } from './engine/validation'
import { getNaturalLimitReminder } from './engine/naturalLimit'
import { getRepetitionReminder } from './engine/repetition'
import { EngineSettings, loadEngineSettings, saveEngineSettings } from './engineSettings'
import { buildBoardExportMetadata, createAnnotatedBoardPng } from './export/boardImage'
import { formatTrainingHintHistory, getEndgameTrainingFeedback, getEndgameTrainingHint, recordTrainingHintLevel, TrainingHintHistoryEntry } from './training/hints'
import { createReplayUrl, parseReplayStudyFromSearch } from './share/replayLink'
import { buildCandidatePreview, getCandidatePreviewFrame } from './analysis/candidatePreview'
import { buildMoveReviews } from './analysis/moveReview'
import { createStudyContentSignature, createStudySaveInput } from './studies/autosave'
import { createGame, deleteGame, gameExportUrl, importGames, listGames, loadGame, renameGame } from './games/api'
import { clearGameUrl, createInitialPersistedState, gameUrl } from './games/state'
import { GameSaveStatus, useGamePersistence } from './games/useGamePersistence'
import { EndgameDefinition, EndgameStartConfig, EndgameTarget, GameDocument, GameMode, Difficulty, GameSummary, LiveGameMode, MoveCandidate, MoveRecord, PersistedGameConfig, PersistedGameState, PlayerSide, StudyPosition } from './types'
import LanApp from './lan/LanApp'

const GomokuApp = lazy(() => import('./gomoku/GomokuApp'))
const GomokuLanApp = lazy(() => import('./gomoku/lan/GomokuLanApp'))

type EndgameDraft = {
  id: string | null
  name: string
  description: string
  fen: string
  tags: string[]
  target?: EndgameTarget
  maxMoves?: number
  solution: string[]
}

type CandidatePreviewState = {
  candidate: MoveCandidate
  records: MoveRecord[]
  stepIndex: number
}

type WorkspaceTab = 'play' | 'engine' | 'review' | 'variations'

export default function App() {
  const search = new URLSearchParams(window.location.search)
  if (search.has('gomoku') && (search.has('lan') || search.has('room'))) return <Suspense fallback={<main className="home-screen">正在载入五子棋大厅…</main>}><GomokuLanApp /></Suspense>
  if (search.has('gomoku') && search.has('local')) return <Suspense fallback={<main className="home-screen">正在载入五子棋…</main>}><GomokuApp /></Suspense>
  if (search.has('gomoku') || search.get('type') === 'gomoku') return <GameModeScreen game="gomoku" />
  if (search.has('lan') || search.has('room')) return <LanApp />
  if (search.has('local') || search.has('game') || search.has('replay')) return <LocalApp />
  if (search.get('type') === 'xiangqi') return <GameModeScreen game="xiangqi" />
  return <HomeScreen />
}

function HomeScreen() {
  return <main className="home-screen">
    <section className="home-card">
      <div className="home-brand"><span aria-hidden="true">弈</span><div><small>BOARD GAME STUDIO</small><h1>棋局空间</h1><p>选择棋类与对弈方式</p></div></div>
      <nav className="home-entries" aria-label="游戏入口">
        <a href="?type=xiangqi"><span className="home-entry-mark">象</span><strong>中国象棋</strong><small>标准象棋、揭棋、残局训练与局域网对决</small><b>选择模式 →</b></a>
        <a href="?type=gomoku"><span className="home-entry-mark gomoku">五</span><strong>五子棋</strong><small>本地练习、人机与 AI 对决、局域网房间</small><b>选择模式 →</b></a>
      </nav>
    </section>
  </main>
}

function GameModeScreen({ game }: { game: 'xiangqi' | 'gomoku' }) {
  const gomoku = game === 'gomoku'
  return <main className="home-screen"><section className="home-card">
    <div className="home-brand"><span className={gomoku ? 'gomoku' : ''} aria-hidden="true">{gomoku ? '五' : '象'}</span><div><small>{gomoku ? 'GOMOKU' : 'XIANGQI'} STUDIO</small><h1>{gomoku ? '五子棋' : '中国象棋'}</h1><p>选择对弈方式</p></div></div>
    <nav className="home-entries home-mode-entries" aria-label="对弈方式">
      <a href={gomoku ? '?gomoku=1&local=1' : '?local=1'}><span className="home-entry-mark">练</span><strong>本地</strong><small>{gomoku ? '双人练习、人机挑战、AI 对决与局后复盘' : '人机对弈、双人练习、残局与复盘'}</small><b>进入练习 →</b></a>
      <a href={gomoku ? '?gomoku=1&lan=1' : '?lan=1'}><span className="home-entry-mark online">联</span><strong>在线</strong><small>创建局域网房间、邀请棋友、实时聊天与观战</small><b>进入大厅 →</b></a>
    </nav>
    <a className="home-back-link" href="?">← 返回棋类选择</a>
  </section></main>
}

function LocalApp() {
  const [initialReplay] = useState(() => (
    typeof window === 'undefined' || new URLSearchParams(window.location.search).has('game')
      ? null
      : parseReplayStudyFromSearch(window.location.search)
  ))
  const boardRef = useRef<BoardHandle>(null)
  const [gameMode, setGameMode] = useState<GameMode | null>(() => initialReplay?.ok ? 'study' : null)
  const [activeGame, setActiveGame] = useState<GameDocument | null>(null)
  const [initialLiveState, setInitialLiveState] = useState<PersistedGameState | null>(null)
  const [savedGames, setSavedGames] = useState<GameSummary[]>([])
  const [gameStoreLoading, setGameStoreLoading] = useState(true)
  const [gameStoreError, setGameStoreError] = useState('')
  const [startingGame, setStartingGame] = useState(false)
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
  const [studies, setStudies] = useState<StudyPosition[]>([])
  const [selectedStudy, setSelectedStudy] = useState<StudyPosition | null>(() => initialReplay?.ok ? initialReplay.study : null)
  const [editingEndgame, setEditingEndgame] = useState(false)
  const [aiAutoPlaying, setAiAutoPlaying] = useState(false)
  const [aiAutoDelay, setAiAutoDelay] = useState(900)
  const [studyAutoPlaying, setStudyAutoPlaying] = useState(false)
  const [studyReplayDelay, setStudyReplayDelay] = useState(900)
  const [showOnlyAnnotatedMoves, setShowOnlyAnnotatedMoves] = useState(false)
  const [candidateAutoRefresh, setCandidateAutoRefresh] = useState(false)
  const [candidatePreview, setCandidatePreview] = useState<CandidatePreviewState | null>(null)
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('play')
  const [studySaveStatus, setStudySaveStatus] = useState<'saved' | 'unsaved' | 'shared' | null>(null)
  const [engineSettings, setEngineSettings] = useState<EngineSettings>(() => loadEngineSettings())
  const [trainingHintLevel, setTrainingHintLevel] = useState(0)
  const [trainingHintHistory, setTrainingHintHistory] = useState<TrainingHintHistoryEntry[]>([])
  const candidateAutoRequestRef = useRef<string | null>(null)
  const historyNavigationRef = useRef(false)
  const [editorDraft, setEditorDraft] = useState<EndgameDraft>({
    id: null,
    name: '',
    description: '',
    fen: '',
    tags: [],
    solution: [],
  })
  const [endgameConfig, setEndgameConfig] = useState<EndgameStartConfig>({
    red: { type: 'human' },
    black: { type: 'ai', difficulty: 'medium' },
  })
  const searchLimit = useMemo(() => ({
    searchMode: engineSettings.searchMode,
    searchDepth: engineSettings.searchDepth,
    searchTimeMs: engineSettings.searchTimeMs,
  }), [engineSettings.searchDepth, engineSettings.searchMode, engineSettings.searchTimeMs])
  const engineRuntimeOptions = useMemo(() => ({
    engineThreads: engineSettings.engineThreads,
    engineHashMb: engineSettings.engineHashMb,
  }), [engineSettings.engineHashMb, engineSettings.engineThreads])

  useEffect(() => {
    setCustomEndgames(loadCustomEndgames())
    setFavoriteEndgameIds(loadFavoriteEndgameIds())
    setRecentFenPositions(loadRecentFenPositions())
    setStudies(loadStudyPositions())
  }, [])

  const refreshSavedGames = useCallback(async () => {
    try {
      const games = await listGames()
      setSavedGames(games)
      setGameStoreError('')
    } catch (error) {
      setGameStoreError(error instanceof Error ? error.message : '无法读取已保存对局')
    }
  }, [])

  const openGame = useCallback((document: GameDocument, updateUrl = true) => {
    setActiveGame(document)
    setInitialLiveState(document.state)
    setDifficulty(document.config.difficulty)
    setPlayerSide(document.config.playerSide)
    setAiRedDifficulty(document.config.aiRedDifficulty)
    setAiBlackDifficulty(document.config.aiBlackDifficulty)
    setSelectedEndgame(null)
    setSelectedStudy(null)
    setEditingEndgame(false)
    setGameMode(document.mode)
    if (updateUrl) window.history.pushState(null, '', gameUrl(document.id))
  }, [])

  useEffect(() => {
    let cancelled = false
    const boot = async () => {
      setGameStoreLoading(true)
      const gameId = new URLSearchParams(window.location.search).get('game')
      const [gamesResult, gameResult] = await Promise.allSettled([
        listGames(),
        gameId ? loadGame(gameId) : Promise.resolve(null),
      ])
      if (cancelled) return
      if (gamesResult.status === 'fulfilled') setSavedGames(gamesResult.value)
      else setGameStoreError(gamesResult.reason instanceof Error ? gamesResult.reason.message : '无法读取已保存对局')
      if (gameResult.status === 'fulfilled' && gameResult.value) {
        openGame(gameResult.value, false)
      } else if (gameResult.status === 'rejected') {
        setGameStoreError(gameResult.reason instanceof Error ? `对局加载失败：${gameResult.reason.message}` : '对局加载失败')
      }
      setGameStoreLoading(false)
    }
    void boot()
    return () => { cancelled = true }
  }, [openGame])

  useEffect(() => {
    if (initialReplay && !initialReplay.ok) {
      window.alert(initialReplay.error)
    }
  }, [initialReplay])

  const game = useGame({
    gameId: activeGame?.id,
    gameMode,
    difficulty,
    playerSide,
    aiRedDifficulty,
    aiBlackDifficulty,
    candidateCount: engineSettings.candidateCount,
    hintDifficulty: engineSettings.hintDifficulty,
    searchLimit,
    engineRuntimeOptions,
    analysisEnabled: showAnalysis && gameMode !== 'jieqi',
    initialFen: initialLiveState?.initialFen || (gameMode === 'study' ? selectedStudy?.initialFen : selectedEndgame?.fen),
    initialMoveRecords: initialLiveState?.historyRecords || (gameMode === 'study' ? selectedStudy?.moves : undefined),
    initialCurrentMoveIndex: initialLiveState?.currentMoveIndex ?? (gameMode === 'study' ? selectedStudy?.currentMoveIndex : undefined),
    initialAnalysisPoints: gameMode === 'study' ? selectedStudy?.analysisPoints : undefined,
    initialVariationTree: initialLiveState?.variationTree || (gameMode === 'study' ? selectedStudy?.variationTree : undefined),
    initialJieqiBoard: initialLiveState?.initialJieqiBoard,
    initialGameStatus: initialLiveState?.gameStatus,
    initialGameStatusReason: initialLiveState?.gameStatusReason,
    redPlayerConfig: gameMode === 'endgame' ? endgameConfig.red : undefined,
    blackPlayerConfig: gameMode === 'endgame' ? endgameConfig.black : undefined,
  })

  const liveGameState = useMemo<PersistedGameState | null>(() => {
    if (!activeGame || !isLiveGameMode(gameMode)) return null
    return {
      initialFen: game.initialFen,
      initialJieqiBoard: gameMode === 'jieqi' ? game.initialJieqiBoard || initialLiveState?.initialJieqiBoard : undefined,
      historyRecords: game.historyRecords,
      currentMoveIndex: game.currentMoveIndex,
      variationTree: game.variationTree,
      gameStatus: game.gameStatus,
      gameStatusReason: game.gameStatusReason,
    }
  }, [activeGame, game.currentMoveIndex, game.gameStatus, game.gameStatusReason, game.historyRecords, game.initialFen, game.initialJieqiBoard, game.variationTree, gameMode, initialLiveState?.initialJieqiBoard])

  const handleGameSaved = useCallback((document: GameDocument) => {
    setActiveGame(document)
    setSavedGames(current => [toGameSummary(document), ...current.filter(item => item.id !== document.id)]
      .sort((a, b) => b.updatedAt - a.updatedAt))
  }, [])
  const gamePersistence = useGamePersistence({
    game: activeGame,
    baselineState: initialLiveState,
    state: liveGameState,
    leaseToken: game.leaseToken,
    enabled: Boolean(activeGame && game.canEditGame),
    onSaved: handleGameSaved,
  })

  useEffect(() => {
    const handlePopState = async () => {
      if (historyNavigationRef.current) {
        if (activeGame) window.history.pushState(null, '', gameUrl(activeGame.id))
        return
      }
      historyNavigationRef.current = true
      const destinationGameId = new URLSearchParams(window.location.search).get('game')
      try {
        if (activeGame && destinationGameId !== activeGame.id) {
          const saved = await gamePersistence.flush(liveGameState)
          if (!saved && !window.confirm('当前对局尚未成功保存，仍要离开吗？未保存的走棋可能丢失。')) {
            window.history.pushState(null, '', gameUrl(activeGame.id))
            return
          }
        }
        if (!destinationGameId) {
          setActiveGame(null)
          setInitialLiveState(null)
          setGameMode(null)
          return
        }
        if (destinationGameId === activeGame?.id) return
        try {
          openGame(await loadGame(destinationGameId), false)
        } catch (error) {
          setGameStoreError(error instanceof Error ? error.message : '对局加载失败')
          if (activeGame) window.history.pushState(null, '', gameUrl(activeGame.id))
        }
      } finally {
        historyNavigationRef.current = false
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [activeGame, gamePersistence.flush, liveGameState, openGame])

  useEffect(() => {
    if (!activeGame || gamePersistence.status === 'saved' || gamePersistence.status === 'idle') return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [activeGame, gamePersistence.status])

  const trainingFeedback = getEndgameTrainingFeedback(selectedEndgame, game.moveRecords, game.gameStatus, game.evaluation)
  const trainingHint = getEndgameTrainingHint(selectedEndgame, game.moveRecords, game.board, trainingHintLevel)
  const trainingHintHistoryText = formatTrainingHintHistory(trainingHintHistory)
  const naturalLimitReminder = gameMode === 'jieqi' ? '' : getNaturalLimitReminder(game.moveRecords)
  const repetitionReminder = gameMode === 'jieqi' ? '' : getRepetitionReminder(game.initialFen, game.moveRecords)
  const candidateAutoPositionKey = game.moveRecords[game.currentMoveIndex]?.fen || game.initialFen
  const candidatePreviewFrame = useMemo(
    () => candidatePreview
      ? getCandidatePreviewFrame(candidateAutoPositionKey, candidatePreview.records, candidatePreview.stepIndex)
      : null,
    [candidateAutoPositionKey, candidatePreview],
  )
  const moveReviews = useMemo(
    () => buildMoveReviews(game.initialFen, game.historyRecords, game.reviewPositions),
    [game.historyRecords, game.initialFen, game.reviewPositions],
  )
  const studyContent = useMemo(() => ({
    initialFen: game.initialFen,
    moves: game.historyRecords,
    currentMoveIndex: game.currentMoveIndex,
    analysisPoints: game.analysisPoints,
    variationTree: game.variationTree,
  }), [game.analysisPoints, game.currentMoveIndex, game.historyRecords, game.initialFen, game.variationTree])
  const studyContentSignature = useMemo(() => createStudyContentSignature(studyContent), [studyContent])
  const selectedStudyIsPersisted = Boolean(selectedStudy && studies.some(study => study.id === selectedStudy.id))
  const lastSavedStudySignatureRef = useRef<string | null>(null)
  const canRequestTrainingHint = Boolean(selectedEndgame?.solution?.length) && game.gameStatus === 'playing'

  useEffect(() => {
    if (gameMode !== 'jieqi') return
    setShowAnalysis(false)
    setCandidateAutoRefresh(false)
    setCandidatePreview(null)
    if (workspaceTab === 'engine' || workspaceTab === 'variations') setWorkspaceTab('play')
  }, [gameMode, workspaceTab])

  useEffect(() => {
    setTrainingHintLevel(0)
  }, [game.currentMoveIndex, selectedEndgame?.id])

  useEffect(() => {
    setTrainingHintHistory([])
  }, [selectedEndgame?.id])

  useEffect(() => {
    if (gameMode !== 'ai-vs-ai' || game.gameStatus !== 'playing') {
      setAiAutoPlaying(false)
    }
  }, [gameMode, game.gameStatus])

  useEffect(() => {
    if (gameMode !== 'study' || !game.canRedo) {
      setStudyAutoPlaying(false)
    }
  }, [gameMode, game.canRedo])

  useEffect(() => {
    if (!aiAutoPlaying || gameMode !== 'ai-vs-ai' || !game.canStepAi) return
    const timer = setTimeout(() => {
      game.nextAiMove()
    }, aiAutoDelay)
    return () => clearTimeout(timer)
  }, [aiAutoDelay, aiAutoPlaying, gameMode, game.canStepAi, game.nextAiMove])

  useEffect(() => {
    if (!studyAutoPlaying || gameMode !== 'study' || !game.canRedo) return
    const timer = setTimeout(() => {
      game.redo()
    }, studyReplayDelay)
    return () => clearTimeout(timer)
  }, [gameMode, game.canRedo, game.redo, studyAutoPlaying, studyReplayDelay])

  useEffect(() => {
    if (!candidateAutoRefresh || !game.canRequestCandidates) return
    if (candidateAutoRequestRef.current === candidateAutoPositionKey) return
    const timer = setTimeout(() => {
      candidateAutoRequestRef.current = candidateAutoPositionKey
      game.requestCandidates()
    }, engineSettings.candidateAutoRefreshDelay)
    return () => clearTimeout(timer)
  }, [candidateAutoPositionKey, candidateAutoRefresh, engineSettings.candidateAutoRefreshDelay, game.canRequestCandidates, game.requestCandidates])

  useEffect(() => {
    if (!candidateAutoRefresh) {
      candidateAutoRequestRef.current = null
    }
  }, [candidateAutoRefresh])

  useEffect(() => {
    setCandidatePreview(null)
  }, [candidateAutoPositionKey])

  useEffect(() => {
    if (gameMode !== 'study' || !selectedStudy) {
      lastSavedStudySignatureRef.current = null
      setStudySaveStatus(null)
      return
    }
    if (!selectedStudyIsPersisted) {
      lastSavedStudySignatureRef.current = null
      setStudySaveStatus('shared')
      return
    }
    lastSavedStudySignatureRef.current = createStudyContentSignature({
      initialFen: selectedStudy.initialFen,
      moves: selectedStudy.moves,
      currentMoveIndex: selectedStudy.currentMoveIndex,
      analysisPoints: selectedStudy.analysisPoints,
      variationTree: selectedStudy.variationTree,
    })
    setStudySaveStatus('saved')
  }, [gameMode, selectedStudy?.id, selectedStudyIsPersisted])

  useEffect(() => {
    if (gameMode !== 'study' || !selectedStudy || !selectedStudyIsPersisted) return
    if (studyContentSignature === lastSavedStudySignatureRef.current) {
      setStudySaveStatus('saved')
      return
    }

    setStudySaveStatus('unsaved')
    const timer = window.setTimeout(() => {
      const saved = saveStudyPosition(createStudySaveInput(selectedStudy, studyContent))
      lastSavedStudySignatureRef.current = studyContentSignature
      setStudies(saved)
      setStudySaveStatus('saved')
    }, 800)
    return () => window.clearTimeout(timer)
  }, [gameMode, selectedStudy, selectedStudyIsPersisted, studyContent, studyContentSignature])

  if (!gameMode) {
    return <StartScreen
      games={savedGames}
      loading={gameStoreLoading}
      storeError={gameStoreError}
      starting={startingGame}
      onRetry={refreshSavedGames}
      onOpen={async id => {
        try {
          openGame(await loadGame(id))
        } catch (error) {
          setGameStoreError(error instanceof Error ? error.message : '对局加载失败')
        }
      }}
      onRename={async (summary, name) => {
        try {
          const renamed = await renameGame(summary, name)
          setSavedGames(current => current.map(item => item.id === renamed.id ? toGameSummary(renamed) : item))
        } catch (error) {
          setGameStoreError(error instanceof Error ? error.message : '重命名失败')
        }
      }}
      onDelete={async summary => {
        try {
          await deleteGame(summary)
          setSavedGames(current => current.filter(item => item.id !== summary.id))
        } catch (error) {
          setGameStoreError(error instanceof Error ? error.message : '删除失败')
        }
      }}
      onImport={async file => {
        try {
          const payload = JSON.parse(await file.text()) as unknown
          await importGames(payload)
          await refreshSavedGames()
        } catch (error) {
          setGameStoreError(error instanceof Error ? error.message : '导入失败')
        }
      }}
      onStart={async (mode, diff, side, redDiff, blackDiff) => {
        setStartingGame(true)
        setGameStoreError('')
        const begin = (initialState: PersistedGameState | null, document: GameDocument | null) => {
          setActiveGame(document)
          setInitialLiveState(initialState)
          setGameMode(mode)
          setDifficulty(diff)
          setPlayerSide(side)
          setAiRedDifficulty(redDiff)
          setAiBlackDifficulty(blackDiff)
          setSelectedEndgame(null)
          setSelectedStudy(null)
          setEditingEndgame(false)
        }
        if (!isLiveGameMode(mode)) {
          clearGameUrl()
          begin(null, null)
          setStartingGame(false)
          return
        }
        const state = createInitialPersistedState(mode)
        const config: PersistedGameConfig = {
          difficulty: diff,
          playerSide: side,
          aiRedDifficulty: redDiff,
          aiBlackDifficulty: blackDiff,
        }
        try {
          const document = await createGame({ mode, config, state })
          begin(document.state, document)
          window.history.pushState(null, '', gameUrl(document.id))
          setSavedGames(current => [toGameSummary(document), ...current.filter(item => item.id !== document.id)])
        } catch (error) {
          const message = error instanceof Error ? error.message : '创建保存对局失败'
          setGameStoreError(message)
          if (window.confirm(`${message}\n\n是否改为开始临时对局？临时对局刷新后不会保留。`)) {
            clearGameUrl()
            begin(state, null)
          }
        } finally {
          setStartingGame(false)
        }
      }}
    />
  }

  if (editingEndgame) {
    return (
      <EndgameEditor
        initialName={editorDraft.name}
        initialDescription={editorDraft.description}
        initialFen={editorDraft.fen}
        initialTags={editorDraft.tags}
        initialTarget={editorDraft.target}
        initialMaxMoves={editorDraft.maxMoves}
        initialSolution={editorDraft.solution}
        onCancel={() => setEditingEndgame(false)}
        onSave={({ name, description, fen, tags, target, maxMoves, solution }) => {
          const saved = upsertCustomEndgame({
            id: editorDraft.id || `custom-${Date.now()}`,
            name,
            description,
            fen,
            tags: normalizeTags(tags),
            target,
            maxMoves,
            solution,
            source: 'custom',
          })
          setCustomEndgames(saved)
          setEditingEndgame(false)
          if (gameMode === 'endgame' && !selectedEndgame) {
            setEditorDraft({ id: null, name: '', description: '', fen: '', tags: [], solution: [] })
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
          setEditorDraft({ id: null, name: '', description: '', fen: '', tags: [], solution: [] })
          setEditingEndgame(true)
        }}
        onDelete={(id) => setCustomEndgames(deleteCustomEndgame(id))}
        onEdit={(endgame) => {
          setEditorDraft({
            id: endgame.id,
            name: endgame.name,
            description: endgame.description || '',
            fen: endgame.fen,
            tags: endgame.tags || [],
            target: endgame.target,
            maxMoves: endgame.maxMoves,
            solution: endgame.solution || [],
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
        onExportJson={() => downloadJson('xiangqi-custom-endgames.json', exportCustomEndgamesJson())}
        onImportJson={(file) => {
          file.text()
            .then(text => setCustomEndgames(importCustomEndgamesJson(text)))
            .catch(() => undefined)
        }}
        onStart={(endgame, config) => {
          setSelectedEndgame(endgame)
          setEndgameConfig(config)
        }}
      />
    )
  }

  if (gameMode === 'study' && !selectedStudy) {
    return (
      <StudyLibrary
        studies={studies}
        onBack={() => setGameMode(null)}
        onStart={(study) => setSelectedStudy(study)}
        onDelete={(id) => {
          setStudies(deleteStudyPosition(id))
        }}
        onDeleteMany={(ids) => {
          setStudies(deleteStudyPositions(ids))
        }}
        onRename={(id, name) => {
          setStudies(renameStudyPosition(id, name))
        }}
        onDuplicate={(id) => {
          setStudies(duplicateStudyPosition(id))
        }}
        onExportJson={() => downloadJson('xiangqi-study-positions.json', exportStudyPositionsJson())}
        onImportJson={(file) => {
          file.text()
            .then(text => setStudies(importStudyPositionsJson(text)))
            .catch(() => undefined)
        }}
      />
    )
  }

  return (
    <div className="app">
      <header className="workspace-header">
        <div className="workspace-brand">
          <span className="workspace-brand-mark" aria-hidden="true">象</span>
          <span>
            <strong>棋境</strong>
            <small>PIKAFISH XIANGQI</small>
          </span>
        </div>
        <div className="workspace-context">
          <span>{formatModeName(gameMode)}</span>
          {activeGame?.name && <strong>{activeGame.name}</strong>}
          {gameMode === 'endgame' && selectedEndgame?.name && <strong>{selectedEndgame.name}</strong>}
          {gameMode === 'study' && selectedStudy?.name && <strong>{selectedStudy.name}</strong>}
          <span className={`workspace-turn ${game.currentTurn}`}>
            {game.gameStatus === 'playing' ? `${game.currentTurn === 'red' ? '红方' : '黑方'}走棋` : '棋局结束'}
          </span>
        </div>
      </header>
      <div className="game-container">
        <div className="left-panel">
          <MoveHistory
            moves={game.historyRecords}
            currentIndex={game.currentMoveIndex}
            onJumpTo={game.jumpToMove}
            navigationDisabled={gameMode === 'jieqi'}
            onToggleMark={game.toggleMoveMark}
            onUpdateNote={game.updateMoveNote}
            showOnlyAnnotated={showOnlyAnnotatedMoves}
            onShowOnlyAnnotatedChange={setShowOnlyAnnotatedMoves}
          />
        </div>
        {showAnalysis && gameMode !== 'jieqi' && (
          <AnalysisBar
            evaluation={game.evaluation}
            bestLine={game.bestLine}
            bestLineNotation={game.bestLineNotation}
            depth={game.analysisDepth}
          />
        )}
        <div className="board-stage">
          {activeGame && game.leaseStatus !== 'granted' && (
            <div className="game-access-banner">
              <span>{game.leaseStatus === 'requesting' ? '正在获取编辑权…' : '此对局已在另一个页面编辑，当前为只读模式。'}</span>
              {game.leaseStatus === 'readonly' && <button onClick={game.takeoverGame}>接管编辑</button>}
            </div>
          )}
          {activeGame && game.leaseStatus === 'granted' && gamePersistence.status !== 'saved' && (
            <div className={`game-save-banner ${gamePersistence.status}`}>
              {formatSaveStatus(gamePersistence.status, gamePersistence.error)}
            </div>
          )}
          <Board
            ref={boardRef}
            board={candidatePreviewFrame?.board || game.board}
            gameStatus={game.gameStatus}
            gameStatusReason={game.gameStatusReason}
            selectedPos={candidatePreview ? null : game.selectedPos}
            legalMoves={candidatePreview ? [] : game.legalMoves}
            lastMove={candidatePreviewFrame?.lastMove || game.lastMove}
            hintMove={candidatePreview ? null : game.hintMove}
            inCheck={candidatePreview ? null : game.inCheck}
            flipped={game.flipped}
            aiThinking={candidatePreview ? false : game.aiThinking}
            thinkingText={`${game.currentTurn === 'red' ? '红方' : '黑方'} AI 思考中...`}
            interactionDisabled={Boolean(candidatePreview) || !game.canEditGame}
            onCellClick={game.handleCellClick}
            onCancelSelection={game.cancelSelection}
          />
          {gameMode === 'jieqi' && (
            <JieqiCapturedPieces records={game.moveRecords} viewer={playerSide} />
          )}
          {candidatePreview && candidatePreviewFrame && (
            <CandidatePreviewControls
              candidateLabel={candidatePreview.candidate.notation || candidatePreview.candidate.move}
              notation={candidatePreviewFrame.notation}
              stepIndex={candidatePreview.stepIndex}
              stepCount={candidatePreview.records.length}
              onPrevious={() => setCandidatePreview(current => current ? {
                ...current,
                stepIndex: Math.max(0, current.stepIndex - 1),
              } : null)}
              onNext={() => setCandidatePreview(current => current ? {
                ...current,
                stepIndex: Math.min(current.records.length, current.stepIndex + 1),
              } : null)}
              onClose={() => setCandidatePreview(null)}
            />
          )}
        </div>
        <div className="side-panel">
          <nav className="workspace-tabs" aria-label="棋局工具">
            <button className={workspaceTab === 'play' ? 'active' : ''} onClick={() => setWorkspaceTab('play')}>对局</button>
            {gameMode !== 'jieqi' && <button className={workspaceTab === 'engine' ? 'active' : ''} onClick={() => setWorkspaceTab('engine')}>分析</button>}
            <button className={workspaceTab === 'review' ? 'active' : ''} onClick={() => setWorkspaceTab('review')}>
              复盘{moveReviews.length > 0 ? <span>{moveReviews.length}</span> : null}
            </button>
            {gameMode !== 'jieqi' && <button className={workspaceTab === 'variations' ? 'active' : ''} onClick={() => setWorkspaceTab('variations')}>
              变招{game.variationBranchCount > 0 ? <span>{game.variationBranchCount}</span> : null}
            </button>}
          </nav>
          <div className="workspace-tool-content">
          {workspaceTab === 'play' && <GamePanel
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
            scenarioName={gameMode === 'endgame' ? selectedEndgame?.name ?? null : gameMode === 'study' ? selectedStudy?.name ?? null : null}
            studySaveStatus={gameMode === 'study' ? studySaveStatus : null}
            trainingFeedback={trainingFeedback}
            trainingHint={trainingHint}
            trainingHintHistory={trainingHintHistoryText}
            naturalLimitReminder={naturalLimitReminder}
            repetitionReminder={repetitionReminder}
            canRequestTrainingHint={canRequestTrainingHint}
            aiThinking={game.aiThinking}
            connectionState={game.connectionState}
            engineAvailable={game.engineAvailable}
            engineStatusMessage={game.engineStatusMessage}
            aiAutoPlaying={aiAutoPlaying}
            aiAutoDelay={aiAutoDelay}
            studyAutoPlaying={studyAutoPlaying}
            studyReplayDelay={studyReplayDelay}
            canStudyReplay={gameMode === 'study' && game.canRedo}
            canJumpToPrevMarked={gameMode === 'study' && findPrevMarkedIndex(game.historyRecords, game.currentMoveIndex) !== null}
            canJumpToNextMarked={gameMode === 'study' && findNextMarkedIndex(game.historyRecords, game.currentMoveIndex) !== null}
            onNewGame={async () => {
              setAiAutoPlaying(false)
              setStudyAutoPlaying(false)
              if (activeGame) {
                const saved = await gamePersistence.flush(liveGameState)
                if (!saved && !window.confirm('当前对局尚未成功保存，仍要返回对局列表吗？')) return
              }
              if (gameMode === 'endgame') {
                setSelectedEndgame(null)
                setEditingEndgame(false)
              } else if (gameMode === 'study') {
                setSelectedStudy(null)
              } else {
                setActiveGame(null)
                setInitialLiveState(null)
                clearGameUrl()
                void refreshSavedGames()
                setGameMode(null)
              }
            }}
            onUndo={game.undo}
            onRedo={game.redo}
            onFlip={game.flip}
            onToggleAnalysis={() => {
              setShowAnalysis(!showAnalysis)
              if (!showAnalysis) setWorkspaceTab('engine')
            }}
            onExportFen={() => setShowFenDialog('export')}
            onImportFen={() => setShowFenDialog('import')}
            onCopyMoveText={() => {
              navigator.clipboard.writeText(formatMoveRecords(game.moveRecords))
            }}
            onCopyReplayLink={() => {
              navigator.clipboard.writeText(createReplayUrl(window.location.href, game.initialFen, game.historyRecords, game.currentMoveIndex))
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
                tags: gameMode === 'endgame' && selectedEndgame ? selectedEndgame.tags || [] : [],
                target: gameMode === 'endgame' ? selectedEndgame?.target : undefined,
                maxMoves: gameMode === 'endgame' ? selectedEndgame?.maxMoves : undefined,
                solution: gameMode === 'endgame' ? selectedEndgame?.solution || [] : [],
              })
              setEditingEndgame(true)
            }}
            onSaveStudy={() => {
              const defaultName = selectedStudy?.name || scenarioNameFromState(gameMode, selectedEndgame).replace('-副本', '') || '研究局面'
              const name = window.prompt('研究名称', defaultName)
              if (!name?.trim()) return
              const description = window.prompt('研究说明', selectedStudy?.description || '') || ''
              const existingStudyId = selectedStudy?.id
              const saved = saveStudyPosition({
                id: existingStudyId,
                name: name.trim(),
                description: description.trim() || undefined,
                initialFen: game.initialFen,
                moves: game.historyRecords,
                currentMoveIndex: game.currentMoveIndex,
                analysisPoints: game.analysisPoints,
                variationTree: game.variationTree,
              })
              setStudies(saved)
              setSelectedStudy(existingStudyId
                ? saved.find(item => item.id === existingStudyId) || saved[0] || null
                : saved[0] || null)
            }}
            onExportImage={async () => {
              const dataUrl = boardRef.current?.exportPng()
              if (dataUrl) {
                const metadata = buildBoardExportMetadata({
                  fen: game.getCurrentFen(),
                  currentTurn: game.currentTurn,
                  scenarioName: gameMode === 'endgame' ? selectedEndgame?.name ?? null : gameMode === 'study' ? selectedStudy?.name ?? null : null,
                  gameMode,
                })
                const annotated = await createAnnotatedBoardPng(dataUrl, metadata)
                downloadDataUrl(metadata.filename, annotated)
              }
            }}
            onTrainingHint={() => {
              const nextLevel = Math.min(3, trainingHintLevel + 1)
              const hint = getEndgameTrainingHint(selectedEndgame, game.moveRecords, game.board, nextLevel)
              setTrainingHintLevel(nextLevel)
              setTrainingHintHistory(history => recordTrainingHintLevel(history, game.currentMoveIndex, nextLevel, hint, game.getCurrentFen()))
            }}
            onHint={game.requestHint}
            onNextAiMove={game.nextAiMove}
            onDeclareDraw={game.declareDraw}
            onResign={game.resign}
            onToggleAiAutoPlay={() => setAiAutoPlaying(value => !value)}
            onAiAutoDelayChange={setAiAutoDelay}
            onToggleStudyAutoPlay={() => setStudyAutoPlaying(value => !value)}
            onStudyReplayDelayChange={setStudyReplayDelay}
            onJumpToPrevMarked={() => {
              const index = findPrevMarkedIndex(game.historyRecords, game.currentMoveIndex)
              if (index !== null) game.jumpToMove(index)
            }}
            onJumpToNextMarked={() => {
              const index = findNextMarkedIndex(game.historyRecords, game.currentMoveIndex)
              if (index !== null) game.jumpToMove(index)
            }}
            canUndo={game.canUndo}
            canRedo={game.canRedo}
            canRequestHint={game.canRequestHint}
            canStepAi={game.canStepAi}
            hintThinking={game.hintThinking}
          />}
          {gameMode !== 'jieqi' && workspaceTab === 'engine' && <CandidateList
            candidates={game.moveCandidates}
            selectedCandidateMove={candidatePreview?.candidate.move}
            onPreview={(candidate) => {
              try {
                const records = buildCandidatePreview(candidateAutoPositionKey, candidate)
                setCandidatePreview({ candidate, records, stepIndex: Math.min(1, records.length) })
              } catch {
                window.alert('当前候选变化无法在棋盘上预览。')
              }
            }}
            thinking={game.candidateThinking}
            onRequest={() => {
              setCandidatePreview(null)
              game.requestCandidates()
            }}
            canRequest={game.canRequestCandidates}
            autoRefresh={candidateAutoRefresh}
            onAutoRefreshChange={setCandidateAutoRefresh}
            candidateCount={engineSettings.candidateCount}
            onCandidateCountChange={(candidateCount) => {
              setEngineSettings(current => saveEngineSettings({ ...current, candidateCount }))
            }}
            autoRefreshDelay={engineSettings.candidateAutoRefreshDelay}
            onAutoRefreshDelayChange={(candidateAutoRefreshDelay) => {
              setEngineSettings(current => saveEngineSettings({ ...current, candidateAutoRefreshDelay }))
            }}
            hintDifficulty={engineSettings.hintDifficulty}
            onHintDifficultyChange={(hintDifficulty) => {
              setEngineSettings(current => saveEngineSettings({ ...current, hintDifficulty }))
            }}
            searchMode={engineSettings.searchMode}
            onSearchModeChange={(searchMode) => {
              setEngineSettings(current => saveEngineSettings({ ...current, searchMode }))
            }}
            searchDepth={engineSettings.searchDepth}
            onSearchDepthChange={(searchDepth) => {
              setEngineSettings(current => saveEngineSettings({ ...current, searchDepth }))
            }}
            searchTimeMs={engineSettings.searchTimeMs}
            onSearchTimeMsChange={(searchTimeMs) => {
              setEngineSettings(current => saveEngineSettings({ ...current, searchTimeMs }))
            }}
            engineThreads={engineSettings.engineThreads}
            onEngineThreadsChange={(engineThreads) => {
              setEngineSettings(current => saveEngineSettings({ ...current, engineThreads }))
            }}
            engineHashMb={engineSettings.engineHashMb}
            onEngineHashMbChange={(engineHashMb) => {
              setEngineSettings(current => saveEngineSettings({ ...current, engineHashMb }))
            }}
          />}
          {workspaceTab === 'review' && <ReviewPanel
            moveCount={game.historyRecords.length}
            reviews={moveReviews}
            thinking={game.reviewThinking}
            progress={game.reviewProgress}
            canRequest={game.canRequestReview}
            onRequest={() => {
              setCandidatePreview(null)
              game.requestReview()
            }}
            onCancel={game.cancelReview}
            onJumpToPosition={game.jumpToMove}
          />}
          {gameMode !== 'jieqi' && workspaceTab === 'variations' && <VariationPanel
            children={game.variationChildren}
            mainChildId={game.mainVariationChildId}
            branchCount={game.variationBranchCount}
            onSelect={game.selectVariation}
            onSetMain={game.setMainVariationChild}
          />}
          {gameMode !== 'jieqi' && workspaceTab === 'engine' && showAnalysis && <AnalysisCurve points={game.analysisPoints} />}
          </div>
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

function isLiveGameMode(mode: GameMode | null): mode is LiveGameMode {
  return mode === 'human-vs-ai' || mode === 'human-vs-human' || mode === 'ai-vs-ai' || mode === 'jieqi'
}

function toGameSummary(game: GameDocument): GameSummary {
  return {
    id: game.id,
    revision: game.revision,
    name: game.name,
    mode: game.mode,
    config: game.config,
    status: game.state.gameStatus,
    moveCount: game.state.currentMoveIndex + 1,
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
  }
}

function formatSaveStatus(status: GameSaveStatus, error: string): string {
  if (status === 'dirty') return '有未保存的变更'
  if (status === 'saving') return '正在保存…'
  if (status === 'conflict') return `保存冲突，请返回对局列表后重新打开。${error ? ` ${error}` : ''}`
  if (status === 'error') return `保存失败，将保留当前页面内容。${error ? ` ${error}` : ''}`
  return ''
}

function scenarioNameFromState(gameMode: GameMode, selectedEndgame: EndgameDefinition | null): string {
  if (gameMode === 'endgame' && selectedEndgame) {
    return `${selectedEndgame.name}-副本`
  }
  return '自定义残局'
}

function formatModeName(gameMode: GameMode): string {
  if (gameMode === 'human-vs-ai') return '人机对弈'
  if (gameMode === 'human-vs-human') return '双人对弈'
  if (gameMode === 'ai-vs-ai') return 'AI 对战'
  if (gameMode === 'jieqi') return '揭棋对弈'
  if (gameMode === 'endgame') return '残局训练'
  return '研究局面'
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

function findPrevMarkedIndex(records: MoveRecord[], currentIndex: number): number | null {
  for (let i = Math.min(currentIndex - 1, records.length - 1); i >= 0; i--) {
    if (records[i].marked) return i
  }
  return null
}

function findNextMarkedIndex(records: MoveRecord[], currentIndex: number): number | null {
  for (let i = Math.max(currentIndex + 1, 0); i < records.length; i++) {
    if (records[i].marked) return i
  }
  return null
}

function downloadJson(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function downloadDataUrl(filename: string, dataUrl: string) {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  link.click()
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

function StartScreen({ games, loading, storeError, starting, onRetry, onOpen, onRename, onDelete, onImport, onStart }: {
  games: GameSummary[]
  loading: boolean
  storeError: string
  starting: boolean
  onRetry: () => void
  onOpen: (id: string) => void
  onRename: (game: GameSummary, name: string) => void
  onDelete: (game: GameSummary) => void
  onImport: (file: File) => void
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
        <section className="start-hero">
          <div className="start-seal" aria-hidden="true">弈</div>
          <div className="start-eyebrow">PIKAFISH XIANGQI</div>
          <h1>中国象棋</h1>
          <p className="subtitle">一方棋盘，认真走好每一步。</p>
          <div className="start-engine-note">
            <span>本地 Pikafish</span>
            <span>多级 AI</span>
            <span>研究与复盘</span>
          </div>
          <a className="start-home-link" href="?type=xiangqi">← 返回模式选择</a>
        </section>

        <section className="start-config">
        <div className="start-config-heading">
          <span>新对局</span>
          <small>选择模式后开始</small>
        </div>

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
              className={mode === 'jieqi' ? 'active' : ''}
              onClick={() => setMode('jieqi')}
            >揭棋</button>
            <button
              className={mode === 'endgame' ? 'active' : ''}
              onClick={() => setMode('endgame')}
            >残局模式</button>
            <button
              className={mode === 'study' ? 'active' : ''}
              onClick={() => setMode('study')}
            >研究局面</button>
          </div>
        </div>

        {(mode === 'human-vs-ai' || mode === 'jieqi') && (
          <>
            {mode === 'jieqi' && (
              <div className="jieqi-mode-note">
                除将帅外随机盖棋。暗子先按原位置棋种行走，移动后翻开真实身份。
              </div>
            )}
            <div className="option-group">
              <label>难度等级</label>
              <div className="btn-group">
                <button className={diff === 'easy' ? 'active' : ''} onClick={() => setDiff('easy')}>初级 · D8</button>
                <button className={diff === 'medium' ? 'active' : ''} onClick={() => setDiff('medium')}>中级 · D14</button>
                <button className={diff === 'hard' ? 'active' : ''} onClick={() => setDiff('hard')}>高级 · D20</button>
                <button className={diff === 'master' ? 'active' : ''} onClick={() => setDiff('master')}>大师 · D26</button>
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
                <button className={redDiff === 'easy' ? 'active' : ''} onClick={() => setRedDiff('easy')}>初级 · D8</button>
                <button className={redDiff === 'medium' ? 'active' : ''} onClick={() => setRedDiff('medium')}>中级 · D14</button>
                <button className={redDiff === 'hard' ? 'active' : ''} onClick={() => setRedDiff('hard')}>高级 · D20</button>
                <button className={redDiff === 'master' ? 'active' : ''} onClick={() => setRedDiff('master')}>大师 · D26</button>
              </div>
            </div>
            <div className="option-group">
              <label>黑方强度</label>
              <div className="btn-group">
                <button className={blackDiff === 'easy' ? 'active' : ''} onClick={() => setBlackDiff('easy')}>初级 · D8</button>
                <button className={blackDiff === 'medium' ? 'active' : ''} onClick={() => setBlackDiff('medium')}>中级 · D14</button>
                <button className={blackDiff === 'hard' ? 'active' : ''} onClick={() => setBlackDiff('hard')}>高级 · D20</button>
                <button className={blackDiff === 'master' ? 'active' : ''} onClick={() => setBlackDiff('master')}>大师 · D26</button>
              </div>
            </div>
          </>
        )}

        <button className="start-btn" disabled={starting} onClick={() => onStart(mode, diff, side, redDiff, blackDiff)}>
          {starting ? '正在创建…' : '开始游戏'}
        </button>

        <div className="saved-games-section">
          <div className="saved-games-heading">
            <span>最近对局</span>
            <div>
              <a href={gameExportUrl()} download="xiangqi-games.json">导出全部</a>
              <label className="saved-games-import">
                导入
                <input type="file" accept="application/json,.json" onChange={event => {
                  const file = event.target.files?.[0]
                  if (file) onImport(file)
                  event.target.value = ''
                }} />
              </label>
            </div>
          </div>
          {storeError && <div className="saved-games-error">{storeError} <button onClick={onRetry}>重试</button></div>}
          {loading ? <div className="saved-games-empty">正在读取…</div> : games.length === 0 ? (
            <div className="saved-games-empty">还没有保存的对局</div>
          ) : (
            <div className="saved-games-list">
              {games.slice(0, 8).map(item => (
                <div className="saved-game-item" key={item.id}>
                  <button className="saved-game-open" onClick={() => onOpen(item.id)}>
                    <strong>{item.name}</strong>
                    <span>{formatModeName(item.mode)} · {item.moveCount} 回合 · {new Date(item.updatedAt).toLocaleString()}</span>
                  </button>
                  <button title="重命名" onClick={() => {
                    const name = window.prompt('对局名称', item.name)
                    if (name?.trim() && name.trim() !== item.name) onRename(item, name.trim())
                  }}>改名</button>
                  <button title="删除" onClick={() => {
                    if (window.confirm(`确定删除“${item.name}”吗？`)) onDelete(item)
                  }}>删除</button>
                </div>
              ))}
            </div>
          )}
        </div>
        </section>
      </div>
    </div>
  )
}
