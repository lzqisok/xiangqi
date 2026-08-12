import { BLACK, WHITE, type GameMode, type Player } from './types'

function playerToMove(moveCount: number): Player {
  return moveCount % 2 === 0 ? BLACK : WHITE
}

export function getUndoStepCount(moveCount: number, mode: GameMode, humanPlayer: Player): number {
  if (moveCount <= 0) return 0
  if (mode === 'pvp' || mode === 'ai-vs-ai') return 1

  for (let step = 1; step <= Math.min(2, moveCount); step += 1) {
    if (playerToMove(moveCount - step) === humanPlayer) return step
  }
  return 0
}
