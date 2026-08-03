import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Board, Position, Move, MoveRecord, PieceColor,
  GameMode, Difficulty, PlayerSide, GameStatus, GameStatusReason, WSMessage, PlayerConfig, AnalysisPoint, MoveCandidate, EngineSearchLimit,
  EngineRuntimeOptions, ReviewPosition,
} from '../types'
import { parseFen, boardToFen, applyMove, INITIAL_FEN, findKing } from '../engine/board'
import { getLegalMoves, isInCheck, getGameStatusDetail } from '../engine/rules'
import { moveToNotation, moveToUci, uciToMove } from '../engine/notation'
import { validateFenPosition } from '../engine/validation'
import { useWebSocket } from './useWebSocket'
import { getManualDrawStatus, getRedoTargetIndex, getResignationStatus, getUndoTargetIndex, sendStopForActiveEngineRequests, shouldAutoRequestAiMove } from './gameFlow'
import { playMoveSound, playCaptureSound, playCheckSound, playGameOverSound } from '../audio'

interface UseGameOptions {
  gameMode: GameMode | null
  difficulty: Difficulty
  playerSide: PlayerSide
  aiRedDifficulty: Difficulty
  aiBlackDifficulty: Difficulty
  candidateCount?: number
  hintDifficulty?: Difficulty
  searchLimit?: EngineSearchLimit
  engineRuntimeOptions?: EngineRuntimeOptions
  analysisEnabled?: boolean
  initialFen?: string
  initialMoveRecords?: MoveRecord[]
  initialCurrentMoveIndex?: number
  initialAnalysisPoints?: AnalysisPoint[]
  redPlayerConfig?: PlayerConfig
  blackPlayerConfig?: PlayerConfig
}

function getDefaultPlayers(
  gameMode: GameMode | null,
  difficulty: Difficulty,
  playerSide: PlayerSide,
  aiRedDifficulty: Difficulty,
  aiBlackDifficulty: Difficulty,
  redPlayerConfig?: PlayerConfig,
  blackPlayerConfig?: PlayerConfig,
): { red: PlayerConfig; black: PlayerConfig } {
  if (gameMode === 'endgame' && redPlayerConfig && blackPlayerConfig) {
    return { red: redPlayerConfig, black: blackPlayerConfig }
  }

  if (gameMode === 'human-vs-ai') {
    return playerSide === 'red'
      ? { red: { type: 'human' }, black: { type: 'ai', difficulty } }
      : { red: { type: 'ai', difficulty }, black: { type: 'human' } }
  }

  if (gameMode === 'ai-vs-ai') {
    return {
      red: { type: 'ai', difficulty: aiRedDifficulty },
      black: { type: 'ai', difficulty: aiBlackDifficulty },
    }
  }

  return {
    red: { type: 'human' },
    black: { type: 'human' },
  }
}

function uciListFromRecords(records: MoveRecord[]): string[] {
  return records.map(r => moveToUci(r.move.from, r.move.to))
}

type PendingEngineRequest = {
  id: string
  kind: 'move' | 'hint'
  fen: string
  movesKey: string
}

