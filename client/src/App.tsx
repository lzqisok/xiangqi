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
import AnnotationPanel from './components/AnnotationPanel'
import StudyLibrary from './components/StudyLibrary'
import ProductDialog, { ProductDialogRequest } from './components/ProductDialog'
import MobileStageBar from './components/MobileStageBar'
import ProductState from './components/ProductState'
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
import { createBoardAnnotation } from './annotations/model'
import { createStudyContentSignature, createStudySaveInput } from './studies/autosave'
import { createGame, deleteGame, gameExportUrl, importGames, listGames, loadGame, renameGame } from './games/api'
import { clearGameUrl, createInitialPersistedState, gameUrl } from './games/state'
import { GameSaveStatus, useGamePersistence } from './games/useGamePersistence'
import { BoardAnnotationColor, BoardAnnotationType, EndgameDefinition, EndgameStartConfig, EndgameTarget, GameDocument, GameMode, Difficulty, GameSummary, LiveGameMode, MoveCandidate, MoveRecord, PersistedGameConfig, PersistedGameState, PlayerSide, StudyPosition } from './types'
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

type WorkspaceTab = 'play' | 'history' | 'engine' | 'review' | 'variations' | 'annotations'
type StartSection = 'play' | 'study'
type LocalOpponent = 'human-vs-ai' | 'human-vs-human' | 'ai-vs-ai'
type XiangqiRule = 'xiangqi' | 'jieqi'

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
  const [latestGame, setLatestGame] = useState<GameSummary | null>(null)

  useEffect(() => {
    let active = true
    listGames()
      .then(games => {
        if (active) setLatestGame(games[0] || null)
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [])

  return <main className="home-screen">
    <section className="home-card">
      <div className="home-brand"><span aria-hidden="true">弈</span><div><small>BOARD GAME STUDIO</small><h1>棋局空间</h1><p>开始对局、和朋友下，或继续你的研究</p></div></div>
      {latestGame && <a className="home-continue" href={gameUrl(latestGame.id)}>
        <span>继续上次象棋对局</span>
        <strong>{latestGame.name}</strong>
        <small>{formatModeName(latestGame.mode)} · {latestGame.moveCount} 回合</small>
        <b>继续 →</b>
      </a>}
      <nav className="home-entries" aria-label="游戏入口">
        <a href="?type=xiangqi"><span className="home-entry-mark">象</span><strong>中国象棋</strong><small>普通象棋、揭棋、人机对弈、残局训练与局域网对战</small><b>进入象棋 →</b></a>
        <a href="?type=gomoku"><span className="home-entry-mark gomoku">五</span><strong>五子棋</strong><small>标准与有禁手规则，本地练习、AI 对决和局域网房间</small><b>进入五子棋 →</b></a>
      </nav>
    </section>
  </main>
}

function GameModeScreen({ game }: { game: 'xiangqi' | 'gomoku' }) {
  const gomoku = game === 'gomoku'
  return <main className="home-screen game-console-screen"><section className="home-card game-console-card">
    <div className="home-brand"><span className={gomoku ? 'gomoku' : ''} aria-hidden="true">{gomoku ? '五' : '象'}</span><div><small>{gomoku ? 'GOMOKU' : 'XIANGQI'} STUDIO</small><h1>{gomoku ? '五子棋' : '中国象棋'}</h1><p>今天想怎么下？</p></div></div>
    <nav className="home-entries game-goal-entries" aria-label="棋局目标">
      <a href={gomoku ? '?gomoku=1&local=1' : '?local=1&intent=play'}><span className="home-entry-mark">弈</span><strong>开始一局</strong><small>{gomoku ? '人机挑战、本地双人或观看 AI 对决' : '选择对手、规则、执子方和 AI 强度'}</small><b>配置新对局 →</b></a>
      <a href={gomoku ? '?gomoku=1&lan=1' : '?lan=1'}><span className="home-entry-mark online">友</span><strong>局域网对战</strong><small>创建局域网房间、邀请棋友、实时聊天与观战</small><b>进入局域网大厅 →</b></a>
      <a href={gomoku ? '?gomoku=1&local=1&history=1' : '?local=1&intent=study'}><span className="home-entry-mark study">研</span><strong>训练与研究</strong><small>{gomoku ? '打开历史棋局并查看局后复盘' : '进入残局训练、研究局面与棋谱回放'}</small><b>{gomoku ? '查看对局记录 →' : '打开训练中心 →'}</b></a>
    </nav>
    <a className="home-back-link" href="?">← 返回棋局空间</a>
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
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false)
  const [annotationTool, setAnnotationTool] = useState<BoardAnnotationType | null>(null)
  const [annotationColor, setAnnotationColor] = useState<BoardAnnotationColor>('red')
  const [studySaveStatus, setStudySaveStatus] = useState<'saved' | 'unsaved' | 'shared' | null>(null)
  const [engineSettings, setEngineSettings] = useState<EngineSettings>(() => loadEngineSettings())
  const [trainingHintLevel, setTrainingHintLevel] = useState(0)
  const [trainingHintHistory, setTrainingHintHistory] = useState<TrainingHintHistoryEntry[]>([])
  const [productDialog, setProductDialog] = useState<ProductDialogRequest | null>(null)
  const [toastMessage, setToastMessage] = useState('')
  const candidateAutoRequestRef = useRef<string | null>(null)
  const historyNavigationRef = useRef(false)
  const dialogResolveRef = useRef<((values: Record<string, string> | null) => void) | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const jieqiOnboardingShownRef = useRef(false)
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

  const requestProductDialog = useCallback((request: ProductDialogRequest) => new Promise<Record<string, string> | null>(resolve => {
    dialogResolveRef.current?.(null)
    dialogResolveRef.current = resolve
    setProductDialog(request)
  }), [])

  const closeProductDialog = useCallback((values: Record<string, string> | null) => {
    const resolve = dialogResolveRef.current
    dialogResolveRef.current = null
    setProductDialog(null)
    resolve?.(values)
  }, [])

  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    setToastMessage(message)
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage('')
      toastTimerRef.current = null
    }, 2200)
  }, [])

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
      void requestProductDialog({
        title: '回放链接无法打开',
        description: initialReplay.error,
        confirmLabel: '知道了',
        cancelLabel: null,
      })
    }
  }, [initialReplay, requestProductDialog])

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    dialogResolveRef.current?.(null)
  }, [])

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
          if (!saved) {
            const confirmed = await requestProductDialog({
              title: '当前对局尚未保存',
              description: '继续离开可能丢失尚未写入的走棋。你可以取消并稍后重试保存。',
              confirmLabel: '仍要离开',
              dangerous: true,
            })
            if (!confirmed) {
              window.history.pushState(null, '', gameUrl(activeGame.id))
              return
            }
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
  }, [activeGame, gamePersistence.flush, liveGameState, openGame, requestProductDialog])

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
  const gameFinished = game.gameStatus !== 'playing'
  const showReviewTab = gameFinished || moveReviews.length > 0 || game.reviewThinking
  const showVariationsTab = gameMode !== 'jieqi' && (
    gameMode === 'study' || gameFinished || game.variationBranchCount > 0
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
  const selectWorkspaceTab = (tab: WorkspaceTab) => {
    setWorkspaceTab(tab)
    if (tab !== 'annotations') setAnnotationTool(null)
    setMobileToolsOpen(true)
  }

  useEffect(() => {
    if (gameMode !== 'jieqi') return
    setShowAnalysis(false)
    setCandidateAutoRefresh(false)
    setCandidatePreview(null)
    if (workspaceTab === 'engine' || workspaceTab === 'variations') setWorkspaceTab('play')
  }, [gameMode, workspaceTab])

  useEffect(() => {
    if (gameMode !== 'jieqi' || jieqiOnboardingShownRef.current) return
    jieqiOnboardingShownRef.current = true
    const storageKey = 'xiangqi-jieqi-onboarding-v1'
    if (window.localStorage.getItem(storageKey)) return
    void requestProductDialog({
      title: '第一次玩揭棋？',
      description: '记住三个动作，就可以安全开始第一局。',
      steps: [
        { mark: '走', title: '按原位走法', description: '暗子先按所在位置对应的棋种移动。' },
        { mark: '翻', title: '落子后揭晓', description: '暗子完成移动后，公开真实身份。' },
        { mark: '隐', title: '暗吃信息私有', description: '被暗吃棋子的身份只对捕获方可见。' },
      ],
      confirmLabel: '明白了，开始对局',
      cancelLabel: null,
    }).then(() => window.localStorage.setItem(storageKey, 'seen'))
  }, [gameMode, requestProductDialog])

  useEffect(() => {
    if (workspaceTab === 'review' && !showReviewTab) setWorkspaceTab('play')
    if (workspaceTab === 'variations' && !showVariationsTab) setWorkspaceTab('play')
    if (workspaceTab === 'annotations' && gameMode !== 'study') setWorkspaceTab('play')
  }, [gameMode, showReviewTab, showVariationsTab, workspaceTab])

  useEffect(() => {
    if (gameMode !== 'study') setAnnotationTool(null)
  }, [gameMode])

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

  const handleNewGame = async () => {
    setAiAutoPlaying(false)
    setStudyAutoPlaying(false)
    if (activeGame) {
      const saved = await gamePersistence.flush(liveGameState)
      if (!saved) {
        const confirmed = await requestProductDialog({
          title: '当前对局尚未保存',
          description: '返回对局列表可能丢失尚未写入的走棋。',
          confirmLabel: '仍要返回',
          dangerous: true,
        })
        if (!confirmed) return
      }
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
  }

  if (!gameMode) {
    return <>
    <StartScreen
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
          const confirmed = await requestProductDialog({
            title: '对局无法保存',
            description: `${message}\n\n可以改为临时对局继续，刷新页面后这盘棋不会保留。`,
            confirmLabel: '开始临时对局',
            dangerous: true,
          })
          if (confirmed) {
            clearGameUrl()
            begin(state, null)
          }
        } finally {
          setStartingGame(false)
        }
      }}
    />
    {productDialog && <ProductDialog
      {...productDialog}
      onCancel={() => closeProductDialog(null)}
      onConfirm={values => closeProductDialog(values)}
    />}
    </>
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
        <div className="workspace-header-actions">
          <div className="workspace-context">
            <span>{formatModeName(gameMode)}</span>
            {activeGame?.name && <strong>{activeGame.name}</strong>}
            {gameMode === 'endgame' && selectedEndgame?.name && <strong>{selectedEndgame.name}</strong>}
            {gameMode === 'study' && selectedStudy?.name && <strong>{selectedStudy.name}</strong>}
            <span className={`workspace-turn ${game.currentTurn}`}>
              {game.gameStatus === 'playing' ? `${game.currentTurn === 'red' ? '红方' : '黑方'}走棋` : '棋局结束'}
            </span>
          </div>
          <span className={`workspace-save-state ${activeGame ? gamePersistence.status : studySaveStatus || 'saved'}`}>
            {activeGame
              ? gamePersistence.status === 'saved' || gamePersistence.status === 'idle' ? '已保存' : formatSaveStatus(gamePersistence.status, gamePersistence.error)
              : gameMode === 'study' && studySaveStatus === 'unsaved' ? '等待自动保存' : gameMode === 'study' && studySaveStatus === 'shared' ? '分享回放未保存' : '本局无需保存'}
          </span>
          <button className="workspace-new-game" onClick={() => void handleNewGame()}>新对局</button>
        </div>
      </header>
      <div className="game-container">
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
            annotations={candidatePreview ? [] : game.currentNodeAnnotations}
            annotationTool={gameMode === 'study' && annotationTool ? { type: annotationTool, color: annotationColor } : null}
            onAnnotationCreate={(type, color, from, to) => {
              const annotation = createBoardAnnotation(type, color, from, to)
              if (annotation) game.addCurrentNodeAnnotation(annotation)
            }}
            onCellClick={game.handleCellClick}
            onCancelSelection={game.cancelSelection}
          />
          {gameMode === 'study' && annotationTool && <div className="board-annotation-mode" role="status">
            <span>{annotationColor === 'red' ? '红色' : annotationColor === 'green' ? '绿色' : '蓝色'}{annotationTool === 'arrow' ? '箭头' : '圈点'}标注中</span>
            <button onClick={() => setAnnotationTool(null)}>退出标注</button>
          </div>}
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
        <div className={`side-panel ${mobileToolsOpen ? 'mobile-tools-open' : ''}`}>
          <nav className="workspace-tabs" aria-label="棋局工具">
            <button className={workspaceTab === 'play' ? 'active' : ''} onClick={() => selectWorkspaceTab('play')}>{gameFinished ? '结果' : '对局'}</button>
            <button className={workspaceTab === 'history' ? 'active' : ''} onClick={() => selectWorkspaceTab('history')}>棋谱{game.historyRecords.length > 0 ? <span>{game.historyRecords.length}</span> : null}</button>
            {gameMode !== 'jieqi' && <button className={workspaceTab === 'engine' ? 'active' : ''} onClick={() => selectWorkspaceTab('engine')}>分析</button>}
            {showReviewTab && <button className={workspaceTab === 'review' ? 'active' : ''} onClick={() => selectWorkspaceTab('review')}>
              复盘{moveReviews.length > 0 ? <span>{moveReviews.length}</span> : null}
            </button>}
            {showVariationsTab && <button className={workspaceTab === 'variations' ? 'active' : ''} onClick={() => selectWorkspaceTab('variations')}>
              变招{game.variationBranchCount > 0 ? <span>{game.variationBranchCount}</span> : null}
            </button>}
            {gameMode === 'study' && <button className={workspaceTab === 'annotations' ? 'active' : ''} onClick={() => selectWorkspaceTab('annotations')}>
              标注{game.currentNodeAnnotations.length > 0 ? <span>{game.currentNodeAnnotations.length}</span> : null}
            </button>}
          </nav>
          <div className="workspace-tool-content">
          <button className="mobile-tool-close" onClick={() => setMobileToolsOpen(false)} aria-label="收起阶段工具">收起</button>
          {workspaceTab === 'history' && <MoveHistory
            moves={game.historyRecords}
            currentIndex={game.currentMoveIndex}
            onJumpTo={game.jumpToMove}
            navigationDisabled={gameMode === 'jieqi'}
            onToggleMark={game.toggleMoveMark}
            onUpdateNote={game.updateMoveNote}
            showOnlyAnnotated={showOnlyAnnotatedMoves}
            onShowOnlyAnnotatedChange={setShowOnlyAnnotatedMoves}
          />}
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
            onOpenReview={() => setWorkspaceTab('review')}
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
              void navigator.clipboard.writeText(formatMoveRecords(game.moveRecords))
                .then(() => showToast('棋谱已复制'))
                .catch(() => requestProductDialog({ title: '复制失败', description: '浏览器没有授予剪贴板权限，请稍后重试。', confirmLabel: '知道了', cancelLabel: null }))
            }}
            onCopyReplayLink={() => {
              void navigator.clipboard.writeText(createReplayUrl(window.location.href, game.initialFen, game.historyRecords, game.currentMoveIndex))
                .then(() => showToast('回放链接已复制'))
                .catch(() => requestProductDialog({ title: '复制失败', description: '浏览器没有授予剪贴板权限，请稍后重试。', confirmLabel: '知道了', cancelLabel: null }))
            }}
            onSaveRecentFen={() => {
              setRecentFenPositions(saveRecentFenPosition(game.getCurrentFen(), '手动保存'))
              showToast('当前局面已保存')
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
            onSaveStudy={async () => {
              const defaultName = selectedStudy?.name || scenarioNameFromState(gameMode, selectedEndgame).replace('-副本', '') || '研究局面'
              const values = await requestProductDialog({
                title: '保存研究',
                description: '保存当前局面、走法、标记、备注与分析数据。',
                confirmLabel: '保存',
                fields: [
                  { name: 'name', label: '研究名称', initialValue: defaultName, required: true, maxLength: 80 },
                  { name: 'description', label: '研究说明', initialValue: selectedStudy?.description || '', multiline: true, maxLength: 300 },
                ],
              })
              if (!values) return
              const existingStudyId = selectedStudy?.id
              const saved = saveStudyPosition({
                id: existingStudyId,
                name: values.name.trim(),
                description: values.description.trim() || undefined,
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
              showToast('研究已保存')
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
            onDeclareDraw={async () => {
              const confirmed = await requestProductDialog({ title: '确认和棋', description: '这盘棋将立即按双方议和结束。', confirmLabel: '确认和棋' })
              if (confirmed) game.declareDraw()
            }}
            onResign={async () => {
              const confirmed = await requestProductDialog({ title: '确认认输', description: `当前${game.currentTurn === 'red' ? '红方' : '黑方'}将认输并结束棋局。`, confirmLabel: '确认认输', dangerous: true })
              if (confirmed) game.resign()
            }}
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
                void requestProductDialog({ title: '无法预览候选变化', description: '当前引擎返回的变化无法从这个局面复现。', confirmLabel: '知道了', cancelLabel: null })
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
          {gameMode === 'study' && workspaceTab === 'annotations' && <AnnotationPanel
            annotations={game.currentNodeAnnotations}
            tool={annotationTool}
            color={annotationColor}
            onToolChange={setAnnotationTool}
            onColorChange={setAnnotationColor}
            onRemove={game.removeCurrentNodeAnnotation}
            onUndo={game.undoCurrentNodeAnnotation}
            onClear={game.clearCurrentNodeAnnotations}
          />}
          {gameMode !== 'jieqi' && workspaceTab === 'engine' && showAnalysis && <AnalysisCurve points={game.analysisPoints} />}
          </div>
        </div>
      </div>
      <MobileStageBar
        items={[
          { id: 'play', label: gameFinished ? '结果' : '对局' },
          { id: 'history', label: '棋谱', badge: game.historyRecords.length },
          { id: 'engine', label: '分析', available: gameMode !== 'jieqi' },
          { id: 'review', label: '复盘', badge: moveReviews.length, available: showReviewTab },
          { id: 'variations', label: '变招', badge: game.variationBranchCount, available: showVariationsTab },
          { id: 'annotations', label: '标注', badge: game.currentNodeAnnotations.length, available: gameMode === 'study' },
        ]}
        active={workspaceTab}
        open={mobileToolsOpen}
        onSelect={selectWorkspaceTab}
        onClose={() => setMobileToolsOpen(false)}
      />

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
      {toastMessage && <div className="product-toast" role="status">{toastMessage}</div>}
      {productDialog && <ProductDialog
        {...productDialog}
        onCancel={() => closeProductDialog(null)}
        onConfirm={values => closeProductDialog(values)}
      />}
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
  const [section, setSection] = useState<StartSection>(() => (
    new URLSearchParams(window.location.search).get('intent') === 'study' ? 'study' : 'play'
  ))
  const [opponent, setOpponent] = useState<LocalOpponent>('human-vs-ai')
  const [rule, setRule] = useState<XiangqiRule>('xiangqi')
  const [studyMode, setStudyMode] = useState<'endgame' | 'study'>('endgame')
  const [diff, setDiff] = useState<Difficulty>('medium')
  const [side, setSide] = useState<PlayerSide>('red')
  const [redDiff, setRedDiff] = useState<Difficulty>('medium')
  const [blackDiff, setBlackDiff] = useState<Difficulty>('medium')
  const [editingGame, setEditingGame] = useState<GameSummary | null>(null)
  const [deletingGame, setDeletingGame] = useState<GameSummary | null>(null)
  const mode: GameMode = section === 'study'
    ? studyMode
    : rule === 'jieqi' ? 'jieqi' : opponent

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
          <a className="start-home-link" href="?type=xiangqi">← 返回象棋控制台</a>
        </section>

        <section className="start-config">
        <div className="start-config-heading">
          <span>{section === 'play' ? '开始一局' : '训练与研究'}</span>
          <small>{section === 'play' ? '按目标配置本局' : '选择要打开的内容'}</small>
        </div>

        <div className="start-section-switch" aria-label="象棋目标">
          <button className={section === 'play' ? 'active' : ''} onClick={() => setSection('play')}><strong>开始一局</strong><span>人机、本地双人或 AI 对决</span></button>
          <button className={section === 'study' ? 'active' : ''} onClick={() => setSection('study')}><strong>训练与研究</strong><span>残局训练、研究局面与回放</span></button>
        </div>

        {section === 'play' ? <>
          <div className="option-group mode-option-group">
            <label>选择对手</label>
            <div className="btn-group opponent-btn-group">
              <button className={opponent === 'human-vs-ai' ? 'active' : ''} onClick={() => setOpponent('human-vs-ai')}>挑战 AI</button>
              <button className={opponent === 'human-vs-human' ? 'active' : ''} onClick={() => { setOpponent('human-vs-human'); setRule('xiangqi') }}>本地双人</button>
              <button className={opponent === 'ai-vs-ai' ? 'active' : ''} onClick={() => { setOpponent('ai-vs-ai'); setRule('xiangqi') }}>AI 对决</button>
            </div>
          </div>
          <div className="option-group rule-option-group">
            <label>选择规则</label>
            <div className="rule-choice-grid">
              <button className={rule === 'xiangqi' ? 'active' : ''} onClick={() => setRule('xiangqi')}><strong>普通象棋</strong><span>完整支持全部对手类型和分析工具</span></button>
              <button className={rule === 'jieqi' ? 'active' : ''} onClick={() => { setRule('jieqi'); setOpponent('human-vs-ai') }}><strong>揭棋</strong><span>暗子移动后揭晓，当前支持人机对弈</span></button>
            </div>
          </div>
        </> : <div className="option-group study-choice-group">
          <label>选择内容</label>
          <div className="study-choice-grid">
            <button className={studyMode === 'endgame' ? 'active' : ''} onClick={() => setStudyMode('endgame')}><strong>残局训练</strong><span>从内置或自定义残局开始，使用分层提示练习</span></button>
            <button className={studyMode === 'study' ? 'active' : ''} onClick={() => setStudyMode('study')}><strong>研究局面</strong><span>打开已保存研究、棋谱回放和变招树</span></button>
          </div>
        </div>}

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
          {starting ? '正在创建…' : section === 'study' ? studyMode === 'endgame' ? '选择残局' : '打开研究库' : '开始游戏'}
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
          {loading ? <ProductState kind="loading" title="正在读取对局" /> : games.length === 0 ? (
            <ProductState title="还没有保存的对局" description="完成或开始一盘本地对局后，会自动显示在这里。" />
          ) : (
            <div className="saved-games-list">
              {games.slice(0, 8).map(item => (
                <div className="saved-game-item" key={item.id}>
                  <button className="saved-game-open" onClick={() => onOpen(item.id)}>
                    <strong>{item.name}</strong>
                    <span>{formatModeName(item.mode)} · {item.moveCount} 回合 · {new Date(item.updatedAt).toLocaleString()}</span>
                  </button>
                  <button title="重命名" onClick={() => setEditingGame(item)}>改名</button>
                  <button title="删除" onClick={() => setDeletingGame(item)}>删除</button>
                </div>
              ))}
            </div>
          )}
        </div>
        </section>
      </div>
      {editingGame && <ProductDialog
        title="重命名对局"
        confirmLabel="保存"
        fields={[{ name: 'name', label: '对局名称', initialValue: editingGame.name, required: true, maxLength: 80 }]}
        onCancel={() => setEditingGame(null)}
        onConfirm={values => {
          const name = values.name.trim()
          if (name !== editingGame.name) onRename(editingGame, name)
          setEditingGame(null)
        }}
      />}
      {deletingGame && <ProductDialog
        title="删除对局"
        description={`确定删除“${deletingGame.name}”吗？删除后无法恢复。`}
        confirmLabel="确认删除"
        dangerous
        onCancel={() => setDeletingGame(null)}
        onConfirm={() => {
          onDelete(deletingGame)
          setDeletingGame(null)
        }}
      />}
    </div>
  )
}
