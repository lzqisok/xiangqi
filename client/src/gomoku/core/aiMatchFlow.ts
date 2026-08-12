import type { Difficulty, GameMode, Player } from './types'

export function shouldRequestAiMove(
  mode: GameMode,
  currentPlayer: Player,
  aiPlayer: Player,
  autoPlaying: boolean,
  forceAiMatchStep = false,
): boolean {
  if (mode === 'ai') return currentPlayer === aiPlayer
  if (mode === 'ai-vs-ai') return autoPlaying || forceAiMatchStep
  return false
}

export function getDifficultyForTurn(
  mode: GameMode,
  currentPlayer: Player,
  humanVsAiDifficulty: Difficulty,
  blackDifficulty: Difficulty,
  whiteDifficulty: Difficulty,
): Difficulty {
  if (mode !== 'ai-vs-ai') return humanVsAiDifficulty
  return currentPlayer === 1 ? blackDifficulty : whiteDifficulty
}