function makeRequestId(kind: string): string {
  return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function parseInitialGameState(fen: string) {
  const parsed = parseFen(fen)
  return { board: parsed.board, turn: parsed.turn }
}

export function useGame({
  gameMode,
  difficulty,
  playerSide,
  aiRedDifficulty,
  aiBlackDifficulty,
  candidateCount = 3,
  hintDifficulty = 'master',
  searchLimit,
  engineRuntimeOptions,
  analysisEnabled = false,
  initialFen,
  initialMoveRecords,
  initialCurrentMoveIndex,
  initialAnalysisPoints,
  redPlayerConfig,
  blackPlayerConfig,
}: UseGameOptions) {
  const resolvedInitialFen = initialFen || INITIAL_FEN
  const [engineBaseFen, setEngineBaseFen] = useState(resolvedInitialFen)
  const [board, setBoard] = useState<Board>(() => parseInitialGameState(resolvedInitialFen).board)
  const [currentTurn, setCurrentTurn] = useState<PieceColor>(() => parseInitialGameState(resolvedInitialFen).turn)
  const [selectedPos, setSelectedPos] = useState<Position | null>(null)
  const [legalMoves, setLegalMoves] = useState<Position[]>([])
  const [moveHistory, setMoveHistory] = useState<MoveRecord[]>([])
  const [currentMoveIndex, setCurrentMoveIndex] = useState(-1)
  const [uciMoves, setUciMoves] = useState<string[]>([])
  const [gameStatus, setGameStatus] = useState<GameStatus>('playing')
  const [gameStatusReason, setGameStatusReason] = useState<GameStatusReason | undefined>()
  const [lastMove, setLastMove] = useState<Move | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [evaluation, setEvaluation] = useState<number | null>(null)
  const [bestLine, setBestLine] = useState<string[]>([])
  const [analysisDepth, setAnalysisDepth] = useState(0)
  const [analysisPoints, setAnalysisPoints] = useState<AnalysisPoint[]>([])
  const [moveCandidates, setMoveCandidates] = useState<MoveCandidate[]>([])
  const [aiThinking, setAiThinking] = useState(false)
  const [hintThinking, setHintThinking] = useState(false)
  const [candidateThinking, setCandidateThinking] = useState(false)
  const [reviewThinking, setReviewThinking] = useState(false)
  const [reviewProgress, setReviewProgress] = useState({ completed: 0, total: 0 })
  const [reviewPositions, setReviewPositions] = useState<ReviewPosition[]>([])
  const [reviewedMovesKey, setReviewedMovesKey] = useState('')
  const [hintMove, setHintMove] = useState<Move | null>(null)
  const [engineAvailable, setEngineAvailable] = useState<boolean | null>(null)
  const [engineStatusMessage, setEngineStatusMessage] = useState('')

  const boardRef = useRef(board)
  boardRef.current = board
  const turnRef = useRef(currentTurn)
  turnRef.current = currentTurn
  const uciMovesRef = useRef(uciMoves)
  uciMovesRef.current = uciMoves
  const currentMoveIndexRef = useRef(currentMoveIndex)
  currentMoveIndexRef.current = currentMoveIndex
  const pendingRequestRef = useRef<PendingEngineRequest | null>(null)
  const analysisRequestRef = useRef<{ id: string; movesKey: string } | null>(null)
  const candidateRequestRef = useRef<{ id: string; movesKey: string } | null>(null)
  const reviewRequestRef = useRef<{ id: string; movesKey: string } | null>(null)
  const players = getDefaultPlayers(
    gameMode,
    difficulty,
    playerSide,
    aiRedDifficulty,
    aiBlackDifficulty,
    redPlayerConfig,
    blackPlayerConfig,
  )
  const currentPlayerConfig = currentTurn === 'red' ? players.red : players.black

  const buildMoveFromUci = useCallback((uci: string, currentBoard: Board): Move | null => {
    const { from, to } = uciToMove(uci)
    const piece = currentBoard[from.row][from.col]
    if (!piece) return null
    return {
      from,
      to,
      captured: currentBoard[to.row][to.col] || undefined,
      piece,
    }
  }, [])

  const translatePv = useCallback((pv: string[], currentBoard: Board): string[] => {
    let replayBoard = currentBoard
    const translated: string[] = []

    for (const uci of pv) {
      try {
        const move = buildMoveFromUci(uci, replayBoard)
        if (!move) {
          translated.push(uci)
          break
        }
        translated.push(moveToNotation(replayBoard, move))
        replayBoard = applyMove(replayBoard, move.from, move.to).newBoard
      } catch {
        translated.push(uci)
        break
      }
    }

    return translated
  }, [buildMoveFromUci])

  const handleWsMessage = useCallback((msg: WSMessage) => {
    if (msg.type === 'bestmove') {
      const pending = pendingRequestRef.current
      const requestKind = msg.requestKind || pending?.kind
      if (
        !pending ||
        (msg.requestId && msg.requestId !== pending.id) ||
        (requestKind && requestKind !== pending.kind) ||
        pending.movesKey !== uciMovesRef.current.join(' ')
      ) {
        return
      }

      const currentBoard = boardRef.current
      const move = buildMoveFromUci(msg.move, currentBoard)
      if (!move) {
        pendingRequestRef.current = null
        setAiThinking(false)
        setHintThinking(false)
        return
      }

      const legalTargets = getLegalMoves(currentBoard, move.from)
      const isLegal = move.piece.color === turnRef.current &&
        legalTargets.some(to => to.row === move.to.row && to.col === move.to.col)
      if (!isLegal) {
        pendingRequestRef.current = null
        setAiThinking(false)
        setHintThinking(false)
        return
      }

      if (pending.kind === 'hint') {
        setHintMove(move)
        pendingRequestRef.current = null
        setHintThinking(false)
        return
      }

      const { newBoard, captured } = applyMove(currentBoard, move.from, move.to)
      const notation = moveToNotation(currentBoard, move)
      const nextTurn: PieceColor = turnRef.current === 'red' ? 'black' : 'red'
      const fen = boardToFen(newBoard, nextTurn)
      const source: MoveRecord['source'] = move.piece.color === 'red' ? 'ai-red' : 'ai-black'

      const historyIdx = currentMoveIndexRef.current

      setBoard(newBoard)
      setLastMove(move)
      setCurrentTurn(nextTurn)
      setHintMove(null)
      setUciMoves(prev => [...prev.slice(0, historyIdx + 1), msg.move])
      setMoveHistory(prev => [...prev.slice(0, historyIdx + 1), { move, notation, fen, elapsedMs: msg.elapsedMs, source }])
      setCurrentMoveIndex(historyIdx + 1)
      setSelectedPos(null)
      setLegalMoves([])
      setMoveCandidates([])
      setCandidateThinking(false)
      setAiThinking(false)
      pendingRequestRef.current = null
      candidateRequestRef.current = null

      const statusDetail = getGameStatusDetail(newBoard, nextTurn)
      setGameStatus(statusDetail.status)
      setGameStatusReason(statusDetail.reason)

      if (statusDetail.status !== 'playing') {
        playGameOverSound()
      } else if (isInCheck(newBoard, nextTurn)) {
        playCheckSound()
      } else if (captured) {
        playCaptureSound()
      } else {
        playMoveSound()
      }
    } else if (msg.type === 'info') {
      const currentAnalysis = analysisRequestRef.current
      if (msg.requestId && (!currentAnalysis || msg.requestId !== currentAnalysis.id)) {
        return
      }
      const redPerspectiveScore = turnRef.current === 'red' ? msg.data.score : -msg.data.score
      setEvaluation(redPerspectiveScore)
      setBestLine(msg.data.pv)
      setAnalysisDepth(msg.data.depth)
      setAnalysisPoints(prev => {
        const point = {
          moveIndex: currentMoveIndexRef.current,
          evaluation: redPerspectiveScore,
          depth: msg.data.depth,
        }
        return [...prev.filter(item => item.moveIndex !== point.moveIndex), point]
          .sort((a, b) => a.moveIndex - b.moveIndex)
      })
    } else if (msg.type === 'engine-status') {
      setEngineAvailable(msg.available)
      setEngineStatusMessage(msg.message || (msg.available ? 'Engine ready' : 'Engine not available'))
    } else if (msg.type === 'candidates') {
      const currentRequest = candidateRequestRef.current
      if (
        !currentRequest ||
        (msg.requestId && msg.requestId !== currentRequest.id) ||
        currentRequest.movesKey !== uciMovesRef.current.join(' ')
      ) {
        return
      }
      const currentBoard = boardRef.current
      setMoveCandidates((msg.candidates || []).map(candidate => {
        const move = buildMoveFromUci(candidate.move, currentBoard)
        return {
          ...candidate,
          score: turnRef.current === 'red' ? candidate.score : -candidate.score,
          notation: move ? moveToNotation(currentBoard, move) : candidate.move,
          pvNotation: translatePv(candidate.pv, currentBoard),
        }
      }))
      setCandidateThinking(false)
      candidateRequestRef.current = null
    } else if (msg.type === 'review-progress') {
      const request = reviewRequestRef.current
      if (!request || msg.requestId !== request.id) return
      setReviewProgress({ completed: msg.completed, total: msg.total })
    } else if (msg.type === 'review-result') {
      const request = reviewRequestRef.current
      if (!request || msg.requestId !== request.id) return
      setReviewPositions(msg.positions)
      setReviewedMovesKey(request.movesKey)
      setReviewProgress({ completed: msg.positions.length, total: msg.positions.length })
      setReviewThinking(false)
      reviewRequestRef.current = null
    } else if (msg.type === 'error') {
      setEngineStatusMessage(msg.message)
      if (msg.message.toLowerCase().includes('engine')) {
        setEngineAvailable(false)
      }
      pendingRequestRef.current = null
      candidateRequestRef.current = null
      reviewRequestRef.current = null
      setAiThinking(false)
      setHintThinking(false)
      setCandidateThinking(false)
      setReviewThinking(false)
    }
  }, [buildMoveFromUci, translatePv])

  const { send, connected, connectionState } = useWebSocket(handleWsMessage)

  // Initialize game when mode changes (not when connection flickers)
  const prevGameMode = useRef<GameMode | null | undefined>(undefined)
  const prevDifficulty = useRef<Difficulty | undefined>(undefined)
  const prevPlayerSide = useRef<PlayerSide | undefined>(undefined)
  const prevInitialFen = useRef<string | undefined>(undefined)
  const prevInitialMoveRecords = useRef<MoveRecord[] | undefined>(undefined)
  const prevInitialCurrentMoveIndex = useRef<number | undefined>(undefined)
  const prevInitialAnalysisPoints = useRef<AnalysisPoint[] | undefined>(undefined)
  const prevRedPlayerConfig = useRef<PlayerConfig | undefined>(undefined)
  const prevBlackPlayerConfig = useRef<PlayerConfig | undefined>(undefined)

  useEffect(() => {
    if (!gameMode) {
      prevGameMode.current = null
      return
    }

    const modeChanged = prevGameMode.current !== gameMode
    const diffChanged = prevDifficulty.current !== difficulty
    const sideChanged = prevPlayerSide.current !== playerSide
    const fenChanged = prevInitialFen.current !== resolvedInitialFen
    const recordsChanged = prevInitialMoveRecords.current !== initialMoveRecords
    const indexChanged = prevInitialCurrentMoveIndex.current !== initialCurrentMoveIndex
    const analysisPointsChanged = prevInitialAnalysisPoints.current !== initialAnalysisPoints
    const redConfigChanged = prevRedPlayerConfig.current !== redPlayerConfig
    const blackConfigChanged = prevBlackPlayerConfig.current !== blackPlayerConfig

    prevGameMode.current = gameMode
    prevDifficulty.current = difficulty
    prevPlayerSide.current = playerSide
    prevInitialFen.current = resolvedInitialFen
    prevInitialMoveRecords.current = initialMoveRecords
    prevInitialCurrentMoveIndex.current = initialCurrentMoveIndex
    prevInitialAnalysisPoints.current = initialAnalysisPoints
    prevRedPlayerConfig.current = redPlayerConfig
    prevBlackPlayerConfig.current = blackPlayerConfig

    if (!modeChanged && !diffChanged && !sideChanged && !fenChanged && !recordsChanged && !indexChanged && !analysisPointsChanged && !redConfigChanged && !blackConfigChanged) return

    const restoredRecords = initialMoveRecords || []
    const restoredIndex = Math.min(initialCurrentMoveIndex ?? restoredRecords.length - 1, restoredRecords.length - 1)
    const restoredFen = restoredIndex >= 0 ? restoredRecords[restoredIndex].fen : resolvedInitialFen
    const { board: initBoard, turn } = parseFen(restoredFen)
    setEngineBaseFen(resolvedInitialFen)
    setBoard(initBoard)
    setCurrentTurn(turn)
    setSelectedPos(null)
    setLegalMoves([])
    setMoveHistory(restoredRecords)
    setCurrentMoveIndex(restoredIndex)
    setUciMoves(uciListFromRecords(restoredRecords.slice(0, restoredIndex + 1)))
    const statusDetail = getGameStatusDetail(initBoard, turn)
    setGameStatus(statusDetail.status)
    setGameStatusReason(statusDetail.reason)
    setLastMove(null)
    setEvaluation(null)
    setBestLine([])
    setAnalysisDepth(0)
    setAnalysisPoints(initialAnalysisPoints || [])
    setMoveCandidates([])
    setFlipped(
      gameMode === 'human-vs-ai'
        ? playerSide === 'black'
        : false,
    )
    setAiThinking(false)
    setHintThinking(false)
    setCandidateThinking(false)
    setReviewThinking(false)
    setReviewProgress({ completed: 0, total: 0 })
    setReviewPositions([])
    setReviewedMovesKey('')
    setHintMove(null)
    pendingRequestRef.current = null
    analysisRequestRef.current = null
    candidateRequestRef.current = null
    reviewRequestRef.current = null
  }, [gameMode, difficulty, playerSide, aiRedDifficulty, aiBlackDifficulty, resolvedInitialFen, initialMoveRecords, initialCurrentMoveIndex, initialAnalysisPoints, redPlayerConfig, blackPlayerConfig])

  useEffect(() => {
    if (!connected) {
      setEngineAvailable(null)
      setEngineStatusMessage('')
      setAiThinking(false)
      setHintThinking(false)
      setCandidateThinking(false)
      setReviewThinking(false)
      pendingRequestRef.current = null
      analysisRequestRef.current = null
      candidateRequestRef.current = null
      reviewRequestRef.current = null
    }
  }, [connected])

  const historyMovesKey = uciListFromRecords(moveHistory).join(' ')
  useEffect(() => {
    if (reviewedMovesKey && reviewedMovesKey !== historyMovesKey) {
      setReviewPositions([])
      setReviewProgress({ completed: 0, total: 0 })
      setReviewedMovesKey('')
    }
  }, [historyMovesKey, reviewedMovesKey])

  // Send init to server whenever connected, difficulty, or runtime engine settings change.
  useEffect(() => {
    if (!gameMode || !connected) return
    send({ type: 'init', difficulty, ...engineRuntimeOptions })
  }, [connected, difficulty, engineRuntimeOptions, gameMode, send])

  useEffect(() => {
    if (!gameMode || !connected || !analysisEnabled) {
      if (connected) send({ type: 'stop' })
      return
    }

    setEvaluation(null)
    setBestLine([])
    setAnalysisDepth(0)
    const requestId = makeRequestId('analyze')
    analysisRequestRef.current = { id: requestId, movesKey: uciMoves.join(' ') }
    send({
      type: 'analyze',
      requestId,
      fen: engineBaseFen,
      moves: uciMoves,
      ...searchLimit,
    })

    return () => {
      send({ type: 'stop', requestId })
      if (analysisRequestRef.current?.id === requestId) {
        analysisRequestRef.current = null
      }
    }
  }, [analysisEnabled, connected, engineBaseFen, engineRuntimeOptions, gameMode, send, uciMoves, searchLimit])

  // Trigger AI move
  useEffect(() => {
    if (reviewThinking || !shouldAutoRequestAiMove({
      gameStatus,
      aiThinking,
      gameMode,
      currentPlayer: currentPlayerConfig,
      connected,
    })) return

    setAiThinking(true)
    const requestId = makeRequestId('move')
    pendingRequestRef.current = {
      id: requestId,
      kind: 'move',
      fen: engineBaseFen,
      movesKey: uciMoves.join(' '),
    }
    const sent = send({
      type: 'move',
      requestId,
      fen: engineBaseFen,
      moves: uciMoves,
      difficulty: currentPlayerConfig.difficulty || difficulty,
      ...searchLimit,
    })
    if (!sent) {
      pendingRequestRef.current = null
      candidateRequestRef.current = null
      setAiThinking(false)
    }
  }, [gameStatus, aiThinking, reviewThinking, gameMode, currentPlayerConfig, connected, send, engineBaseFen, uciMoves, difficulty, searchLimit])

  const handleCellClick = useCallback((pos: Position) => {
    if (gameStatus !== 'playing') return
    if (gameMode === 'ai-vs-ai') return
    if (currentPlayerConfig.type === 'ai') return
    if (aiThinking) return
    if (reviewThinking) return

    const piece = board[pos.row][pos.col]

    if (selectedPos) {
      const isLegal = legalMoves.some(m => m.row === pos.row && m.col === pos.col)
      if (isLegal) {
        const selectedPiece = board[selectedPos.row][selectedPos.col]!
        const { newBoard, captured } = applyMove(board, selectedPos, pos)
        const move: Move = { from: selectedPos, to: pos, captured: captured || undefined, piece: selectedPiece }
        const uci = moveToUci(selectedPos, pos)
        const notation = moveToNotation(board, move)
        const nextTurn: PieceColor = currentTurn === 'red' ? 'black' : 'red'
        const fen = boardToFen(newBoard, nextTurn)

        const newUciMoves = [...uciMoves.slice(0, currentMoveIndex + 1), uci]
        const newHistory = [...moveHistory.slice(0, currentMoveIndex + 1), { move, notation, fen, source: 'human' as const }]

        setBoard(newBoard)
        setLastMove(move)
        setCurrentTurn(nextTurn)
        setHintMove(null)
        setUciMoves(newUciMoves)
        setMoveHistory(newHistory)
        setCurrentMoveIndex(newHistory.length - 1)
        setSelectedPos(null)
        setLegalMoves([])
        setMoveCandidates([])
        setCandidateThinking(false)

        const statusDetail = getGameStatusDetail(newBoard, nextTurn)
        setGameStatus(statusDetail.status)
        setGameStatusReason(statusDetail.reason)

        if (statusDetail.status !== 'playing') {
          playGameOverSound()
        } else if (isInCheck(newBoard, nextTurn)) {
          playCheckSound()
        } else if (captured) {
          playCaptureSound()
        } else {
          playMoveSound()
        }
        return
      }

      if (piece && piece.color === currentTurn) {
        setSelectedPos(pos)
        setLegalMoves(getLegalMoves(board, pos))
        return
      }

      setSelectedPos(null)
      setLegalMoves([])
      return
    }

    if (piece && piece.color === currentTurn) {
      setSelectedPos(pos)
      setLegalMoves(getLegalMoves(board, pos))
    }
  }, [board, selectedPos, legalMoves, currentTurn, gameMode, currentPlayerConfig, gameStatus, aiThinking, reviewThinking, uciMoves, moveHistory, currentMoveIndex])

  const inCheck = (() => {
    if (isInCheck(board, currentTurn)) {
      return findKing(board, currentTurn)
    }
    return null
  })()

  const stopActiveRequests = useCallback(() => {
    sendStopForActiveEngineRequests(connected, send)
    setAiThinking(false)
    setHintThinking(false)
    setCandidateThinking(false)
    setReviewThinking(false)
    setHintMove(null)
    setMoveCandidates([])
    pendingRequestRef.current = null
    candidateRequestRef.current = null
    reviewRequestRef.current = null
  }, [connected, send])

  const undo = useCallback(() => {
    if (currentMoveIndex < 0) return
    const targetIndex = getUndoTargetIndex(currentMoveIndex, gameMode, players)

    if (targetIndex < 0) {
      const { board: initBoard, turn } = parseFen(resolvedInitialFen)
      setBoard(initBoard)
      setCurrentTurn(turn)
      setLastMove(null)
      const statusDetail = getGameStatusDetail(initBoard, turn)
      setGameStatus(statusDetail.status)
      setGameStatusReason(statusDetail.reason)
    } else {
      const record = moveHistory[targetIndex]
      const { board: prevBoard, turn } = parseFen(record.fen)
      setBoard(prevBoard)
      setCurrentTurn(turn)
      setLastMove(record.move)
      const statusDetail = getGameStatusDetail(prevBoard, turn)
      setGameStatus(statusDetail.status)
      setGameStatusReason(statusDetail.reason)
    }

    setCurrentMoveIndex(targetIndex)
    setUciMoves(uciListFromRecords(moveHistory.slice(0, targetIndex + 1)))
    setSelectedPos(null)
    setLegalMoves([])
    stopActiveRequests()
  }, [currentMoveIndex, moveHistory, gameMode, players, resolvedInitialFen, stopActiveRequests])

  const redo = useCallback(() => {
    if (currentMoveIndex >= moveHistory.length - 1) return
    const targetIndex = getRedoTargetIndex(currentMoveIndex, moveHistory.length, gameMode, players)

    const record = moveHistory[targetIndex]
    const { board: nextBoard, turn } = parseFen(record.fen)
    setBoard(nextBoard)
    setCurrentTurn(turn)
    setLastMove(record.move)
    setCurrentMoveIndex(targetIndex)
    setUciMoves(uciListFromRecords(moveHistory.slice(0, targetIndex + 1)))
    setSelectedPos(null)
    setLegalMoves([])
    stopActiveRequests()

    const statusDetail = getGameStatusDetail(nextBoard, turn)
    setGameStatus(statusDetail.status)
    setGameStatusReason(statusDetail.reason)
  }, [currentMoveIndex, moveHistory, gameMode, players, stopActiveRequests])

  const flip = useCallback(() => {
    setFlipped(f => !f)
  }, [])

  const cancelSelection = useCallback(() => {
    setSelectedPos(null)
    setLegalMoves([])
  }, [])

  const toggleMoveMark = useCallback((index: number) => {
    setMoveHistory(prev => prev.map((record, i) => i === index ? { ...record, marked: !record.marked } : record))
  }, [])

  const updateMoveNote = useCallback((index: number, note: string) => {
    setMoveHistory(prev => prev.map((record, i) => i === index ? { ...record, note: note.trim() || undefined } : record))
  }, [])

  const jumpToMove = useCallback((index: number) => {
    if (index < -1 || index >= moveHistory.length) return
    if (index === -1) {
      const { board: initialBoard, turn } = parseFen(engineBaseFen)
      setBoard(initialBoard)
      setCurrentTurn(turn)
      setLastMove(null)
      setCurrentMoveIndex(-1)
      setUciMoves([])
      setSelectedPos(null)
      setLegalMoves([])
      stopActiveRequests()
      const statusDetail = getGameStatusDetail(initialBoard, turn)
      setGameStatus(statusDetail.status)
      setGameStatusReason(statusDetail.reason)
      return
    }
    const record = moveHistory[index]
    const { board: targetBoard, turn } = parseFen(record.fen)
    setBoard(targetBoard)
    setCurrentTurn(turn)
    setLastMove(record.move)
    setCurrentMoveIndex(index)
    setUciMoves(uciListFromRecords(moveHistory.slice(0, index + 1)))
    setSelectedPos(null)
    setLegalMoves([])
    stopActiveRequests()
    const statusDetail = getGameStatusDetail(targetBoard, turn)
    setGameStatus(statusDetail.status)
    setGameStatusReason(statusDetail.reason)
  }, [engineBaseFen, moveHistory, stopActiveRequests])

  const getCurrentFen = useCallback(() => {
    return boardToFen(board, currentTurn, Math.floor((currentMoveIndex + 2) / 2))
  }, [board, currentTurn, currentMoveIndex])

  const loadFen = useCallback((fen: string) => {
    try {
      const normalizedFen = fen.trim()
      const validation = validateFenPosition(normalizedFen)
      if (!validation.ok) return false
      const { board: newBoard, turn } = parseFen(normalizedFen)
      setEngineBaseFen(normalizedFen)
      setBoard(newBoard)
      setCurrentTurn(turn)
      setSelectedPos(null)
      setLegalMoves([])
      setMoveHistory([])
      setCurrentMoveIndex(-1)
      setUciMoves([])
      const statusDetail = getGameStatusDetail(newBoard, turn)
      setGameStatus(statusDetail.status)
      setGameStatusReason(statusDetail.reason)
      setLastMove(null)
      setAiThinking(false)
      setHintThinking(false)
      setHintMove(null)
      setEvaluation(null)
      setBestLine([])
      setAnalysisDepth(0)
      setAnalysisPoints([])
      stopActiveRequests()
      return true
    } catch {
      return false
    }
  }, [stopActiveRequests])

  const requestHint = useCallback(() => {
    if (!connected || gameStatus !== 'playing' || aiThinking || hintThinking || candidateThinking || reviewThinking) return
    if (currentPlayerConfig.type !== 'human') return

    setHintThinking(true)
    setHintMove(null)
    const requestId = makeRequestId('hint')
    pendingRequestRef.current = {
      id: requestId,
      kind: 'hint',
      fen: engineBaseFen,
      movesKey: uciMoves.join(' '),
    }
    const sent = send({ type: 'hint', requestId, fen: engineBaseFen, moves: uciMoves, difficulty: hintDifficulty, ...searchLimit })
    if (!sent) {
      pendingRequestRef.current = null
      setHintThinking(false)
    }
  }, [connected, gameStatus, aiThinking, hintThinking, candidateThinking, reviewThinking, currentPlayerConfig, send, uciMoves, engineBaseFen, hintDifficulty, searchLimit])

  const requestCandidates = useCallback(() => {
    if (!connected || gameStatus !== 'playing' || aiThinking || hintThinking || candidateThinking || reviewThinking) return

    setCandidateThinking(true)
    setMoveCandidates([])
    const requestId = makeRequestId('candidates')
    candidateRequestRef.current = { id: requestId, movesKey: uciMoves.join(' ') }
    const sent = send({
      type: 'candidates',
      requestId,
      fen: engineBaseFen,
      moves: uciMoves,
      difficulty: currentPlayerConfig.difficulty || difficulty,
      count: candidateCount,
      ...searchLimit,
    })
    if (!sent) {
      candidateRequestRef.current = null
      setCandidateThinking(false)
    }
  }, [connected, gameStatus, aiThinking, hintThinking, candidateThinking, reviewThinking, send, engineBaseFen, uciMoves, currentPlayerConfig, difficulty, candidateCount, searchLimit])

  const requestReview = useCallback(() => {
    if (!connected || engineAvailable === false || moveHistory.length === 0 || moveHistory.length > 120) return
    if (aiThinking || hintThinking || candidateThinking || reviewThinking) return

    const moves = uciListFromRecords(moveHistory)
    const requestId = makeRequestId('review')
    reviewRequestRef.current = { id: requestId, movesKey: moves.join(' ') }
    setReviewThinking(true)
    setReviewProgress({ completed: 0, total: moves.length + 1 })
    setReviewPositions([])
    const sent = send({ type: 'review', requestId, fen: engineBaseFen, moves, searchDepth: 12 })
    if (!sent) {
      reviewRequestRef.current = null
      setReviewThinking(false)
    }
  }, [aiThinking, candidateThinking, connected, engineAvailable, engineBaseFen, hintThinking, moveHistory, reviewThinking, send])

  const cancelReview = useCallback(() => {
    const request = reviewRequestRef.current
    if (connected && request) send({ type: 'stop', requestId: request.id })
    reviewRequestRef.current = null
    setReviewThinking(false)
    setReviewProgress({ completed: 0, total: 0 })
  }, [connected, send])

  const nextAiMove = useCallback(() => {
    if (gameMode !== 'ai-vs-ai') return
    if (!connected || gameStatus !== 'playing' || aiThinking || reviewThinking) return

    const difficultyForTurn = currentTurn === 'red' ? aiRedDifficulty : aiBlackDifficulty
    setAiThinking(true)
    setHintMove(null)
    const requestId = makeRequestId('move')
    pendingRequestRef.current = {
      id: requestId,
      kind: 'move',
      fen: engineBaseFen,
      movesKey: uciMoves.join(' '),
    }
    const sent = send({ type: 'move', requestId, fen: engineBaseFen, moves: uciMoves, difficulty: difficultyForTurn, ...searchLimit })
    if (!sent) {
      pendingRequestRef.current = null
      candidateRequestRef.current = null
      setAiThinking(false)
    }
  }, [gameMode, connected, gameStatus, aiThinking, reviewThinking, currentTurn, aiRedDifficulty, aiBlackDifficulty, send, uciMoves, engineBaseFen, searchLimit])

  const declareDraw = useCallback(() => {
    if (gameStatus !== 'playing') return
    const statusDetail = getManualDrawStatus()
    setGameStatus(statusDetail.status)
    setGameStatusReason(statusDetail.reason)
    stopActiveRequests()
    playGameOverSound()
  }, [gameStatus, stopActiveRequests])

  const resign = useCallback(() => {
    if (gameStatus !== 'playing') return
    const statusDetail = getResignationStatus(currentTurn)
    setGameStatus(statusDetail.status)
    setGameStatusReason(statusDetail.reason)
    stopActiveRequests()
    playGameOverSound()
  }, [currentTurn, gameStatus, stopActiveRequests])

  const canRequestHint =
    connected &&
    engineAvailable !== false &&
    gameStatus === 'playing' &&
    !aiThinking &&
    !hintThinking &&
    !candidateThinking &&
    !reviewThinking &&
    currentPlayerConfig.type === 'human'

  const canStepAi =
    gameMode === 'ai-vs-ai' &&
    connected &&
    engineAvailable !== false &&
    gameStatus === 'playing' &&
    !aiThinking &&
    !reviewThinking

  const bestLineNotation = useMemo(() => {
    return translatePv(bestLine, board)
  }, [bestLine, board, translatePv])

  const moveRecords = useMemo(
    () => moveHistory.slice(0, currentMoveIndex + 1),
    [moveHistory, currentMoveIndex],
  )

  return {
    board,
    currentTurn,
    selectedPos,
    legalMoves,
    lastMove,
    hintMove,
    inCheck,
    flipped,
    gameStatus,
    gameStatusReason,
    evaluation,
    bestLine,
    bestLineNotation,
    analysisDepth,
    analysisPoints,
    moveCandidates,
    moveRecords,
    historyRecords: moveHistory,
    currentMoveIndex,
    hintThinking,
    candidateThinking,
    reviewThinking,
    reviewProgress,
    reviewPositions,
    aiThinking,
    connectionState,
    connected,
    engineAvailable,
    engineStatusMessage,
    canUndo: currentMoveIndex >= 0 && !aiThinking && !hintThinking && !reviewThinking,
    canRedo: currentMoveIndex < moveHistory.length - 1 && !aiThinking && !hintThinking && !reviewThinking,
    canRequestHint,
    canRequestCandidates: connected && engineAvailable !== false && gameStatus === 'playing' && !aiThinking && !hintThinking && !candidateThinking && !reviewThinking,
    canRequestReview: connected && engineAvailable !== false && moveHistory.length > 0 && moveHistory.length <= 120 && !aiThinking && !hintThinking && !candidateThinking && !reviewThinking,
    canStepAi,
    handleCellClick,
    undo,
    redo,
    flip,
    cancelSelection,
    toggleMoveMark,
    updateMoveNote,
    jumpToMove,
    requestHint,
    requestCandidates,
    requestReview,
    cancelReview,
    nextAiMove,
    declareDraw,
    resign,
    getCurrentFen,
    initialFen: engineBaseFen,
    loadFen,
    redPlayerConfig: players.red,
    blackPlayerConfig: players.black,
  }
}
