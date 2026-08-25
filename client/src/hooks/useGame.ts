import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Board,
  Position,
  Move,
  MoveRecord,
  PieceColor,
  GameMode,
  Difficulty,
  PlayerSide,
  GameStatus,
  GameStatusReason,
  WSMessage,
  PlayerConfig,
  AnalysisPoint,
  MoveCandidate,
  EngineSearchLimit,
  BoardAnnotation,
  EngineRuntimeOptions,
  ReviewPosition,
  VariationTree,
  NodeAnalysis,
} from '../types'
import { parseFen, boardToFen, applyMove, INITIAL_FEN, findKing } from '../engine/board'
import { getLegalMoves, isInCheck, getGameStatusDetail } from '../engine/rules'
import { moveToNotation, moveToUci, uciToMove } from '../engine/notation'
import { validateFenPosition } from '../engine/validation'
import { getAutomaticGameStatus } from '../engine/drawRules'
import {
  JIEQI_INITIAL_FEN,
  applyJieqiMove,
  cloneJieqiSnapshot,
  createJieqiInitialBoard,
  encodeJieqiHistory,
  encodeJieqiMove,
  formatJieqiNotation,
} from '../engine/jieqi'
import { useWebSocket } from './useWebSocket'
import {
  canNavigateHistory,
  getManualDrawStatus,
  getRedoTargetIndex,
  getResignationStatus,
  getUndoTargetIndex,
  sendStopForActiveEngineRequests,
  shouldAutoRequestAiMove,
} from './gameFlow'
import { playMoveSound, playCaptureSound, playCheckSound, playGameOverSound } from '../audio'
import {
  addVariationMove,
  buildNodeAnalysisTaskEntries,
  countVariationBranches,
  createVariationTree,
  deleteVariationBranch,
  deriveAnalysisPoints,
  getNodeIdAtMoveIndex,
  getVariationLine,
  hasReusableNodeAnalysis,
  migrateAnalysisPointsToTree,
  NodeAnalysisTaskEntry,
  selectVariationNode,
  setMainVariation,
  setVariationAnalysis,
  shouldAcceptAnalysisInfo,
  shouldAcceptNodeAnalysisTaskEntry,
  updateVariationAnnotations,
  updateVariationMove,
} from '../variations/tree'
import { MAX_NODE_ANNOTATIONS } from '../annotations/model'

interface UseGameOptions {
  gameMode: GameMode | null
  gameId?: string
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
  initialVariationTree?: VariationTree
  initialJieqiBoard?: Board
  initialGameStatus?: GameStatus
  initialGameStatusReason?: GameStatusReason
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

