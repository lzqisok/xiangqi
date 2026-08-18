import { GameMode, GameStatus, GameStatusReason, PieceColor, PlayerConfig } from '../types'

type ManualGameStatusDetail = {
  status: GameStatus
  reason: GameStatusReason
}

export function hasSingleAiSide(players: { red: PlayerConfig; black: PlayerConfig }): boolean {
  return (
    (players.red.type === 'ai' && players.black.type === 'human') ||
    (players.red.type === 'human' && players.black.type === 'ai')
  )
}

export function getManualDrawStatus(): ManualGameStatusDetail {
  return {
    status: 'draw',
    reason: 'manual',
  }
}

export function getResignationStatus(color: PieceColor): ManualGameStatusDetail {
  return {
    status: color === 'red' ? 'black-wins' : 'red-wins',
    reason: 'resignation',
  }
}

export function getHistoryStepSize(
  gameMode: GameMode | null,
  players: { red: PlayerConfig; black: PlayerConfig },
): number {
  return gameMode === 'human-vs-ai' || (gameMode === 'endgame' && hasSingleAiSide(players)) ? 2 : 1
}

export function canNavigateHistory(gameMode: GameMode | null): boolean {
  return gameMode !== 'jieqi'
}

export function getUndoTargetIndex(
  currentMoveIndex: number,
  gameMode: GameMode | null,
  players: { red: PlayerConfig; black: PlayerConfig },
): number {
  if (currentMoveIndex < 0) return -1
  return Math.max(-1, currentMoveIndex - getHistoryStepSize(gameMode, players))
}

export function getRedoTargetIndex(
  currentMoveIndex: number,
  historyLength: number,
  gameMode: GameMode | null,
  players: { red: PlayerConfig; black: PlayerConfig },
): number {
  if (currentMoveIndex >= historyLength - 1) return currentMoveIndex
  return Math.min(historyLength - 1, currentMoveIndex + getHistoryStepSize(gameMode, players))
}

export function shouldAutoRequestAiMove({
  gameStatus,
  aiThinking,
  gameMode,
  currentPlayer,
  connected,
}: {
  gameStatus: GameStatus
  aiThinking: boolean
  gameMode: GameMode | null
  currentPlayer: PlayerConfig
  connected: boolean
}): boolean {
  return (
    gameStatus === 'playing' &&
    !aiThinking &&
    gameMode !== 'ai-vs-ai' &&
    currentPlayer.type === 'ai' &&
    connected
  )
}

export function sendStopForActiveEngineRequests(
  connected: boolean,
  send: (message: { type: 'stop' }) => boolean,
): void {
  if (connected) {
    send({ type: 'stop' })
  }
}
