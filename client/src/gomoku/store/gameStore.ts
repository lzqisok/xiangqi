import { create } from './createStore'
import { applyMove, createEmptyBoard, getCell, inBounds, removeLastMove } from '../core/board'
import { checkWinResult, isDraw, isForbiddenMove } from '../core/rules'
import { getUndoStepCount } from '../core/gameFlow'
import { getDifficultyForTurn, shouldRequestAiMove } from '../core/aiMatchFlow'
import { BLACK, EMPTY, WHITE, type Difficulty, type GameMode, type Move, type Player, type Position } from '../core/types'
import type { Board } from '../core/board'
import type { ComputeAiPayload, ReviewPayload, ReviewReport, WorkerRequest, WorkerResponse } from '../ai/types'
import { cancelRapfiRequests, probeRapfi, RapfiRequestCancelledError, requestRapfiMove } from '../rapfi/client'

export type GomokuAiEngine = 'checking' | 'rapfi' | 'browser'

interface GameState {
  board: Board
  mode: GameMode
  forbiddenEnabled: boolean
  difficulty: Difficulty
  blackAiDifficulty: Difficulty
  whiteAiDifficulty: Difficulty
  aiAutoPlaying: boolean
  aiAutoDelay: number
  currentPlayer: Player
  humanPlayer: Player
  aiPlayer: Player
  aiThinking: boolean
  aiEngine: GomokuAiEngine
  winner: Player | null
  draw: boolean
  winningLine: Position[]
  moveHistory: Move[]
  lastMove: Position | null
  message: string
  isStarted: boolean
  review: ReviewReport | null
  reviewLoading: boolean
  reviewProgress: { completed: number; total: number } | null
  reviewError: string
  reviewCursor: number
  makeMove: (row: number, col: number) => void
  undo: () => void
  newGame: () => void
  resetGame: () => void
  loadRecordedGame: (moves: Move[], forbiddenEnabled: boolean) => void
  runReviewAnalysis: () => void
  stopReviewAnalysis: () => void
  setReviewCursor: (cursor: number) => void
  clearReview: () => void
  setMode: (mode: GameMode) => void
  setForbiddenEnabled: (enabled: boolean) => void
  setDifficulty: (difficulty: Difficulty) => void
  setAiMatchDifficulty: (player: Player, difficulty: Difficulty) => void
  setAiAutoDelay: (delay: number) => void
  setAiSide: (player: Player) => void
  nextAiMove: () => void
  toggleAiAutoPlay: () => void
  initializeAiEngine: () => Promise<void>
}

const workers: Array<Worker | null> = []
let requestId = 0
let aiAutoTimer: ReturnType<typeof setTimeout> | null = null
let cancelActiveReviewRequest: (() => void) | null = null
let reviewGeneration = 0

const REVIEW_TIMEOUT_MS = 20_000

type ReviewRequestResult =
  | { review: ReviewReport; error: null }
  | { review: null; error: 'cancelled' | 'timeout' | 'worker' }

type StoreSet = (partial: Partial<GameState>) => void
type StoreGet = () => GameState

function clearAiAutoTimer(): void {
  if (aiAutoTimer) clearTimeout(aiAutoTimer)
  aiAutoTimer = null
}

function getWorker(index = 0): Worker {
  if (!workers[index]) {
    workers[index] = new Worker(new URL('../ai/worker.ts', import.meta.url), { type: 'module' })
  }
  return workers[index]!
}

function requestBrowserAiMove(payload: ComputeAiPayload, workerIndex = 0): Promise<{ move: Position | null; score: number }> {
  return new Promise((resolve) => {
    const w = getWorker(workerIndex)
    const id = ++requestId

    const handleMessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.id !== id || event.data.type !== 'best-move') return
      w.removeEventListener('message', handleMessage as EventListener)
      resolve({ move: event.data.move, score: event.data.score })
    }
    w.addEventListener('message', handleMessage as EventListener)
    w.postMessage({ id, type: 'compute', payload } satisfies WorkerRequest)
  })
}

function cancelReviewAnalysis(): void {
  reviewGeneration += 1
  cancelActiveReviewRequest?.()
  cancelActiveReviewRequest = null
}