  if (gameMode === 'human-vs-ai' || gameMode === 'jieqi') {
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

function uciListFromRecords(records: MoveRecord[], viewer?: PieceColor): string[] {
  if (
    viewer &&
    records.some((record) => record.move.piece.hidden || record.move.captured?.hidden)
  ) {
    return encodeJieqiHistory(records, viewer)
  }
  return records.map((record) =>
    record.move.piece.hidden || record.move.captured?.hidden
      ? encodeJieqiMove(record.move, false)
      : moveToUci(record.move.from, record.move.to),
  )
}

type PendingEngineRequest = {
  id: string
  kind: 'move' | 'hint'
  fen: string
  movesKey: string
}

type PendingAnalysisRequest = {
  id: string
  movesKey: string
  /** 分析发起时对应的变招节点,info 结果写回该节点。 */
  nodeId: string
  /** 分析发起时的行棋方,用于把引擎分值转成红方视角。 */
  turn: PieceColor
  searchLimit: EngineSearchLimit | undefined
  engineThreads: number | 'auto' | undefined
  engineHashMb: number | undefined
}

type PendingReviewRequest = {
  id: string
  movesKey: string
  entries: NodeAnalysisTaskEntry[]
}

type PendingNodeAnalysisTask = {
  id: string
  kind: 'node' | 'branch'
  entries: NodeAnalysisTaskEntry[]
  cachedCount: number
  total: number
  searchLimit: EngineSearchLimit | undefined
  engineThreads: number | 'auto' | undefined
  engineHashMb: number | undefined
}

const MAX_NODE_ANALYSIS_COUNT = 200

function makeRequestId(kind: string): string {
  return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function parseInitialGameState(fen: string) {
  const parsed = parseFen(fen)
  return { board: parsed.board, turn: parsed.turn }
}

function getResolvedGameStatus(
  board: Board,
  turn: PieceColor,
  variant: 'xiangqi' | 'jieqi',
  gameMode: GameMode | null,
  initialFen: string,
  records: MoveRecord[],
) {
  const terminal = getGameStatusDetail(board, turn, variant)
  if (terminal.status !== 'playing') return terminal
  const appliesAutomaticDraw =
    gameMode === 'human-vs-ai' || gameMode === 'human-vs-human' || gameMode === 'ai-vs-ai'
  if (!appliesAutomaticDraw || variant === 'jieqi') return terminal
  return getAutomaticGameStatus(initialFen, records) || terminal
}

export function useGame({
  gameMode,
  gameId,
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
  initialVariationTree,
  initialJieqiBoard,
  initialGameStatus,
  initialGameStatusReason,
  redPlayerConfig,
  blackPlayerConfig,
}: UseGameOptions) {
  const isJieqi = gameMode === 'jieqi'
  const engineVariant = isJieqi ? ('jieqi' as const) : ('xiangqi' as const)
  const resolvedInitialFen = isJieqi ? JIEQI_INITIAL_FEN : initialFen || INITIAL_FEN
  const [engineBaseFen, setEngineBaseFen] = useState(resolvedInitialFen)
  const [board, setBoard] = useState<Board>(() => parseInitialGameState(resolvedInitialFen).board)
  const [currentTurn, setCurrentTurn] = useState<PieceColor>(
    () => parseInitialGameState(resolvedInitialFen).turn,
  )
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
  const [moveCandidates, setMoveCandidates] = useState<MoveCandidate[]>([])
  const [aiThinking, setAiThinking] = useState(false)
  const [hintThinking, setHintThinking] = useState(false)
  const [candidateThinking, setCandidateThinking] = useState(false)
  const [reviewThinking, setReviewThinking] = useState(false)
  const [reviewProgress, setReviewProgress] = useState({
    completed: 0,
    total: 0,
  })
  const [reviewPositions, setReviewPositions] = useState<ReviewPosition[]>([])
  const [reviewedMovesKey, setReviewedMovesKey] = useState('')
  const [nodeAnalysisThinking, setNodeAnalysisThinking] = useState(false)
  const [nodeAnalysisProgress, setNodeAnalysisProgress] = useState({
    completed: 0,
    total: 0,
    cached: 0,
  })
  const [nodeAnalysisStatus, setNodeAnalysisStatus] = useState('')
  const [variationTree, setVariationTree] = useState<VariationTree>(() =>
    createVariationTree(resolvedInitialFen, [], -1),
  )
  const [activeVariationNodeIds, setActiveVariationNodeIds] = useState<string[]>([])
  const [hintMove, setHintMove] = useState<Move | null>(null)
  const [engineAvailable, setEngineAvailable] = useState<boolean | null>(null)
  const [engineStatusMessage, setEngineStatusMessage] = useState('')
  const [initializedMode, setInitializedMode] = useState<GameMode | null>(null)
  const [leaseStatus, setLeaseStatus] = useState<'none' | 'requesting' | 'granted' | 'readonly'>(
    gameId ? 'requesting' : 'none',
  )
  const [leaseToken, setLeaseToken] = useState<string | null>(null)
  const jieqiInitialBoardRef = useRef<Board | null>(null)
  const leaseRequestRef = useRef<string | null>(null)
  const canEditRef = useRef(!gameId)

  const boardRef = useRef(board)
  boardRef.current = board
  const turnRef = useRef(currentTurn)
  turnRef.current = currentTurn
  const uciMovesRef = useRef(uciMoves)
  uciMovesRef.current = uciMoves
  const currentMoveIndexRef = useRef(currentMoveIndex)
  currentMoveIndexRef.current = currentMoveIndex
  const pendingRequestRef = useRef<PendingEngineRequest | null>(null)
  const analysisRequestRef = useRef<PendingAnalysisRequest | null>(null)
  const candidateRequestRef = useRef<{ id: string; movesKey: string } | null>(null)
  const reviewRequestRef = useRef<PendingReviewRequest | null>(null)
  const nodeAnalysisTaskRef = useRef<PendingNodeAnalysisTask | null>(null)
  const variationTreeRef = useRef(variationTree)
  variationTreeRef.current = variationTree
  const activeVariationNodeIdsRef = useRef(activeVariationNodeIds)
  activeVariationNodeIdsRef.current = activeVariationNodeIds
  const canEditGame = !gameId || leaseStatus === 'granted'
  canEditRef.current = canEditGame
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

  const translatePv = useCallback(
    (pv: string[], currentBoard: Board): string[] => {
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
    },
    [buildMoveFromUci],
  )

  const commitVariationMove = useCallback((record: MoveRecord, parentMoveIndex: number) => {
    const currentTree = variationTreeRef.current
    const parentId = getNodeIdAtMoveIndex(
      currentTree,
      activeVariationNodeIdsRef.current,
      parentMoveIndex,
    )
    const added = addVariationMove(currentTree, parentId || currentTree.rootId, record)
    const line = getVariationLine(added.tree, added.nodeId)
    variationTreeRef.current = added.tree
    activeVariationNodeIdsRef.current = line.nodeIds
    setVariationTree(added.tree)
    setActiveVariationNodeIds(line.nodeIds)
    return line
  }, [])

  const handleWsMessage = useCallback(
    (msg: WSMessage) => {
      if (msg.type === 'game-lease') {
        if (msg.gameId !== gameId || (msg.requestId && msg.requestId !== leaseRequestRef.current))
          return
        leaseRequestRef.current = null
        setLeaseStatus(msg.status)
        setLeaseToken(msg.leaseToken || null)
      } else if (msg.type === 'game-lease-lost') {
        if (msg.gameId !== gameId) return
        setLeaseStatus('readonly')
        setLeaseToken(null)
        pendingRequestRef.current = null
        setAiThinking(false)
      } else if (msg.type === 'bestmove') {
        if (!canEditRef.current && pendingRequestRef.current?.kind === 'move') return
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

        setEngineAvailable(true)

        const currentBoard = boardRef.current
        const move = buildMoveFromUci(msg.move, currentBoard)
        if (!move) {
          pendingRequestRef.current = null
          setAiThinking(false)
          setHintThinking(false)
          return
        }

        const legalTargets = getLegalMoves(currentBoard, move.from, engineVariant)
        const isLegal =
          move.piece.color === turnRef.current &&
          legalTargets.some((to) => to.row === move.to.row && to.col === move.to.col)
        if (!isLegal) {
          pendingRequestRef.current = null
          setAiThinking(false)
          setHintThinking(false)
          return
        }

        if (pending.kind === 'hint') {
          setHintMove(move)
          setEngineStatusMessage(
            msg.searchCapped ? '提示达到 60 秒上限，已采用当前最佳结果' : 'Engine ready',
          )
          pendingRequestRef.current = null
          setHintThinking(false)
          return
        }

        const { newBoard, captured } = isJieqi
          ? applyJieqiMove(currentBoard, move.from, move.to)
          : applyMove(currentBoard, move.from, move.to)
        const notation = isJieqi
          ? formatJieqiNotation(currentBoard, move)
          : moveToNotation(currentBoard, move)
        const nextTurn: PieceColor = turnRef.current === 'red' ? 'black' : 'red'
        const fen = isJieqi ? engineBaseFen : boardToFen(newBoard, nextTurn)
        const source: MoveRecord['source'] = move.piece.color === 'red' ? 'ai-red' : 'ai-black'

        const historyIdx = currentMoveIndexRef.current

        setBoard(newBoard)
        setLastMove(move)
        setCurrentTurn(nextTurn)
        setHintMove(null)
        const variationLine = commitVariationMove(
          {
            move,
            notation,
            fen,
            elapsedMs: msg.elapsedMs,
            source,
            snapshot: isJieqi ? cloneJieqiSnapshot(newBoard, nextTurn) : undefined,
          },
          historyIdx,
        )
        setUciMoves(
          uciListFromRecords(
            variationLine.records.slice(0, variationLine.currentMoveIndex + 1),
            isJieqi ? nextTurn : undefined,
          ),
        )
        setMoveHistory(variationLine.records)
        setCurrentMoveIndex(variationLine.currentMoveIndex)
        setSelectedPos(null)
        setLegalMoves([])
        setMoveCandidates([])
        setCandidateThinking(false)
        setAiThinking(false)
        setEngineStatusMessage(
          msg.searchCapped ? '思考达到 60 秒上限，已采用当前最佳着法' : 'Engine ready',
        )
        pendingRequestRef.current = null
        candidateRequestRef.current = null

        const statusDetail = getResolvedGameStatus(
          newBoard,
          nextTurn,
          engineVariant,
          gameMode,
          engineBaseFen,
          variationLine.records.slice(0, variationLine.currentMoveIndex + 1),
        )
        setGameStatus(statusDetail.status)
        setGameStatusReason(statusDetail.reason)

        if (statusDetail.status !== 'playing') {
          playGameOverSound()
        } else if (isInCheck(newBoard, nextTurn, engineVariant)) {
          playCheckSound()
        } else if (captured) {
          playCaptureSound()
        } else {
          playMoveSound()
        }
      } else if (msg.type === 'info') {
        if (isJieqi) return
        if (
          !shouldAcceptAnalysisInfo(
            analysisRequestRef.current,
            msg.requestId,
            uciMovesRef.current.join(' '),
          )
        ) {
          return
        }
        const currentAnalysis = analysisRequestRef.current!
        const redPerspectiveScore =
          currentAnalysis.turn === 'red' ? msg.data.score : -msg.data.score
        setEvaluation(redPerspectiveScore)
        setBestLine(msg.data.pv)
        setAnalysisDepth(msg.data.depth)
        const nodeAnalysis: NodeAnalysis = {
          complete: false,
          score: redPerspectiveScore,
          depth: msg.data.depth,
          bestMove: msg.data.pv[0],
          pv: msg.data.pv,
          searchLimit: currentAnalysis.searchLimit,
          engineThreads: currentAnalysis.engineThreads,
          engineHashMb: currentAnalysis.engineHashMb,
          updatedAt: Date.now(),
        }
        const currentTree = variationTreeRef.current
        if (currentTree.nodes[currentAnalysis.nodeId]) {
          const existing = currentTree.nodes[currentAnalysis.nodeId].analysis
          if (
            !hasReusableNodeAnalysis(
              existing,
              currentAnalysis.searchLimit,
              currentAnalysis.engineThreads,
              currentAnalysis.engineHashMb,
            )
          ) {
            const nextTree = setVariationAnalysis(currentTree, currentAnalysis.nodeId, nodeAnalysis)
            variationTreeRef.current = nextTree
            setVariationTree(nextTree)
          }
        }
      } else if (msg.type === 'engine-status') {
        setEngineAvailable(msg.available)
        setEngineStatusMessage(
          msg.message || (msg.available ? 'Engine ready' : 'Engine not available'),
        )
      } else if (msg.type === 'candidates') {
        if (isJieqi) return
        const currentRequest = candidateRequestRef.current
        if (
          !currentRequest ||
          (msg.requestId && msg.requestId !== currentRequest.id) ||
          currentRequest.movesKey !== uciMovesRef.current.join(' ')
        ) {
          return
        }
        const currentBoard = boardRef.current
        setMoveCandidates(
          (msg.candidates || []).map((candidate) => {
            const move = buildMoveFromUci(candidate.move, currentBoard)
            return {
              ...candidate,
              score: turnRef.current === 'red' ? candidate.score : -candidate.score,
              notation: move ? moveToNotation(currentBoard, move) : candidate.move,
              pvNotation: translatePv(candidate.pv, currentBoard),
            }
          }),
        )
        setCandidateThinking(false)
        candidateRequestRef.current = null
      } else if (msg.type === 'review-progress') {
        const request = reviewRequestRef.current
        if (!request || msg.requestId !== request.id) return
        setReviewProgress({ completed: msg.completed, total: msg.total })
      } else if (msg.type === 'review-result') {
        const request = reviewRequestRef.current
        if (!request || msg.requestId !== request.id) return
        const currentLine = getVariationLine(variationTreeRef.current)
        if (uciListFromRecords(currentLine.records).join(' ') !== request.movesKey) {
          setReviewThinking(false)
          reviewRequestRef.current = null
          return
        }
        const entryByMoveIndex = new Map(request.entries.map((entry) => [entry.moveIndex, entry]))
        const positions = msg.positions.flatMap((position) => {
          const entry = entryByMoveIndex.get(position.moveIndex)
          return entry && shouldAcceptNodeAnalysisTaskEntry(variationTreeRef.current, entry)
            ? [{ ...position, nodeId: entry.nodeId }]
            : []
        })
        setReviewPositions(positions)
        setReviewedMovesKey(request.movesKey)
        setReviewProgress({
          completed: positions.length,
          total: request.entries.length,
        })
        setReviewThinking(false)
        reviewRequestRef.current = null
      } else if (msg.type === 'node-analysis-progress') {
        const request = nodeAnalysisTaskRef.current
        if (!request || msg.requestId !== request.id) return
        setNodeAnalysisProgress({
          completed: request.cachedCount + msg.completed,
          total: request.total,
          cached: request.cachedCount,
        })
      } else if (msg.type === 'node-analysis-result') {
        const request = nodeAnalysisTaskRef.current
        if (!request || msg.requestId !== request.id) return
        const byMoveIndex = new Map(msg.positions.map((position) => [position.moveIndex, position]))
        let nextTree = variationTreeRef.current
        let writtenCount = 0
        request.entries.forEach((entry) => {
          const position = byMoveIndex.get(entry.moveIndex)
          if (!position || !shouldAcceptNodeAnalysisTaskEntry(nextTree, entry)) return
          nextTree = setVariationAnalysis(nextTree, entry.nodeId, {
            complete: true,
            score: position.evaluation,
            depth: position.depth,
            bestMove: position.bestMove,
            pv: position.pv,
            searchLimit: request.searchLimit,
            engineThreads: request.engineThreads,
            engineHashMb: request.engineHashMb,
            updatedAt: Date.now(),
          })
          writtenCount++
        })
        variationTreeRef.current = nextTree
        setVariationTree(nextTree)
        const currentAnalysis = nextTree.nodes[nextTree.currentNodeId]?.analysis
        if (currentAnalysis) {
          setEvaluation(currentAnalysis.score)
          setBestLine(currentAnalysis.pv || [])
          setAnalysisDepth(currentAnalysis.depth)
        }
        setNodeAnalysisThinking(false)
        setNodeAnalysisProgress({
          completed: request.cachedCount + writtenCount,
          total: request.total,
          cached: request.cachedCount,
        })
        setNodeAnalysisStatus(
          `${request.kind === 'branch' ? '当前分支' : '当前节点'}分析完成${
            request.cachedCount > 0 ? `，复用 ${request.cachedCount} 个缓存` : ''
          }`,
        )
        nodeAnalysisTaskRef.current = null
      } else if (msg.type === 'error') {
        setEngineStatusMessage(msg.message)
        if (msg.message.toLowerCase().includes('engine')) {
          setEngineAvailable(false)
        }
        pendingRequestRef.current = null
        candidateRequestRef.current = null
        reviewRequestRef.current = null
        if (nodeAnalysisTaskRef.current?.id === msg.requestId) {
          nodeAnalysisTaskRef.current = null
          setNodeAnalysisThinking(false)
          setNodeAnalysisStatus('节点分析失败，请检查引擎状态后重试')
        }
        setAiThinking(false)
        setHintThinking(false)
        setCandidateThinking(false)
        setReviewThinking(false)
      }
    },
    [
      buildMoveFromUci,
      commitVariationMove,
      engineBaseFen,
      engineVariant,
      gameId,
      gameMode,
      isJieqi,
      translatePv,
    ],
  )

  const { send, connected, connectionState } = useWebSocket(handleWsMessage)

  useEffect(() => {
    if (!gameId) {
      setLeaseStatus('none')
      setLeaseToken(null)
      return
    }
    if (!connected) {
      setLeaseStatus('requesting')
      setLeaseToken(null)
      return
    }
    const requestId = makeRequestId('claim-game')
    leaseRequestRef.current = requestId
    setLeaseStatus('requesting')
    send({ type: 'claim-game', requestId, gameId })
    return () => {
      send({ type: 'release-game', gameId })
    }
  }, [connected, gameId, send])

  useEffect(() => {
    if (connectionState !== 'disconnected') return

    pendingRequestRef.current = null
    analysisRequestRef.current = null
    candidateRequestRef.current = null
    reviewRequestRef.current = null
    nodeAnalysisTaskRef.current = null
    setAiThinking(false)
    setHintThinking(false)
    setCandidateThinking(false)
    setReviewThinking(false)
    setNodeAnalysisThinking(false)
    setEngineStatusMessage('后端连接已断开，重连后将恢复计算')
  }, [connectionState])

  // Initialize game when mode changes (not when connection flickers)
  const prevGameMode = useRef<GameMode | null | undefined>(undefined)
  const prevDifficulty = useRef<Difficulty | undefined>(undefined)
  const prevPlayerSide = useRef<PlayerSide | undefined>(undefined)
  const prevInitialFen = useRef<string | undefined>(undefined)
  const prevInitialMoveRecords = useRef<MoveRecord[] | undefined>(undefined)
  const prevInitialCurrentMoveIndex = useRef<number | undefined>(undefined)
  const prevInitialVariationTree = useRef<VariationTree | undefined>(undefined)
  const prevInitialJieqiBoard = useRef<Board | undefined>(undefined)
  const prevInitialGameStatus = useRef<GameStatus | undefined>(undefined)
  const prevInitialGameStatusReason = useRef<GameStatusReason | undefined>(undefined)
  const prevRedPlayerConfig = useRef<PlayerConfig | undefined>(undefined)
  const prevBlackPlayerConfig = useRef<PlayerConfig | undefined>(undefined)

  useEffect(() => {
    if (!gameMode) {
      prevGameMode.current = null
      setInitializedMode(null)
      return
    }

    const modeChanged = prevGameMode.current !== gameMode
    const diffChanged = prevDifficulty.current !== difficulty
    const sideChanged = prevPlayerSide.current !== playerSide
    const fenChanged = prevInitialFen.current !== resolvedInitialFen
    const recordsChanged = prevInitialMoveRecords.current !== initialMoveRecords
    const indexChanged = prevInitialCurrentMoveIndex.current !== initialCurrentMoveIndex
    const variationTreeChanged = prevInitialVariationTree.current !== initialVariationTree
    const jieqiBoardChanged = prevInitialJieqiBoard.current !== initialJieqiBoard
    const initialStatusChanged =
      prevInitialGameStatus.current !== initialGameStatus ||
      prevInitialGameStatusReason.current !== initialGameStatusReason
    const redConfigChanged = prevRedPlayerConfig.current !== redPlayerConfig
    const blackConfigChanged = prevBlackPlayerConfig.current !== blackPlayerConfig

    prevGameMode.current = gameMode
    prevDifficulty.current = difficulty
    prevPlayerSide.current = playerSide
    prevInitialFen.current = resolvedInitialFen
    prevInitialMoveRecords.current = initialMoveRecords
    prevInitialCurrentMoveIndex.current = initialCurrentMoveIndex
    prevInitialVariationTree.current = initialVariationTree
    prevInitialJieqiBoard.current = initialJieqiBoard
    prevInitialGameStatus.current = initialGameStatus
    prevInitialGameStatusReason.current = initialGameStatusReason
    prevRedPlayerConfig.current = redPlayerConfig
    prevBlackPlayerConfig.current = blackPlayerConfig

    if (
      !modeChanged &&
      !diffChanged &&
      !sideChanged &&
      !fenChanged &&
      !recordsChanged &&
      !indexChanged &&
      !variationTreeChanged &&
      !jieqiBoardChanged &&
      !initialStatusChanged &&
      !redConfigChanged &&
      !blackConfigChanged
    )
      return

    const legacyRecords = initialMoveRecords || []
    const baseTree =
      initialVariationTree ||
      createVariationTree(
        resolvedInitialFen,
        legacyRecords,
        initialCurrentMoveIndex ?? legacyRecords.length - 1,
      )
    const restoredTree = migrateAnalysisPointsToTree(baseTree, initialAnalysisPoints || [])
    const restoredLine = getVariationLine(restoredTree)
    const restoredRecords = restoredLine.records
    const restoredIndex = restoredLine.currentMoveIndex
    const restoredFen = restoredIndex >= 0 ? restoredRecords[restoredIndex].fen : resolvedInitialFen
    const jieqiBoard = isJieqi
      ? initialJieqiBoard
        ? cloneJieqiSnapshot(initialJieqiBoard, 'red').board
        : createJieqiInitialBoard()
      : null
    if (jieqiBoard) jieqiInitialBoardRef.current = jieqiBoard
    const restoredSnapshot =
      isJieqi && restoredIndex >= 0 ? restoredRecords[restoredIndex].snapshot : undefined
    const { board: initBoard, turn } =
      restoredSnapshot ||
      (isJieqi ? { board: jieqiBoard!, turn: 'red' as const } : parseFen(restoredFen))
    setEngineBaseFen(resolvedInitialFen)
    setBoard(initBoard)
    setCurrentTurn(turn)
    setSelectedPos(null)
    setLegalMoves([])
    setMoveHistory(restoredRecords)
    setCurrentMoveIndex(restoredIndex)
    setUciMoves(
      uciListFromRecords(restoredRecords.slice(0, restoredIndex + 1), isJieqi ? turn : undefined),
    )
    setVariationTree(restoredTree)
    variationTreeRef.current = restoredTree
    setActiveVariationNodeIds(restoredLine.nodeIds)
    activeVariationNodeIdsRef.current = restoredLine.nodeIds
    const statusDetail = getResolvedGameStatus(
      initBoard,
      turn,
      engineVariant,
      gameMode,
      resolvedInitialFen,
      restoredRecords.slice(0, restoredIndex + 1),
    )
    const persistedTerminal = initialGameStatus && initialGameStatus !== 'playing'
    setGameStatus(persistedTerminal ? initialGameStatus : statusDetail.status)
    setGameStatusReason(persistedTerminal ? initialGameStatusReason : statusDetail.reason)
    setLastMove(null)
    setEvaluation(null)
    setBestLine([])
    setAnalysisDepth(0)
    setMoveCandidates([])
    setFlipped(gameMode === 'human-vs-ai' || gameMode === 'jieqi' ? playerSide === 'black' : false)
    setAiThinking(false)
    setHintThinking(false)
    setCandidateThinking(false)
    setReviewThinking(false)
    setReviewProgress({ completed: 0, total: 0 })
    setReviewPositions([])
    setReviewedMovesKey('')
    setNodeAnalysisThinking(false)
    setNodeAnalysisProgress({ completed: 0, total: 0, cached: 0 })
    setNodeAnalysisStatus('')
    setHintMove(null)
    setEngineAvailable(null)
    setEngineStatusMessage('')
    setInitializedMode(gameMode)
    pendingRequestRef.current = null
    analysisRequestRef.current = null
    candidateRequestRef.current = null
    reviewRequestRef.current = null
    nodeAnalysisTaskRef.current = null
  }, [
    gameMode,
    difficulty,
    playerSide,
    aiRedDifficulty,
    aiBlackDifficulty,
    resolvedInitialFen,
    initialMoveRecords,
    initialCurrentMoveIndex,
    initialAnalysisPoints,
    initialVariationTree,
    initialJieqiBoard,
    initialGameStatus,
    initialGameStatusReason,
    redPlayerConfig,
    blackPlayerConfig,
    engineVariant,
    isJieqi,
  ])

  useEffect(() => {
    if (!connected) {
      setEngineAvailable(null)
      setEngineStatusMessage('')
      setAiThinking(false)
      setHintThinking(false)
      setCandidateThinking(false)
      setReviewThinking(false)
      setNodeAnalysisThinking(false)
      pendingRequestRef.current = null
      analysisRequestRef.current = null
      candidateRequestRef.current = null
      reviewRequestRef.current = null
      nodeAnalysisTaskRef.current = null
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
    send({
      type: 'init',
      difficulty,
      variant: engineVariant,
      ...engineRuntimeOptions,
    })
  }, [connected, difficulty, engineRuntimeOptions, engineVariant, gameMode, send])

  useEffect(() => {
    if (!gameMode || isJieqi || initializedMode !== gameMode || !connected || !analysisEnabled)
      return

    const currentNodeId =
      getNodeIdAtMoveIndex(
        variationTreeRef.current,
        activeVariationNodeIdsRef.current,
        currentMoveIndexRef.current,
      ) ?? variationTreeRef.current.rootId
    const engineThreads = engineRuntimeOptions?.engineThreads
    const engineHashMb = engineRuntimeOptions?.engineHashMb

    // 同配置分析默认直接复用，避免重复启动引擎任务。
    const existing = variationTreeRef.current.nodes[currentNodeId]?.analysis
    const hasFreshCache = hasReusableNodeAnalysis(
      existing,
      searchLimit,
      engineThreads,
      engineHashMb,
    )
    if (hasFreshCache && existing) {
      setEvaluation(existing.score)
      setBestLine(existing.pv || [])
      setAnalysisDepth(existing.depth)
      return
    } else {
      setEvaluation(null)
      setBestLine([])
      setAnalysisDepth(0)
    }
    const requestId = makeRequestId('analyze')
    analysisRequestRef.current = {
      id: requestId,
      movesKey: uciMoves.join(' '),
      nodeId: currentNodeId,
      turn: turnRef.current,
      searchLimit,
      engineThreads,
      engineHashMb,
    }
    send({
      type: 'analyze',
      requestId,
      fen: engineBaseFen,
      moves: uciMoves,
      variant: engineVariant,
      ...searchLimit,
    })

    return () => {
      send({ type: 'stop', requestId })
      if (analysisRequestRef.current?.id === requestId) {
        analysisRequestRef.current = null
      }
    }
  }, [
    analysisEnabled,
    connected,
    engineBaseFen,
    engineRuntimeOptions,
    engineVariant,
    gameMode,
    initializedMode,
    isJieqi,
    send,
    uciMoves,
    searchLimit,
  ])

  useEffect(() => {
    if (!aiThinking) return

    const requestId =
      pendingRequestRef.current?.kind === 'move' ? pendingRequestRef.current.id : undefined
    if (!requestId) return

    const timer = window.setTimeout(() => {
      if (pendingRequestRef.current?.id !== requestId) return
      if (connected) send({ type: 'stop', requestId })
      pendingRequestRef.current = null
      candidateRequestRef.current = null
      setAiThinking(false)
      setEngineAvailable(false)
      setEngineStatusMessage('AI 思考超时，已停止本次计算，请重试')
    }, 70_000)

    return () => window.clearTimeout(timer)
  }, [aiThinking, connected, send])

  // Trigger AI move
  useEffect(() => {
    if (
      !canEditGame ||
      initializedMode !== gameMode ||
      reviewThinking ||
      nodeAnalysisThinking ||
      engineAvailable === false ||
      !shouldAutoRequestAiMove({
        gameStatus,
        aiThinking,
        gameMode,
        currentPlayer: currentPlayerConfig,
        connected,
      })
    )
      return

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
      variant: engineVariant,
    })
    if (!sent) {
      pendingRequestRef.current = null
      candidateRequestRef.current = null
      setAiThinking(false)
    }
  }, [
    canEditGame,
    gameStatus,
    aiThinking,
    reviewThinking,
    nodeAnalysisThinking,
    gameMode,
    initializedMode,
    currentPlayerConfig,
    connected,
    send,
    engineBaseFen,
    uciMoves,
    difficulty,
    engineAvailable,
    engineVariant,
  ])

  const handleCellClick = useCallback(
    (pos: Position) => {
      if (!canEditGame) return
      if (gameStatus !== 'playing') return
      if (gameMode === 'ai-vs-ai') return
      if (currentPlayerConfig.type === 'ai') return
      if (aiThinking) return
      if (reviewThinking) return
      if (nodeAnalysisThinking) return

      const piece = board[pos.row][pos.col]

      if (selectedPos) {
        const isLegal = legalMoves.some((m) => m.row === pos.row && m.col === pos.col)
        if (isLegal) {
          const selectedPiece = board[selectedPos.row][selectedPos.col]!
          const { newBoard, captured } = isJieqi
            ? applyJieqiMove(board, selectedPos, pos)
            : applyMove(board, selectedPos, pos)
          const move: Move = {
            from: selectedPos,
            to: pos,
            captured: captured || undefined,
            piece: selectedPiece,
          }
          const notation = isJieqi
            ? formatJieqiNotation(board, move, true)
            : moveToNotation(board, move)
          const nextTurn: PieceColor = currentTurn === 'red' ? 'black' : 'red'
          const fen = isJieqi ? engineBaseFen : boardToFen(newBoard, nextTurn)

          const variationLine = commitVariationMove(
            {
              move,
              notation,
              fen,
              source: 'human',
              snapshot: isJieqi ? cloneJieqiSnapshot(newBoard, nextTurn) : undefined,
            },
            currentMoveIndex,
          )
          const newUciMoves = uciListFromRecords(
            variationLine.records.slice(0, variationLine.currentMoveIndex + 1),
            isJieqi ? nextTurn : undefined,
          )

          setBoard(newBoard)
          setLastMove(move)
          setCurrentTurn(nextTurn)
          setHintMove(null)
          setUciMoves(newUciMoves)
          setMoveHistory(variationLine.records)
          setCurrentMoveIndex(variationLine.currentMoveIndex)
          setSelectedPos(null)
          setLegalMoves([])
          setMoveCandidates([])
          setCandidateThinking(false)

          const statusDetail = getResolvedGameStatus(
            newBoard,
            nextTurn,
            engineVariant,
            gameMode,
            engineBaseFen,
            variationLine.records.slice(0, variationLine.currentMoveIndex + 1),
          )
          setGameStatus(statusDetail.status)
          setGameStatusReason(statusDetail.reason)

          if (statusDetail.status !== 'playing') {
            playGameOverSound()
          } else if (isInCheck(newBoard, nextTurn, engineVariant)) {
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
          setLegalMoves(getLegalMoves(board, pos, engineVariant))
          return
        }

        setSelectedPos(null)
        setLegalMoves([])
        return
      }

      if (piece && piece.color === currentTurn) {
        setSelectedPos(pos)
        setLegalMoves(getLegalMoves(board, pos, engineVariant))
      }
    },
    [
      board,
      selectedPos,
      legalMoves,
      currentTurn,
      gameMode,
      currentPlayerConfig,
      gameStatus,
      aiThinking,
      reviewThinking,
      nodeAnalysisThinking,
      currentMoveIndex,
      commitVariationMove,
      engineBaseFen,
      engineVariant,
      isJieqi,
      canEditGame,
    ],
  )

  const inCheck = (() => {
    if (isInCheck(board, currentTurn, engineVariant)) {
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
    setNodeAnalysisThinking(false)
    setHintMove(null)
    setMoveCandidates([])
    pendingRequestRef.current = null
    candidateRequestRef.current = null
    reviewRequestRef.current = null
    nodeAnalysisTaskRef.current = null
  }, [connected, send])

  const setVariationCurrentIndex = useCallback((index: number) => {
    const tree = variationTreeRef.current
    const nodeId = getNodeIdAtMoveIndex(tree, activeVariationNodeIdsRef.current, index)
    if (!nodeId) return
    const nextTree = selectVariationNode(tree, nodeId)
    variationTreeRef.current = nextTree
    setVariationTree(nextTree)
  }, [])

  const undo = useCallback(() => {
    if (!canEditGame) return
    if (!canNavigateHistory(gameMode)) return
    if (currentMoveIndex < 0) return
    const targetIndex = getUndoTargetIndex(currentMoveIndex, gameMode, players)

    if (targetIndex < 0) {
      const { board: initBoard, turn } = isJieqi
        ? {
            board: cloneJieqiSnapshot(jieqiInitialBoardRef.current!, 'red').board,
            turn: 'red' as const,
          }
        : parseFen(engineBaseFen)
      setBoard(initBoard)
      setCurrentTurn(turn)
      setLastMove(null)
      const statusDetail = getResolvedGameStatus(
        initBoard,
        turn,
        engineVariant,
        gameMode,
        engineBaseFen,
        [],
      )
      setGameStatus(statusDetail.status)
      setGameStatusReason(statusDetail.reason)
    } else {
      const record = moveHistory[targetIndex]
      const { board: prevBoard, turn } = record.snapshot || parseFen(record.fen)
      setBoard(prevBoard)
      setCurrentTurn(turn)
      setLastMove(record.move)
      const statusDetail = getResolvedGameStatus(
        prevBoard,
        turn,
        engineVariant,
        gameMode,
        engineBaseFen,
        moveHistory.slice(0, targetIndex + 1),
      )
      setGameStatus(statusDetail.status)
      setGameStatusReason(statusDetail.reason)
    }

    setCurrentMoveIndex(targetIndex)
    setVariationCurrentIndex(targetIndex)
    setUciMoves(uciListFromRecords(moveHistory.slice(0, targetIndex + 1)))
    setSelectedPos(null)
    setLegalMoves([])
    stopActiveRequests()
  }, [
    canEditGame,
    currentMoveIndex,
    moveHistory,
    gameMode,
    players,
    engineBaseFen,
    engineVariant,
    isJieqi,
    setVariationCurrentIndex,
    stopActiveRequests,
  ])

  const redo = useCallback(() => {
    if (!canEditGame) return
    if (!canNavigateHistory(gameMode)) return
    if (currentMoveIndex >= moveHistory.length - 1) return
    const targetIndex = getRedoTargetIndex(currentMoveIndex, moveHistory.length, gameMode, players)

    const record = moveHistory[targetIndex]
    const { board: nextBoard, turn } = record.snapshot || parseFen(record.fen)
    setBoard(nextBoard)
    setCurrentTurn(turn)
    setLastMove(record.move)
    setCurrentMoveIndex(targetIndex)
    setVariationCurrentIndex(targetIndex)
    setUciMoves(uciListFromRecords(moveHistory.slice(0, targetIndex + 1)))
    setSelectedPos(null)
    setLegalMoves([])
    stopActiveRequests()

    const statusDetail = getResolvedGameStatus(
      nextBoard,
      turn,
      engineVariant,
      gameMode,
      engineBaseFen,
      moveHistory.slice(0, targetIndex + 1),
    )
    setGameStatus(statusDetail.status)
    setGameStatusReason(statusDetail.reason)
  }, [
    canEditGame,
    currentMoveIndex,
    moveHistory,
    gameMode,
    players,
    engineBaseFen,
    engineVariant,
    setVariationCurrentIndex,
    stopActiveRequests,
  ])

  const flip = useCallback(() => {
    setFlipped((f) => !f)
  }, [])

  const cancelSelection = useCallback(() => {
    setSelectedPos(null)
    setLegalMoves([])
  }, [])

  const toggleMoveMark = useCallback(
    (index: number) => {
      if (!canEditGame) return
      setMoveHistory((prev) => {
        const next = prev.map((record, i) =>
          i === index ? { ...record, marked: !record.marked } : record,
        )
        const nodeId = getNodeIdAtMoveIndex(
          variationTreeRef.current,
          activeVariationNodeIdsRef.current,
          index,
        )
        if (nodeId && next[index]) {
          const nextTree = updateVariationMove(variationTreeRef.current, nodeId, next[index])
          variationTreeRef.current = nextTree
          setVariationTree(nextTree)
        }
        return next
      })
    },
    [canEditGame],
  )

  const updateMoveNote = useCallback(
    (index: number, note: string) => {
      if (!canEditGame) return
      setMoveHistory((prev) => {
        const next = prev.map((record, i) =>
          i === index ? { ...record, note: note.trim() || undefined } : record,
        )
        const nodeId = getNodeIdAtMoveIndex(
          variationTreeRef.current,
          activeVariationNodeIdsRef.current,
          index,
        )
        if (nodeId && next[index]) {
          const nextTree = updateVariationMove(variationTreeRef.current, nodeId, next[index])
          variationTreeRef.current = nextTree
          setVariationTree(nextTree)
        }
        return next
      })
    },
    [canEditGame],
  )

  const jumpToMove = useCallback(
    (index: number) => {
      if (!canNavigateHistory(gameMode)) return
      if (index < -1 || index >= moveHistory.length) return
      if (index === -1) {
        const { board: initialBoard, turn } = isJieqi
          ? {
              board: cloneJieqiSnapshot(jieqiInitialBoardRef.current!, 'red').board,
              turn: 'red' as const,
            }
          : parseFen(engineBaseFen)
        setBoard(initialBoard)
        setCurrentTurn(turn)
        setLastMove(null)
        setCurrentMoveIndex(-1)
        setVariationCurrentIndex(-1)
        setUciMoves([])
        setSelectedPos(null)
        setLegalMoves([])
        stopActiveRequests()
        const statusDetail = getResolvedGameStatus(
          initialBoard,
          turn,
          engineVariant,
          gameMode,
          engineBaseFen,
          [],
        )
        setGameStatus(statusDetail.status)
        setGameStatusReason(statusDetail.reason)
        return
      }
      const record = moveHistory[index]
      const { board: targetBoard, turn } = record.snapshot || parseFen(record.fen)
      setBoard(targetBoard)
      setCurrentTurn(turn)
      setLastMove(record.move)
      setCurrentMoveIndex(index)
      setVariationCurrentIndex(index)
      setUciMoves(uciListFromRecords(moveHistory.slice(0, index + 1)))
      setSelectedPos(null)
      setLegalMoves([])
      stopActiveRequests()
      const statusDetail = getResolvedGameStatus(
        targetBoard,
        turn,
        engineVariant,
        gameMode,
        engineBaseFen,
        moveHistory.slice(0, index + 1),
      )
      setGameStatus(statusDetail.status)
      setGameStatusReason(statusDetail.reason)
    },
    [
      engineBaseFen,
      gameMode,
      moveHistory,
      engineVariant,
      isJieqi,
      setVariationCurrentIndex,
      stopActiveRequests,
    ],
  )

  const getCurrentFen = useCallback(() => {
    return isJieqi
      ? engineBaseFen
      : boardToFen(board, currentTurn, Math.floor((currentMoveIndex + 2) / 2))
  }, [board, currentTurn, currentMoveIndex, engineBaseFen, isJieqi])

  const loadFen = useCallback(
    (fen: string) => {
      if (!canEditGame) return false
      if (isJieqi) return false
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
        const statusDetail = getResolvedGameStatus(
          newBoard,
          turn,
          'xiangqi',
          gameMode,
          normalizedFen,
          [],
        )
        setGameStatus(statusDetail.status)
        setGameStatusReason(statusDetail.reason)
        setLastMove(null)
        setAiThinking(false)
        setHintThinking(false)
        setHintMove(null)
        setEvaluation(null)
        setBestLine([])
        setAnalysisDepth(0)
        const emptyTree = createVariationTree(normalizedFen, [], -1)
        variationTreeRef.current = emptyTree
        activeVariationNodeIdsRef.current = []
        setVariationTree(emptyTree)
        setActiveVariationNodeIds([])
        stopActiveRequests()
        return true
      } catch {
        return false
      }
    },
    [canEditGame, gameMode, isJieqi, stopActiveRequests],
  )

  const selectVariation = useCallback(
    (nodeId: string) => {
      if (!canEditGame) return
      if (!canNavigateHistory(gameMode)) return
      const selectedTree = selectVariationNode(variationTreeRef.current, nodeId)
      if (selectedTree === variationTreeRef.current) return
      const line = getVariationLine(selectedTree, nodeId)
      const node = selectedTree.nodes[nodeId]
      if (!node) return
      const { board: selectedBoard, turn } = node.move?.snapshot || parseFen(node.fen)
      variationTreeRef.current = selectedTree
      activeVariationNodeIdsRef.current = line.nodeIds
      setVariationTree(selectedTree)
      setActiveVariationNodeIds(line.nodeIds)
      setMoveHistory(line.records)
      setCurrentMoveIndex(line.currentMoveIndex)
      setUciMoves(uciListFromRecords(line.records.slice(0, line.currentMoveIndex + 1)))
      setBoard(selectedBoard)
      setCurrentTurn(turn)
      setLastMove(node.move?.move || null)
      setSelectedPos(null)
      setLegalMoves([])
      stopActiveRequests()
      const statusDetail = getResolvedGameStatus(
        selectedBoard,
        turn,
        engineVariant,
        gameMode,
        engineBaseFen,
        line.records.slice(0, line.currentMoveIndex + 1),
      )
      setGameStatus(statusDetail.status)
      setGameStatusReason(statusDetail.reason)
    },
    [canEditGame, engineBaseFen, engineVariant, gameMode, stopActiveRequests],
  )

  const setMainVariationChild = useCallback(
    (childId: string) => {
      if (!canEditGame) return
      const currentTree = variationTreeRef.current
      const nextTree = setMainVariation(currentTree, currentTree.currentNodeId, childId)
      if (nextTree === currentTree) return
      const line = getVariationLine(nextTree, nextTree.currentNodeId)
      variationTreeRef.current = nextTree
      activeVariationNodeIdsRef.current = line.nodeIds
      setVariationTree(nextTree)
      setActiveVariationNodeIds(line.nodeIds)
      setMoveHistory(line.records)
    },
    [canEditGame],
  )

  const removeVariationBranch = useCallback(
    (nodeId: string) => {
      if (!canEditGame || !canNavigateHistory(gameMode)) return
      const currentTree = variationTreeRef.current
      const nextTree = deleteVariationBranch(currentTree, nodeId)
      if (nextTree === currentTree) return
      stopActiveRequests()
      const line = getVariationLine(nextTree, nextTree.currentNodeId)
      variationTreeRef.current = nextTree
      activeVariationNodeIdsRef.current = line.nodeIds
      setVariationTree(nextTree)
      setActiveVariationNodeIds(line.nodeIds)
      setMoveHistory(line.records)
      setCurrentMoveIndex(line.currentMoveIndex)
      setUciMoves(uciListFromRecords(line.records.slice(0, line.currentMoveIndex + 1)))
      setNodeAnalysisStatus('已删除分支及其节点分析')
    },
    [canEditGame, gameMode, stopActiveRequests],
  )

  const addCurrentNodeAnnotation = useCallback(
    (annotation: BoardAnnotation) => {
      if (!canEditGame || gameMode !== 'study') return
      const currentTree = variationTreeRef.current
      const node = currentTree.nodes[currentTree.currentNodeId]
      if (!node) return
      const annotations = [...(node.annotations || []), annotation].slice(-MAX_NODE_ANNOTATIONS)
      const nextTree = updateVariationAnnotations(currentTree, node.id, annotations)
      variationTreeRef.current = nextTree
      setVariationTree(nextTree)
    },
    [canEditGame, gameMode],
  )

  const removeCurrentNodeAnnotation = useCallback(
    (annotationId: string) => {
      if (!canEditGame || gameMode !== 'study') return
      const currentTree = variationTreeRef.current
      const node = currentTree.nodes[currentTree.currentNodeId]
      if (!node?.annotations?.some((annotation) => annotation.id === annotationId)) return
      const nextTree = updateVariationAnnotations(
        currentTree,
        node.id,
        node.annotations.filter((annotation) => annotation.id !== annotationId),
      )
      variationTreeRef.current = nextTree
      setVariationTree(nextTree)
    },
    [canEditGame, gameMode],
  )

  const undoCurrentNodeAnnotation = useCallback(() => {
    if (!canEditGame || gameMode !== 'study') return
    const currentTree = variationTreeRef.current
    const node = currentTree.nodes[currentTree.currentNodeId]
    if (!node?.annotations?.length) return
    const nextTree = updateVariationAnnotations(currentTree, node.id, node.annotations.slice(0, -1))
    variationTreeRef.current = nextTree
    setVariationTree(nextTree)
  }, [canEditGame, gameMode])

  const clearCurrentNodeAnnotations = useCallback(() => {
    if (!canEditGame || gameMode !== 'study') return
    const currentTree = variationTreeRef.current
    const node = currentTree.nodes[currentTree.currentNodeId]
    if (!node?.annotations?.length) return
    const nextTree = updateVariationAnnotations(currentTree, node.id, [])
    variationTreeRef.current = nextTree
    setVariationTree(nextTree)
  }, [canEditGame, gameMode])

  const requestHint = useCallback(() => {
    if (
      !connected ||
      gameStatus !== 'playing' ||
      aiThinking ||
      hintThinking ||
      candidateThinking ||
      reviewThinking ||
      nodeAnalysisThinking
    )
      return
    if (currentPlayerConfig.type !== 'human') return

    const requestMoves = isJieqi
      ? uciListFromRecords(moveHistory.slice(0, currentMoveIndex + 1), currentTurn)
      : uciMoves
    setHintThinking(true)
    setHintMove(null)
    const requestId = makeRequestId('hint')
    pendingRequestRef.current = {
      id: requestId,
      kind: 'hint',
      fen: engineBaseFen,
      movesKey: requestMoves.join(' '),
    }
    const sent = send({
      type: 'hint',
      requestId,
      fen: engineBaseFen,
      moves: requestMoves,
      difficulty: hintDifficulty,
      variant: engineVariant,
      ...searchLimit,
    })
    if (!sent) {
      pendingRequestRef.current = null
      setHintThinking(false)
    }
  }, [
    connected,
    gameStatus,
    aiThinking,
    hintThinking,
    candidateThinking,
    reviewThinking,
    nodeAnalysisThinking,
    currentPlayerConfig,
    currentMoveIndex,
    currentTurn,
    engineBaseFen,
    engineVariant,
    hintDifficulty,
    isJieqi,
    moveHistory,
    searchLimit,
    send,
    uciMoves,
  ])

  const requestCandidates = useCallback(() => {
    if (
      isJieqi ||
      !connected ||
      gameStatus !== 'playing' ||
      aiThinking ||
      hintThinking ||
      candidateThinking ||
      reviewThinking ||
      nodeAnalysisThinking
    )
      return

    setCandidateThinking(true)
    setMoveCandidates([])
    const requestId = makeRequestId('candidates')
    candidateRequestRef.current = {
      id: requestId,
      movesKey: uciMoves.join(' '),
    }
    const sent = send({
      type: 'candidates',
      requestId,
      fen: engineBaseFen,
      moves: uciMoves,
      difficulty: currentPlayerConfig.difficulty || difficulty,
      count: candidateCount,
      variant: engineVariant,
      ...searchLimit,
    })
    if (!sent) {
      candidateRequestRef.current = null
      setCandidateThinking(false)
    }
  }, [
    connected,
    gameStatus,
    aiThinking,
    hintThinking,
    candidateThinking,
    reviewThinking,
    nodeAnalysisThinking,
    isJieqi,
    send,
    engineBaseFen,
    uciMoves,
    currentPlayerConfig,
    difficulty,
    candidateCount,
    searchLimit,
    engineVariant,
  ])

  const requestNodeAnalysisTask = useCallback(
    (kind: 'node' | 'branch') => {
      if (
        isJieqi ||
        !connected ||
        engineAvailable === false ||
        aiThinking ||
        hintThinking ||
        candidateThinking ||
        reviewThinking ||
        nodeAnalysisThinking
      )
        return

      const tree = variationTreeRef.current
      const line = getVariationLine(tree, tree.currentNodeId)
      const allEntries = buildNodeAnalysisTaskEntries(tree, [tree.rootId, ...line.nodeIds])
      const targetEntries =
        kind === 'node'
          ? allEntries.filter((entry) => entry.nodeId === tree.currentNodeId)
          : allEntries
      if (targetEntries.length === 0) return
      if (targetEntries.length > MAX_NODE_ANALYSIS_COUNT) {
        setNodeAnalysisStatus(`当前分支超过 ${MAX_NODE_ANALYSIS_COUNT} 个局面，请缩短后再分析`)
        return
      }

      const engineThreads = engineRuntimeOptions?.engineThreads
      const engineHashMb = engineRuntimeOptions?.engineHashMb
      const pendingEntries = targetEntries.filter(
        (entry) =>
          !hasReusableNodeAnalysis(
            tree.nodes[entry.nodeId]?.analysis,
            searchLimit,
            engineThreads,
            engineHashMb,
          ),
      )
      const cachedCount = targetEntries.length - pendingEntries.length
      if (pendingEntries.length === 0) {
        const existing = tree.nodes[tree.currentNodeId]?.analysis
        if (existing) {
          setEvaluation(existing.score)
          setBestLine(existing.pv || [])
          setAnalysisDepth(existing.depth)
        }
        setNodeAnalysisProgress({
          completed: targetEntries.length,
          total: targetEntries.length,
          cached: cachedCount,
        })
        setNodeAnalysisStatus(`${kind === 'branch' ? '当前分支' : '当前节点'}已复用同配置缓存`)
        return
      }

      const requestId = makeRequestId('analyze-nodes')
      nodeAnalysisTaskRef.current = {
        id: requestId,
        kind,
        entries: pendingEntries,
        cachedCount,
        total: targetEntries.length,
        searchLimit,
        engineThreads,
        engineHashMb,
      }
      setNodeAnalysisThinking(true)
      setNodeAnalysisProgress({
        completed: cachedCount,
        total: targetEntries.length,
        cached: cachedCount,
      })
      setNodeAnalysisStatus(kind === 'branch' ? '正在分析当前分支' : '正在分析当前节点')
      const sent = send({
        type: 'analyze-nodes',
        requestId,
        fen: engineBaseFen,
        moves: uciListFromRecords(line.records),
        moveIndexes: pendingEntries.map((entry) => entry.moveIndex),
        variant: 'xiangqi',
        ...searchLimit,
      })
      if (!sent) {
        nodeAnalysisTaskRef.current = null
        setNodeAnalysisThinking(false)
        setNodeAnalysisStatus('节点分析未发送，请检查连接后重试')
      }
    },
    [
      aiThinking,
      candidateThinking,
      connected,
      engineAvailable,
      engineBaseFen,
      engineRuntimeOptions,
      hintThinking,
      isJieqi,
      nodeAnalysisThinking,
      reviewThinking,
      searchLimit,
      send,
    ],
  )

  const requestCurrentNodeAnalysis = useCallback(
    () => requestNodeAnalysisTask('node'),
    [requestNodeAnalysisTask],
  )

  const requestCurrentBranchAnalysis = useCallback(
    () => requestNodeAnalysisTask('branch'),
    [requestNodeAnalysisTask],
  )

  const cancelNodeAnalysisTask = useCallback(() => {
    const request = nodeAnalysisTaskRef.current
    if (connected && request) send({ type: 'stop', requestId: request.id })
    nodeAnalysisTaskRef.current = null
    setNodeAnalysisThinking(false)
    setNodeAnalysisStatus('已停止节点分析')
  }, [connected, send])

  const requestReview = useCallback(() => {
    if (
      isJieqi ||
      !connected ||
      engineAvailable === false ||
      moveHistory.length === 0 ||
      moveHistory.length > 120
    )
      return
    if (aiThinking || hintThinking || candidateThinking || reviewThinking || nodeAnalysisThinking)
      return

    const moves = uciListFromRecords(moveHistory)
    const tree = variationTreeRef.current
    const entries = buildNodeAnalysisTaskEntries(tree, [
      tree.rootId,
      ...activeVariationNodeIdsRef.current,
    ])
    const requestId = makeRequestId('review')
    reviewRequestRef.current = { id: requestId, movesKey: moves.join(' '), entries }
    setReviewThinking(true)
    setReviewProgress({ completed: 0, total: moves.length + 1 })
    setReviewPositions([])
    const sent = send({
      type: 'review',
      requestId,
      fen: engineBaseFen,
      moves,
      searchDepth: 12,
    })
    if (!sent) {
      reviewRequestRef.current = null
      setReviewThinking(false)
    }
  }, [
    aiThinking,
    candidateThinking,
    connected,
    engineAvailable,
    engineBaseFen,
    hintThinking,
    isJieqi,
    moveHistory,
    nodeAnalysisThinking,
    reviewThinking,
    send,
  ])

  const cancelReview = useCallback(() => {
    const request = reviewRequestRef.current
    if (connected && request) send({ type: 'stop', requestId: request.id })
    reviewRequestRef.current = null
    setReviewThinking(false)
    setReviewProgress({ completed: 0, total: 0 })
  }, [connected, send])

  const nextAiMove = useCallback(() => {
    if (!canEditGame) return
    if (gameMode !== 'ai-vs-ai') return
    if (
      !connected ||
      gameStatus !== 'playing' ||
      aiThinking ||
      reviewThinking ||
      nodeAnalysisThinking
    )
      return

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
    const sent = send({
      type: 'move',
      requestId,
      fen: engineBaseFen,
      moves: uciMoves,
      difficulty: difficultyForTurn,
      variant: engineVariant,
    })
    if (!sent) {
      pendingRequestRef.current = null
      candidateRequestRef.current = null
      setAiThinking(false)
    }
  }, [
    canEditGame,
    gameMode,
    connected,
    gameStatus,
    aiThinking,
    reviewThinking,
    nodeAnalysisThinking,
    currentTurn,
    aiRedDifficulty,
    aiBlackDifficulty,
    send,
    uciMoves,
    engineBaseFen,
    engineVariant,
  ])

  const declareDraw = useCallback(() => {
    if (!canEditGame) return
    if (gameStatus !== 'playing') return
    const statusDetail = getManualDrawStatus()
    setGameStatus(statusDetail.status)
    setGameStatusReason(statusDetail.reason)
    stopActiveRequests()
    playGameOverSound()
  }, [canEditGame, gameStatus, stopActiveRequests])

  const resign = useCallback(() => {
    if (!canEditGame) return
    if (gameStatus !== 'playing') return
    const statusDetail = getResignationStatus(currentTurn)
    setGameStatus(statusDetail.status)
    setGameStatusReason(statusDetail.reason)
    stopActiveRequests()
    playGameOverSound()
  }, [canEditGame, currentTurn, gameStatus, stopActiveRequests])

  const takeoverGame = useCallback(() => {
    if (!gameId || !connected) return
    const requestId = makeRequestId('takeover-game')
    leaseRequestRef.current = requestId
    setLeaseStatus('requesting')
    send({ type: 'takeover-game', requestId, gameId })
  }, [connected, gameId, send])

  const canRequestHint =
    connected &&
    engineAvailable !== false &&
    gameStatus === 'playing' &&
    !aiThinking &&
    !hintThinking &&
    !candidateThinking &&
    !reviewThinking &&
    !nodeAnalysisThinking &&
    currentPlayerConfig.type === 'human'

  const canStepAi =
    canEditGame &&
    gameMode === 'ai-vs-ai' &&
    connected &&
    engineAvailable !== false &&
    gameStatus === 'playing' &&
    !aiThinking &&
    !reviewThinking &&
    !nodeAnalysisThinking

  const canRequestNodeAnalysis =
    !isJieqi &&
    connected &&
    engineAvailable !== false &&
    !aiThinking &&
    !hintThinking &&
    !candidateThinking &&
    !reviewThinking &&
    !nodeAnalysisThinking

  const bestLineNotation = useMemo(() => {
    return translatePv(bestLine, board)
  }, [bestLine, board, translatePv])

  const moveRecords = useMemo(
    () => moveHistory.slice(0, currentMoveIndex + 1),
    [moveHistory, currentMoveIndex],
  )
  /** 分析曲线从活动线各节点的分析结果派生,根节点(初始局面)作为 -1,切换分支后自动对应各自节点。 */
  const analysisPoints = useMemo<AnalysisPoint[]>(
    () => deriveAnalysisPoints(variationTree, activeVariationNodeIds),
    [activeVariationNodeIds, variationTree],
  )
  const variationChildren = useMemo(() => {
    const currentNode = variationTree.nodes[variationTree.currentNodeId]
    if (!currentNode) return []
    return currentNode.children.flatMap((id) =>
      variationTree.nodes[id] ? [variationTree.nodes[id]] : [],
    )
  }, [variationTree])
  const currentNodeAnnotations = variationTree.nodes[variationTree.currentNodeId]?.annotations || []

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
    variationTree,
    currentVariationNodeId: variationTree.currentNodeId,
    currentNodeAnnotations,
    variationChildren,
    variationBranchCount: countVariationBranches(variationTree),
    mainVariationChildId: variationTree.nodes[variationTree.currentNodeId]?.mainChildId,
    currentMoveIndex,
    hintThinking,
    candidateThinking,
    reviewThinking,
    reviewProgress,
    reviewPositions,
    nodeAnalysisThinking,
    nodeAnalysisProgress,
    nodeAnalysisStatus,
    aiThinking,
    connectionState,
    connected,
    engineAvailable,
    engineStatusMessage,
    canUndo:
      canEditGame &&
      canNavigateHistory(gameMode) &&
      currentMoveIndex >= 0 &&
      !aiThinking &&
      !hintThinking &&
      !reviewThinking &&
      !nodeAnalysisThinking,
    canRedo:
      canEditGame &&
      canNavigateHistory(gameMode) &&
      currentMoveIndex < moveHistory.length - 1 &&
      !aiThinking &&
      !hintThinking &&
      !reviewThinking &&
      !nodeAnalysisThinking,
    canRequestHint,
    canRequestCandidates:
      !isJieqi &&
      connected &&
      engineAvailable !== false &&
      gameStatus === 'playing' &&
      !aiThinking &&
      !hintThinking &&
      !candidateThinking &&
      !reviewThinking &&
      !nodeAnalysisThinking,
    canRequestReview:
      !isJieqi &&
      connected &&
      engineAvailable !== false &&
      moveHistory.length > 0 &&
      moveHistory.length <= 120 &&
      !aiThinking &&
      !hintThinking &&
      !candidateThinking &&
      !reviewThinking &&
      !nodeAnalysisThinking,
    canRequestNodeAnalysis,
    canRequestBranchAnalysis:
      canRequestNodeAnalysis && activeVariationNodeIds.length + 1 <= MAX_NODE_ANALYSIS_COUNT,
    canStepAi,
    handleCellClick,
    undo,
    redo,
    flip,
    cancelSelection,
    toggleMoveMark,
    updateMoveNote,
    jumpToMove,
    selectVariation,
    setMainVariationChild,
    removeVariationBranch,
    addCurrentNodeAnnotation,
    removeCurrentNodeAnnotation,
    undoCurrentNodeAnnotation,
    clearCurrentNodeAnnotations,
    requestHint,
    requestCandidates,
    requestReview,
    cancelReview,
    requestCurrentNodeAnalysis,
    requestCurrentBranchAnalysis,
    cancelNodeAnalysisTask,
    nextAiMove,
    declareDraw,
    resign,
    canEditGame,
    leaseStatus,
    leaseToken,
    takeoverGame,
    getCurrentFen,
    initialFen: engineBaseFen,
    initialJieqiBoard: jieqiInitialBoardRef.current,
    loadFen,
    redPlayerConfig: players.red,
    blackPlayerConfig: players.black,
  }
}
