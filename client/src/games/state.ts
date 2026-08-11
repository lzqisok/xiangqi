import { INITIAL_FEN } from '../engine/board'
import { createJieqiInitialBoard, JIEQI_INITIAL_FEN } from '../engine/jieqi'
import { LiveGameMode, PersistedGameState } from '../types'
import { createVariationTree } from '../variations/tree'

export function createInitialPersistedState(mode: LiveGameMode): PersistedGameState {
  const initialFen = mode === 'jieqi' ? JIEQI_INITIAL_FEN : INITIAL_FEN
  return {
    initialFen,
    initialJieqiBoard: mode === 'jieqi' ? createJieqiInitialBoard() : undefined,
    historyRecords: [],
    currentMoveIndex: -1,
    variationTree: createVariationTree(initialFen, [], -1),
    gameStatus: 'playing',
  }
}

export function gameUrl(id: string): string {
  const url = new URL(window.location.href)
  url.searchParams.delete('replay')
  url.searchParams.set('game', id)
  return url.toString()
}

export function clearGameUrl(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete('game')
  window.history.replaceState(null, '', url)
}