function requestReviewAnalysis(
  payload: ReviewPayload,
  onProgress: (completed: number, total: number) => void,
): Promise<ReviewRequestResult> {
  return new Promise((resolve) => {
    const w = new Worker(new URL('../ai/worker.ts', import.meta.url), { type: 'module' })
    const id = ++requestId
    let settled = false

    const finish = (result: ReviewRequestResult) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      w.terminate()
      if (cancelActiveReviewRequest === cancel) cancelActiveReviewRequest = null
      resolve(result)
    }
    const handleMessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.id !== id) return
      if (event.data.type === 'review-progress') {
        onProgress(event.data.completed, event.data.total)
        return
      }
      if (event.data.type === 'review-result') finish({ review: event.data.review, error: null })
    }
    const cancel = () => finish({ review: null, error: 'cancelled' })
    const timeout = setTimeout(() => finish({ review: null, error: 'timeout' }), REVIEW_TIMEOUT_MS)
    cancelActiveReviewRequest = cancel
    w.addEventListener('message', handleMessage as EventListener)
    w.addEventListener('error', () => finish({ review: null, error: 'worker' }), { once: true })
    w.postMessage({ id, type: 'review', payload } satisfies WorkerRequest)
  })
}

function getParallelPartitions(difficulty: Difficulty): number {
  if (difficulty !== 'hard' && difficulty !== 'master') return 1
  const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 2) : 2
  if (difficulty === 'master' && cores >= 8) return 4
  if (cores >= 12) return 4
  if (cores >= 8) return 3
  if (cores >= 4) return 2
  return 1
}

function other(player: Player): Player {
  return player === BLACK ? WHITE : BLACK
}

function isValidAiMove(board: Board, move: Position, player: Player, forbiddenEnabled: boolean): boolean {
  if (!inBounds(move.row, move.col) || getCell(board, move.row, move.col) !== EMPTY) return false
  if (!forbiddenEnabled || player !== BLACK) return true
  const nextBoard = applyMove(board, { ...move, player })
  return !isForbiddenMove(nextBoard, move.row, move.col, { forbiddenEnabled })
}

function buildNextState(
  board: Board,
  moveHistory: Move[],
  currentPlayer: Player,
  forbiddenEnabled: boolean,
  message = '',
): Pick<GameState, 'board' | 'moveHistory' | 'currentPlayer' | 'winner' | 'winningLine' | 'lastMove' | 'message'> {
  const lastMove = moveHistory.length ? moveHistory[moveHistory.length - 1] : null
  if (lastMove) {
    const ended = checkWinResult(board, lastMove, lastMove.player, { forbiddenEnabled })
    if (ended) {
      return {
        board,
        moveHistory,
        currentPlayer,
        winner: ended.winner,
        winningLine: ended.line,
        lastMove,
        message: ended.reason === 'forbidden' ? '黑方触发禁手，白方胜' : `${ended.winner === BLACK ? '黑' : '白'}方胜`,
      }
    }
  }

  if (isDraw(board)) {
    return {
      board,
      moveHistory,
      currentPlayer,
      winner: null,
      winningLine: [],
      lastMove,
      message: '平局',
    }
  }

  return {
    board,
    moveHistory,
    currentPlayer,
    winner: null,
    winningLine: [],
    lastMove,
    message,
  }
}

function scheduleAiTurn(set: StoreSet, get: StoreGet, delay: number): void {
  clearAiAutoTimer()
  aiAutoTimer = setTimeout(() => {
    aiAutoTimer = null
    const state = get()
    if (!state.aiAutoPlaying || state.mode !== 'ai-vs-ai' || state.aiThinking) return
    triggerAiTurn(set, get)
  }, delay)
}

