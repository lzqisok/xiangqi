import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Board, Position, Move, MoveRecord, PieceColor,
  GameMode, Difficulty, PlayerSide, GameStatus, GameStatusReason, WSMessage, PlayerConfig,
} from '../types'
import { parseFen, boardToFen, applyMove, INITIAL_FEN, findKing } from '../engine/board'
import { getLegalMoves, isInCheck, getGameStatusDetail } from '../engine/rules'
import { moveToNotation, moveToUci, uciToMove } from '../engine/notation'
import { validateFenPosition } from '../engine/validation'
import { useWebSocket } from './useWebSocket'
import { playMoveSound, playCaptureSound, playCheckSound, playGameOverSound } from '../audio'

interface UseGameOptions {
  gameMode: GameMode | null
  difficulty: Difficulty
  playerSide: PlayerSide
  aiRedDifficulty: Difficulty
  aiBlackDifficulty: Difficulty
  analysisEnabled?: boolean
  initialFen?: string
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
  analysisEnabled = false,
  initialFen,
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
  const [aiThinking, setAiThinking] = useState(false)
  const [hintThinking, setHintThinking] = useState(false)
  const [hintMove, setHintMove] = useState<Move | null>(null)

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
      setAiThinking(false)
      pendingRequestRef.current = null

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
    } else if (msg.type === 'error') {
      pendingRequestRef.current = null
      setAiThinking(false)
      setHintThinking(false)
    }
  }, [buildMoveFromUci])

  const { send, connected } = useWebSocket(handleWsMessage)

  // Initialize game when mode changes (not when connection flickers)
  const prevGameMode = useRef(gameMode)
  const prevDifficulty = useRef(difficulty)
  const prevPlayerSide = useRef(playerSide)
  const prevInitialFen = useRef(resolvedInitialFen)
  const prevRedPlayerConfig = useRef(redPlayerConfig)
  const prevBlackPlayerConfig = useRef(blackPlayerConfig)

  useEffect(() => {
    if (!gameMode) return

    const modeChanged = prevGameMode.current !== gameMode
    const diffChanged = prevDifficulty.current !== difficulty
    const sideChanged = prevPlayerSide.current !== playerSide
    const fenChanged = prevInitialFen.current !== resolvedInitialFen
    const redConfigChanged = prevRedPlayerConfig.current !== redPlayerConfig
    const blackConfigChanged = prevBlackPlayerConfig.current !== blackPlayerConfig

    prevGameMode.current = gameMode
    prevDifficulty.current = difficulty
    prevPlayerSide.current = playerSide
    prevInitialFen.current = resolvedInitialFen
    prevRedPlayerConfig.current = redPlayerConfig
    prevBlackPlayerConfig.current = blackPlayerConfig

    if (!modeChanged && !diffChanged && !sideChanged && !fenChanged && !redConfigChanged && !blackConfigChanged) return

    const { board: initBoard, turn } = parseFen(resolvedInitialFen)
    setEngineBaseFen(resolvedInitialFen)
    setBoard(initBoard)
    setCurrentTurn(turn)
    setSelectedPos(null)
    setLegalMoves([])
    setMoveHistory([])
    setCurrentMoveIndex(-1)
    setUciMoves([])
    const statusDetail = getGameStatusDetail(initBoard, turn)
    setGameStatus(statusDetail.status)
    setGameStatusReason(statusDetail.reason)
    setLastMove(null)
    setEvaluation(null)
    setBestLine([])
    setAnalysisDepth(0)
    setFlipped(
      gameMode === 'human-vs-ai'
        ? playerSide === 'black'
        : false,
    )
    setAiThinking(false)
    setHintThinking(false)
    setHintMove(null)
    pendingRequestRef.current = null
    analysisRequestRef.current = null
  }, [gameMode, difficulty, playerSide, aiRedDifficulty, aiBlackDifficulty, resolvedInitialFen, redPlayerConfig, blackPlayerConfig])

  // Send init to server whenever connected or difficulty changes
  useEffect(() => {
    if (!gameMode || !connected) return
    send({ type: 'init', difficulty })
  }, [connected, difficulty, gameMode, send])

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
    })

    return () => {
      send({ type: 'stop', requestId })
      if (analysisRequestRef.current?.id === requestId) {
        analysisRequestRef.current = null
      }
    }
  }, [analysisEnabled, connected, engineBaseFen, gameMode, send, uciMoves])

  // Trigger AI move
  useEffect(() => {
    if (gameStatus !== 'playing') return
    if (aiThinking) return
    if (gameMode === 'ai-vs-ai') return
    if (currentPlayerConfig.type !== 'ai') return
    if (!connected) return

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
    })
    if (!sent) {
      pendingRequestRef.current = null
      setAiThinking(false)
    }
  }, [gameStatus, aiThinking, gameMode, currentPlayerConfig, connected, send, engineBaseFen, uciMoves, difficulty])

  const handleCellClick = useCallback((pos: Position) => {
    if (gameStatus !== 'playing') return
    if (gameMode === 'ai-vs-ai') return
    if (currentPlayerConfig.type === 'ai') return
    if (aiThinking) return

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
  }, [board, selectedPos, legalMoves, currentTurn, gameMode, currentPlayerConfig, gameStatus, aiThinking, uciMoves, moveHistory, currentMoveIndex])

  const inCheck = (() => {
    if (isInCheck(board, currentTurn)) {
      return findKing(board, currentTurn)
    }
    return null
  })()

  const undo = useCallback(() => {
    if (currentMoveIndex < 0) return
    const singleAiSide =
      (players.red.type === 'ai' && players.black.type === 'human') ||
      (players.red.type === 'human' && players.black.type === 'ai')
    const undoCount = gameMode === 'human-vs-ai' || (gameMode === 'endgame' && singleAiSide) ? 2 : 1
    const targetIndex = Math.max(-1, currentMoveIndex - undoCount)

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
    setAiThinking(false)
    setHintThinking(false)
    setHintMove(null)
    pendingRequestRef.current = null
  }, [currentMoveIndex, moveHistory, gameMode, players, resolvedInitialFen])

  const redo = useCallback(() => {
    if (currentMoveIndex >= moveHistory.length - 1) return
    const singleAiSide =
      (players.red.type === 'ai' && players.black.type === 'human') ||
      (players.red.type === 'human' && players.black.type === 'ai')
    const redoCount = gameMode === 'human-vs-ai' || (gameMode === 'endgame' && singleAiSide) ? 2 : 1
    const targetIndex = Math.min(moveHistory.length - 1, currentMoveIndex + redoCount)

    const record = moveHistory[targetIndex]
    const { board: nextBoard, turn } = parseFen(record.fen)
    setBoard(nextBoard)
    setCurrentTurn(turn)
    setLastMove(record.move)
    setCurrentMoveIndex(targetIndex)
    setUciMoves(uciListFromRecords(moveHistory.slice(0, targetIndex + 1)))
    setSelectedPos(null)
    setLegalMoves([])
    setHintMove(null)
    pendingRequestRef.current = null

    const statusDetail = getGameStatusDetail(nextBoard, turn)
    setGameStatus(statusDetail.status)
    setGameStatusReason(statusDetail.reason)
  }, [currentMoveIndex, moveHistory, gameMode, players])

  const flip = useCallback(() => {
    setFlipped(f => !f)
  }, [])

  const jumpToMove = useCallback((index: number) => {
    if (index < 0 || index >= moveHistory.length) return
    const record = moveHistory[index]
    const { board: targetBoard, turn } = parseFen(record.fen)
    setBoard(targetBoard)
    setCurrentTurn(turn)
    setLastMove(record.move)
    setCurrentMoveIndex(index)
    setUciMoves(uciListFromRecords(moveHistory.slice(0, index + 1)))
    setSelectedPos(null)
    setLegalMoves([])
    setHintMove(null)
    pendingRequestRef.current = null
    const statusDetail = getGameStatusDetail(targetBoard, turn)
    setGameStatus(statusDetail.status)
    setGameStatusReason(statusDetail.reason)
  }, [moveHistory])

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
      pendingRequestRef.current = null
      return true
    } catch {
      return false
    }
  }, [])

  const requestHint = useCallback(() => {
    if (!connected || gameStatus !== 'playing' || aiThinking || hintThinking) return
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
    const sent = send({ type: 'hint', requestId, fen: engineBaseFen, moves: uciMoves, difficulty: 'master' })
    if (!sent) {
      pendingRequestRef.current = null
      setHintThinking(false)
    }
  }, [connected, gameStatus, aiThinking, hintThinking, currentPlayerConfig, send, uciMoves, engineBaseFen])

  const nextAiMove = useCallback(() => {
    if (gameMode !== 'ai-vs-ai') return
    if (!connected || gameStatus !== 'playing' || aiThinking) return

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
    const sent = send({ type: 'move', requestId, fen: engineBaseFen, moves: uciMoves, difficulty: difficultyForTurn })
    if (!sent) {
      pendingRequestRef.current = null
      setAiThinking(false)
    }
  }, [gameMode, connected, gameStatus, aiThinking, currentTurn, aiRedDifficulty, aiBlackDifficulty, send, uciMoves, engineBaseFen])

  const canRequestHint =
    connected &&
    gameStatus === 'playing' &&
    !aiThinking &&
    !hintThinking &&
    currentPlayerConfig.type === 'human'

  const canStepAi =
    gameMode === 'ai-vs-ai' &&
    connected &&
    gameStatus === 'playing' &&
    !aiThinking

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
    analysisDepth,
    moveRecords,
    currentMoveIndex,
    hintThinking,
    aiThinking,
    canUndo: currentMoveIndex >= 0,
    canRedo: currentMoveIndex < moveHistory.length - 1,
    canRequestHint,
    canStepAi,
    handleCellClick,
    undo,
    redo,
    flip,
    jumpToMove,
    requestHint,
    nextAiMove,
    getCurrentFen,
    loadFen,
    redPlayerConfig: players.red,
    blackPlayerConfig: players.black,
  }
}
