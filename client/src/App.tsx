import { useEffect, useMemo, useRef, useState } from 'react'
import Board, { BoardHandle } from './components/Board'
import GamePanel from './components/GamePanel'
import MoveHistory from './components/MoveHistory'
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
import { EndgameDefinition, EndgameStartConfig, EndgameTarget, GameMode, Difficulty, MoveCandidate, MoveRecord, PlayerSide, StudyPosition } from './types'

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

export default function App() {
  const [initialReplay] = useState(() => (
    typeof window === 'undefined' ? null : parseReplayStudyFromSearch(window.location.search)
  ))
  const boardRef = useRef<BoardHandle>(null)
  const [gameMode, setGameMode] = useState<GameMode | null>(() => initialReplay?.ok ? 'study' : null)
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
  const [studySaveStatus, setStudySaveStatus] = useState<'saved' | 'unsaved' | 'shared' | null>(null)
  const [engineSettings, setEngineSettings] = useState<EngineSettings>(() => loadEngineSettings())
  const [trainingHintLevel, setTrainingHintLevel] = useState(0)
  const [trainingHintHistory, setTrainingHintHistory] = useState<TrainingHintHistoryEntry[]>([])
  const candidateAutoRequestRef = useRef<string | null>(null)
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

  useEffect(() => {
    if (initialReplay && !initialReplay.ok) {
      window.alert(initialReplay.error)
    }
  }, [initialReplay])

  const game = useGame({
    gameMode,
    difficulty,
    playerSide,
    aiRedDifficulty,
    aiBlackDifficulty,
    candidateCount: engineSettings.candidateCount,
    hintDifficulty: engineSettings.hintDifficulty,
    searchLimit,
    engineRuntimeOptions,
    analysisEnabled: showAnalysis,
    initialFen: gameMode === 'study' ? selectedStudy?.initialFen : selectedEndgame?.fen,
    initialMoveRecords: gameMode === 'study' ? selectedStudy?.moves : undefined,
    initialCurrentMoveIndex: gameMode === 'study' ? selectedStudy?.currentMoveIndex : undefined,
    initialAnalysisPoints: gameMode === 'study' ? selectedStudy?.analysisPoints : undefined,
    initialVariationTree: gameMode === 'study' ? selectedStudy?.variationTree : undefined,
    redPlayerConfig: gameMode === 'endgame' ? endgameConfig.red : undefined,
    blackPlayerConfig: gameMode === 'endgame' ? endgameConfig.black : undefined,
  })

  const trainingFeedback = getEndgameTrainingFeedback(selectedEndgame, game.moveRecords, game.gameStatus, game.evaluation)
  const trainingHint = getEndgameTrainingHint(selectedEndgame, game.moveRecords, game.board, trainingHintLevel)
  const trainingHintHistoryText = formatTrainingHintHistory(trainingHintHistory)
  const naturalLimitReminder = getNaturalLimitReminder(game.moveRecords)
  const repetitionReminder = getRepetitionReminder(game.initialFen, game.moveRecords)
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
    return <StartScreen onStart={(mode, diff, side, redDiff, blackDiff) => {
      setGameMode(mode)
      setDifficulty(diff)
      setPlayerSide(side)
      setAiRedDifficulty(redDiff)
      setAiBlackDifficulty(blackDiff)
      setSelectedEndgame(null)
      setSelectedStudy(null)
      setEditingEndgame(false)
    }} />
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
      <div className="game-container">
        <div className="left-panel">
          <MoveHistory
            moves={game.historyRecords}
            currentIndex={game.currentMoveIndex}
            onJumpTo={game.jumpToMove}
            onToggleMark={game.toggleMoveMark}
            onUpdateNote={game.updateMoveNote}
            showOnlyAnnotated={showOnlyAnnotatedMoves}
            onShowOnlyAnnotatedChange={setShowOnlyAnnotatedMoves}
          />
        </div>
        {showAnalysis && (
          <AnalysisBar
            evaluation={game.evaluation}
            bestLine={game.bestLine}
            bestLineNotation={game.bestLineNotation}
            depth={game.analysisDepth}
          />
        )}
        <div className="board-stage">
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
            interactionDisabled={Boolean(candidatePreview)}
            onCellClick={game.handleCellClick}
            onCancelSelection={game.cancelSelection}
          />
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
            onNewGame={() => {
              setAiAutoPlaying(false)
              setStudyAutoPlaying(false)
              if (gameMode === 'endgame') {
                setSelectedEndgame(null)
                setEditingEndgame(false)
              } else if (gameMode === 'study') {
                setSelectedStudy(null)
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
          />
          <CandidateList
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
          />
          <ReviewPanel
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
          />
          <VariationPanel
            children={game.variationChildren}
            mainChildId={game.mainVariationChildId}
            branchCount={game.variationBranchCount}
            onSelect={game.selectVariation}
            onSetMain={game.setMainVariationChild}
          />
          {showAnalysis && <AnalysisCurve points={game.analysisPoints} />}
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
            <button
              className={mode === 'study' ? 'active' : ''}
              onClick={() => setMode('study')}
            >研究局面</button>
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