function triggerAiTurn(set: StoreSet, get: StoreGet, forceAiMatchStep = false): void {
  const after = get()
  if (!after.isStarted || after.winner || after.draw || after.aiThinking) return
  if (!shouldRequestAiMove(after.mode, after.currentPlayer, after.aiPlayer, after.aiAutoPlaying, forceAiMatchStep)) return

  const activeAiPlayer = after.currentPlayer
  const activeDifficulty = getDifficultyForTurn(
    after.mode,
    after.currentPlayer,
    after.difficulty,
    after.blackAiDifficulty,
    after.whiteAiDifficulty,
  )

  set({ aiThinking: true, message: after.aiEngine === 'browser' ? '内置 AI 思考中...' : 'Rapfi 思考中...' })
  const snapshotMoveCount = after.moveHistory.length
  const payload = {
    board: after.board,
    aiPlayer: activeAiPlayer,
    currentPlayer: after.currentPlayer,
    forbiddenEnabled: after.forbiddenEnabled,
    difficulty: activeDifficulty,
    moveCount: snapshotMoveCount,
  } satisfies ComputeAiPayload

  const requestBrowserFallback = () => {
    const partitionCount = getParallelPartitions(activeDifficulty)
    return (
    partitionCount > 1
      ? Promise.all(
          Array.from({ length: partitionCount }, (_, partitionIndex) =>
            requestBrowserAiMove({ ...payload, partitionModulo: partitionCount, partitionIndex }, partitionIndex),
          ),
        ).then((results) => {
          const valid = results.filter((r) => r.move)
          if (valid.length === 0) return { move: null as Position | null, score: -Infinity }
          return valid.reduce((best, cur) => (cur.score > best.score ? cur : best))
        })
      : requestBrowserAiMove(payload, 0)
    )
  }

  const computePromise = (after.aiEngine === 'browser'
    ? requestBrowserFallback()
    : requestRapfiMove({
        moves: after.moveHistory,
        aiPlayer: activeAiPlayer,
        difficulty: activeDifficulty,
        forbiddenEnabled: after.forbiddenEnabled,
      }).then(move => {
        if (!isValidAiMove(payload.board, move, payload.aiPlayer, payload.forbiddenEnabled)) {
          throw new Error('Rapfi returned an illegal move')
        }
        return { move, score: 0 }
      }).catch((error: unknown) => {
        if (error instanceof RapfiRequestCancelledError) {
          return null
        }
        const current = get()
        if (current.board !== payload.board || current.moveHistory.length !== snapshotMoveCount) {
          return { move: null as Position | null, score: -Infinity }
        }
        set({ aiEngine: 'browser', message: 'Rapfi 不可用，已切换至内置 AI…' })
        return requestBrowserFallback()
      }))

  void computePromise.then((result) => {
    const now = get()
    if (now.board !== payload.board || now.moveHistory.length !== snapshotMoveCount) return
    if (!result) {
      clearAiAutoTimer()
      set({ aiThinking: false, aiAutoPlaying: false })
      return
    }
    if (!now.isStarted || now.winner || now.draw) {
      set({ aiThinking: false })
      return
    }
    if (!result.move) {
      clearAiAutoTimer()
      set({ aiThinking: false, aiAutoPlaying: false, message: 'AI 无法找到可用落点' })
      return
    }
    if (!isValidAiMove(now.board, result.move, now.currentPlayer, now.forbiddenEnabled)) {
      clearAiAutoTimer()
      set({ aiThinking: false, aiAutoPlaying: false, message: 'AI 返回了无效落点，请重试' })
      return
    }

    const aiMove: Move = { ...result.move, player: now.currentPlayer }
    const aiBoard = applyMove(now.board, aiMove)
    const aiNext = buildNextState(aiBoard, [...now.moveHistory, aiMove], other(now.currentPlayer), now.forbiddenEnabled)
    const aiDraw = aiNext.message === '平局'
    if (now.reviewLoading) cancelReviewAnalysis()
    set({
      ...aiNext,
      draw: aiDraw,
      aiThinking: false,
      reviewLoading: false,
      reviewProgress: null,
      message: aiNext.winner || aiDraw
        ? aiNext.message
        : `${aiMove.player === BLACK ? '黑' : '白'}方 AI 已落子 · 第 ${aiNext.moveHistory.length} 手`,
    })
    if (aiNext.winner || aiDraw) {
      clearAiAutoTimer()
      set({ aiAutoPlaying: false })
      setTimeout(() => get().runReviewAnalysis(), 0)
    } else {
      const current = get()
      if (current.mode === 'ai-vs-ai' && current.aiAutoPlaying) {
        scheduleAiTurn(set, get, current.aiAutoDelay)
      }
    }
  })
}

