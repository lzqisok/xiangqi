import { useState, useCallback, useEffect, useRef } from 'react'
import {
  Board, Position, Move, MoveRecord, PieceColor,
  GameMode, Difficulty, PlayerSide, GameStatus, WSMessage, PlayerConfig,
} from '../types'
import { parseFen, boardToFen, applyMove, INITIAL_FEN, findKing } from '../engine/board'
import { getLegalMoves, isInCheck, getGameStatus } from '../engine/rules'
import { moveToNotation, moveToUci, uciToMove } from '../engine/notation'
import { useWebSocket } from './useWebSocket'
import { playMoveSound, playCaptureSound, playCheckSound, playGameOverSound } from '../audio'

interface UseGameOptions {
  gameMode: GameMode | null
  difficulty: Difficulty
  playerSide: PlayerSide
  aiRedDifficulty: Difficulty
  aiBlackDifficulty: Difficulty
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

export function useGame({
  gameMode,
  difficulty,
  playerSide,
  aiRedDifficulty,
  aiBlackDifficulty,
  initialFen,
  redPlayerConfig,
  blackPlayerConfig,
}: UseGameOptions) {
  const resolvedInitialFen = initialFen || INITIAL_FEN
  const [board, setBoard] = useState<Board>(() => parseFen(resolvedInitialFen).board)
  const [currentTurn, setCurrentTurn] = useState<PieceColor>('red')
  const [selectedPos, setSelectedPos] = useState<Position | null>(null)
  const [legalMoves, setLegalMoves] = useState<Position[]>([])
  const [moveHistory, setMoveHistory] = useState<MoveRecord[]>([])
  const [currentMoveIndex, setCurrentMoveIndex] = useState(-1)
  const [uciMoves, setUciMoves] = useState<string[]>([])
  const [gameStatus, setGameStatus] = useState<GameStatus>('playing')
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
      const currentBoard = boardRef.current
      const move = buildMoveFromUci(msg.move, currentBoard)
      if (!move) {
        setAiThinking(false)
        setHintThinking(false)
        return
      }

      if (msg.requestKind === 'hint') {
        setHintMove(move)
        setHintThinking(false)
        return
      }

      const { newBoard, captured } = applyMove(currentBoard, move.from, move.to)
      const notation = moveToNotation(currentBoard, move)
      const nextTurn: PieceColor = turnRef.current === 'red' ? 'black' : 'red'
      const fen = boardToFen(newBoard, nextTurn)
      const source: MoveRecord['source'] = move.piece.color === 'red' ? 'ai-red' : 'ai-black'

      setBoard(newBoard)
      setLastMove(move)
      setCurrentTurn(nextTurn)
      setHintMove(null)
      setUciMoves(prev => [...prev, msg.move])
      setMoveHistory(prev => {
        const updated = [...prev, { move, notation, fen, elapsedMs: msg.elapsedMs, source }]
        setCurrentMoveIndex(updated.length - 1)
        return updated
      })
      setSelectedPos(null)
      setLegalMoves([])
      setAiThinking(false)

      const status = getGameStatus(newBoard, nextTurn)
      setGameStatus(status)

      if (status !== 'playing') {
        playGameOverSound()
      } else if (isInCheck(newBoard, nextTurn)) {
        playCheckSound()
      } else if (captured) {
        playCaptureSound()
      } else {
        playMoveSound()
      }
    } else if (msg.type === 'info') {
      setEvaluation(msg.data.score)
      setBestLine(msg.data.pv)
      setAnalysisDepth(msg.data.depth)
    } else if (msg.type === 'error') {
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
    setBoard(initBoard)
    setCurrentTurn(turn)
    setSelectedPos(null)
    setLegalMoves([])
    setMoveHistory([])
    setCurrentMoveIndex(-1)
    setUciMoves([])
    setGameStatus('playing')
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
  }, [gameMode, difficulty, playerSide, aiRedDifficulty, aiBlackDifficulty, resolvedInitialFen, redPlayerConfig, blackPlayerConfig])

  // Send init to server whenever connected or difficulty changes
  useEffect(() => {
    if (!gameMode || !connected) return
    send({ type: 'init', difficulty })
  }, [connected, difficulty, gameMode, send])

  // Trigger AI move
  useEffect(() => {
    if (gameStatus !== 'playing') return
    if (aiThinking) return
    if (gameMode === 'ai-vs-ai') return
    if (currentPlayerConfig.type !== 'ai') return
    if (!connected) return

    setAiThinking(true)
    const sent = send({
      type: 'move',
      fen: resolvedInitialFen,
      moves: uciMoves,
      difficulty: currentPlayerConfig.difficulty || difficulty,
    })
    if (!sent) {
      setAiThinking(false)
    }
  }, [gameStatus, aiThinking, gameMode, currentPlayerConfig, connected, send, resolvedInitialFen, uciMoves, difficulty])

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

        const status = getGameStatus(newBoard, nextTurn)
        setGameStatus(status)

        if (status !== 'playing') {
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
    } else {
      const record = moveHistory[targetIndex]
      const { board: prevBoard, turn } = parseFen(record.fen)
      setBoard(prevBoard)
      setCurrentTurn(turn)
      setLastMove(record.move)
    }

    setCurrentMoveIndex(targetIndex)
    setUciMoves(uciMoves.slice(0, targetIndex + 1))
    setSelectedPos(null)
    setLegalMoves([])
    setGameStatus('playing')
    setAiThinking(false)
    setHintThinking(false)
    setHintMove(null)
  }, [currentMoveIndex, moveHistory, gameMode, uciMoves, players, resolvedInitialFen])

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
    setUciMoves(uciMoves.slice(0, targetIndex + 1))
    setSelectedPos(null)
    setLegalMoves([])
    setHintMove(null)

    const status = getGameStatus(nextBoard, turn)
    setGameStatus(status)
  }, [currentMoveIndex, moveHistory, gameMode, uciMoves, players])

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
    setSelectedPos(null)
    setLegalMoves([])
    setHintMove(null)
  }, [moveHistory])

  const getCurrentFen = useCallback(() => {
    return boardToFen(board, currentTurn, Math.floor((currentMoveIndex + 2) / 2))
  }, [board, currentTurn, currentMoveIndex])

  const loadFen = useCallback((fen: string) => {
    try {
      const { board: newBoard, turn } = parseFen(fen)
      setBoard(newBoard)
      setCurrentTurn(turn)
      setSelectedPos(null)
      setLegalMoves([])
      setMoveHistory([])
      setCurrentMoveIndex(-1)
      setUciMoves([])
      setGameStatus('playing')
      setLastMove(null)
      setAiThinking(false)
      setHintThinking(false)
      setHintMove(null)
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
    const sent = send({ type: 'hint', fen: resolvedInitialFen, moves: uciMoves, difficulty: 'master' })
    if (!sent) {
      setHintThinking(false)
    }
  }, [connected, gameStatus, aiThinking, hintThinking, currentPlayerConfig, send, uciMoves, resolvedInitialFen])

  const nextAiMove = useCallback(() => {
    if (gameMode !== 'ai-vs-ai') return
    if (!connected || gameStatus !== 'playing' || aiThinking) return

    const difficultyForTurn = currentTurn === 'red' ? aiRedDifficulty : aiBlackDifficulty
    setAiThinking(true)
    setHintMove(null)
    const sent = send({ type: 'move', fen: resolvedInitialFen, moves: uciMoves, difficulty: difficultyForTurn })
    if (!sent) {
      setAiThinking(false)
    }
  }, [gameMode, connected, gameStatus, aiThinking, currentTurn, aiRedDifficulty, aiBlackDifficulty, send, uciMoves, resolvedInitialFen])

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
    evaluation,
    bestLine,
    analysisDepth,
    moveRecords: moveHistory,
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