export const useGameStore = create<GameState>((set, get) => ({
  board: createEmptyBoard(),
  mode: 'pvp',
  forbiddenEnabled: false,
  difficulty: 'medium',
  blackAiDifficulty: 'medium',
  whiteAiDifficulty: 'medium',
  aiAutoPlaying: false,
  aiAutoDelay: 900,
  currentPlayer: BLACK,
  humanPlayer: BLACK,
  aiPlayer: WHITE,
  aiThinking: false,
  aiEngine: 'checking',
  winner: null,
  draw: false,
  winningLine: [],
  moveHistory: [],
  lastMove: null,
  message: '请点击开始游戏',
  isStarted: false,
  review: null,
  reviewLoading: false,
  reviewProgress: null,
  reviewError: '',
  reviewCursor: 0,

  makeMove: (row, col) => {
    const state = get()
    if (!state.isStarted || state.winner || state.draw || state.aiThinking) return
    if (state.mode === 'ai-vs-ai') return
    if (getCell(state.board, row, col) !== EMPTY) {
      set({ message: '该位置已有棋子' })
      return
    }
    if (state.mode === 'ai' && state.currentPlayer !== state.humanPlayer) return

    if (state.forbiddenEnabled && state.currentPlayer === BLACK) {
      const tempBoard = applyMove(state.board, { row, col, player: state.currentPlayer })
      if (isForbiddenMove(tempBoard, row, col, { forbiddenEnabled: state.forbiddenEnabled })) {
        set({ message: '⚠️ 此处为禁手，不可落子！' })
        return
      }
    }

    const move: Move = { row, col, player: state.currentPlayer }
    const nextBoard = applyMove(state.board, move)
    const nextPlayer = other(state.currentPlayer)
    const moveHistory = [...state.moveHistory, move]

    const next = buildNextState(nextBoard, moveHistory, nextPlayer, state.forbiddenEnabled)
    const isDrawNow = next.message === '平局'
    if (state.reviewLoading) cancelReviewAnalysis()
    set({ ...next, draw: isDrawNow, reviewLoading: false, reviewProgress: null })
    if (next.winner || isDrawNow) {
      setTimeout(() => get().runReviewAnalysis(), 0)
    }
    triggerAiTurn(set, get)
  },

  undo: () => {
    const state = get()
    if (state.moveHistory.length === 0 || state.aiThinking) return
    clearAiAutoTimer()
    cancelReviewAnalysis()

    const step = getUndoStepCount(state.moveHistory.length, state.mode, state.humanPlayer)
    if (step === 0) return
    let board = state.board
    const moveHistory = [...state.moveHistory]
    for (let i = 0; i < step; i += 1) {
      const last = moveHistory.pop()
      if (!last) break
      board = removeLastMove(board, last)
    }
    const turn = moveHistory.length % 2 === 0 ? BLACK : WHITE
    const next = buildNextState(board, moveHistory, turn, state.forbiddenEnabled, '已悔棋')
    set({ ...next, draw: false, aiThinking: false, aiAutoPlaying: false, review: null, reviewLoading: false, reviewProgress: null, reviewError: '', reviewCursor: 0 })
  },

  newGame: () => {
    clearAiAutoTimer()
    cancelRapfiRequests()
    cancelReviewAnalysis()
    const state = get()
    const first = BLACK
    set({
      board: createEmptyBoard(),
      currentPlayer: first,
      winner: null,
      draw: false,
      winningLine: [],
      moveHistory: [],
      lastMove: null,
      aiThinking: false,
      aiAutoPlaying: false,
      isStarted: true,
      message: state.mode === 'ai-vs-ai'
        ? 'AI 对战已开始，请单步执行或开始自动'
        : `对局已开始，${state.humanPlayer === BLACK ? '你执黑先行' : '黑方先行'}`,
      review: null,
      reviewLoading: false,
      reviewProgress: null,
      reviewError: '',
      reviewCursor: 0,
    })

    // Using timeout to ensure state update has propagated before kicking off AI search
    setTimeout(() => triggerAiTurn(set, get), 0)
  },

  resetGame: () => {
    clearAiAutoTimer()
    cancelRapfiRequests()
    cancelReviewAnalysis()
    set({
      board: createEmptyBoard(),
      currentPlayer: BLACK,
      winner: null,
      draw: false,
      winningLine: [],
      moveHistory: [],
      lastMove: null,
      aiThinking: false,
      aiAutoPlaying: false,
      isStarted: false,
      message: '请点击开始游戏',
      review: null,
      reviewLoading: false,
      reviewProgress: null,
      reviewError: '',
      reviewCursor: 0,
    })
  },

  loadRecordedGame: (moves, forbiddenEnabled) => {
    clearAiAutoTimer()
    cancelRapfiRequests()
    cancelReviewAnalysis()
    let board = createEmptyBoard()
    for (const move of moves) board = applyMove(board, move)
    const currentPlayer = moves.length % 2 === 0 ? BLACK : WHITE
    const next = buildNextState(board, moves.map(move => ({ ...move })), currentPlayer, forbiddenEnabled)
    set({
      ...next,
      mode: 'pvp',
      forbiddenEnabled,
      draw: next.message === '平局',
      isStarted: true,
      aiThinking: false,
      aiAutoPlaying: false,
      review: null,
      reviewLoading: false,
      reviewProgress: null,
      reviewError: '',
      reviewCursor: 0,
    })
    setTimeout(() => get().runReviewAnalysis(), 0)
  },

  runReviewAnalysis: () => {
    const state = get()
    if (state.moveHistory.length === 0) return
    const payload: ReviewPayload = {
      moveHistory: state.moveHistory,
      forbiddenEnabled: state.forbiddenEnabled,
      difficulty: state.difficulty,
    }
    const snapshotLen = state.moveHistory.length
    cancelReviewAnalysis()
    const generation = ++reviewGeneration
    set({ reviewLoading: true, reviewProgress: { completed: 0, total: snapshotLen }, reviewError: '' })
    void requestReviewAnalysis(payload, (completed, total) => {
      if (generation !== reviewGeneration) return
      set({ reviewProgress: { completed, total } })
    }).then((result) => {
      if (generation !== reviewGeneration) return
      const now = get()
      if (now.moveHistory.length !== snapshotLen) {
        set({ reviewLoading: false, reviewProgress: null })
        return
      }
      if (!result.review) {
        const error = result.error === 'timeout'
          ? '复盘分析超过 20 秒，已自动停止，请重试'
          : '复盘分析异常，请重试'
        set({ reviewLoading: false, reviewProgress: null, reviewError: error })
        return
      }
      set({ review: result.review, reviewLoading: false, reviewProgress: null, reviewError: '', reviewCursor: Math.max(0, result.review.steps.length - 1) })
    }).catch(() => {
      if (generation !== reviewGeneration) return
      set({ reviewLoading: false, reviewProgress: null, reviewError: '复盘分析启动失败，请刷新后重试' })
    })
  },

  stopReviewAnalysis: () => {
    const state = get()
    if (!state.reviewLoading) return
    cancelReviewAnalysis()
    set({ reviewLoading: false, reviewProgress: null, reviewError: '分析已停止，可以重新分析' })
  },

  setReviewCursor: (cursor) => {
    const state = get()
    const max = Math.max(0, (state.review?.steps.length ?? 1) - 1)
    const next = Math.min(max, Math.max(0, cursor))
    set({ reviewCursor: next })
  },

  clearReview: () => {
    cancelReviewAnalysis()
    set({ review: null, reviewLoading: false, reviewProgress: null, reviewError: '', reviewCursor: 0 })
  },

  setMode: (mode) => {
    const state = get()
    if (state.moveHistory.length > 0) return
    clearAiAutoTimer()
    set({
      mode,
      aiAutoPlaying: false,
      message: mode === 'pvp' ? '本地双人模式' : mode === 'ai' ? '人机模式' : 'AI 对战模式',
      review: null,
      reviewLoading: false,
      reviewProgress: null,
      reviewError: '',
      reviewCursor: 0,
    })
    if (mode !== 'pvp' && state.aiEngine === 'checking') void get().initializeAiEngine()
    triggerAiTurn(set, get)
  },

  setForbiddenEnabled: (enabled) => {
    const state = get()
    if (state.moveHistory.length > 0) return
    set({ forbiddenEnabled: enabled })
  },

  setDifficulty: (difficulty) => {
    set({ difficulty })
  },

  setAiMatchDifficulty: (player, difficulty) => {
    const state = get()
    if (state.isStarted) return
    set(player === BLACK ? { blackAiDifficulty: difficulty } : { whiteAiDifficulty: difficulty })
  },

  setAiAutoDelay: (delay) => {
    if (![400, 900, 1600].includes(delay)) return
    const state = get()
    set({ aiAutoDelay: delay })
    if (state.mode === 'ai-vs-ai' && state.aiAutoPlaying && !state.aiThinking) {
      scheduleAiTurn(set, get, delay)
    }
  },

  setAiSide: (player) => {
    const state = get()
    if (state.moveHistory.length > 0) return
    set({
      humanPlayer: player,
      aiPlayer: other(player),
      message: player === BLACK ? '你执黑先行' : '你执白后手',
    })
    triggerAiTurn(set, get)
  },

  nextAiMove: () => {
    const state = get()
    if (state.mode !== 'ai-vs-ai' || !state.isStarted || state.winner || state.draw || state.aiThinking) return
    clearAiAutoTimer()
    triggerAiTurn(set, get, true)
  },

  toggleAiAutoPlay: () => {
    const state = get()
    if (state.mode !== 'ai-vs-ai' || !state.isStarted || state.winner || state.draw) return
    if (state.aiAutoPlaying) {
      clearAiAutoTimer()
      set({ aiAutoPlaying: false, message: state.aiThinking ? '将在当前手完成后暂停' : 'AI 自动对战已暂停' })
      return
    }
    set({ aiAutoPlaying: true, message: 'AI 自动对战进行中' })
    if (!state.aiThinking) scheduleAiTurn(set, get, 0)
  },

  initializeAiEngine: async () => {
    set({ aiEngine: 'checking' })
    const available = await probeRapfi()
    set({ aiEngine: available ? 'rapfi' : 'browser' })
  },
}))
