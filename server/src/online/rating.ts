import type { MatchEntity } from '../repositories/contracts.js'

export type RatingPool = 'xiangqi' | 'jieqi' | 'gomoku-freestyle' | 'gomoku-renju'

export type RatingCalculation = {
  redAfter: number
  blackAfter: number
  redDelta: number
  blackDelta: number
  kFactor: 24 | 40
}

const INITIAL_RATING = 1500
const MINIMUM_RATING = 100
const PROVISIONAL_GAMES = 10

const RATED_REASONS = new Set([
  'checkmate',
  'stalemate',
  'resignation',
  'agreement',
  'repetition',
  'natural-limit',
  'move-limit',
  'five',
  'forbidden',
  'full-board',
  'timeout',
  'disconnect',
])

export const ratingPolicy = {
  model: 'elo-v1' as const,
  initialRating: INITIAL_RATING,
  provisionalGames: PROVISIONAL_GAMES,
  establishedKFactor: 24,
  provisionalKFactor: 40,
  season: null,
}

export function ratingPool(
  variant: MatchEntity['variant'],
  gomokuRule: MatchEntity['gomokuRule'],
): RatingPool {
  if (variant === 'gomoku') {
    return gomokuRule === 'renju' ? 'gomoku-renju' : 'gomoku-freestyle'
  }
  return variant
}

export function isRatedMatchEligible(match: MatchEntity): boolean {
  return (
    match.phase === 'finished' &&
    match.startedAt !== null &&
    match.status !== 'playing' &&
    match.competitionMode === 'rated' &&
    match.matchmaking &&
    match.clockPreset !== 'none' &&
    match.statusReason !== null &&
    RATED_REASONS.has(match.statusReason)
  )
}

export function calculateRating(input: {
  redRating: number
  blackRating: number
  redGames: number
  blackGames: number
  status: MatchEntity['status']
}): RatingCalculation {
  if (input.status === 'playing') throw new Error('Cannot rate an unfinished game')
  const kFactor: 24 | 40 =
    input.redGames < PROVISIONAL_GAMES || input.blackGames < PROVISIONAL_GAMES ? 40 : 24
  const redScore = input.status === 'red-wins' ? 1 : input.status === 'black-wins' ? 0 : 0.5
  const expectedRed = 1 / (1 + 10 ** ((input.blackRating - input.redRating) / 400))
  const rawDelta = Math.round(kFactor * (redScore - expectedRed))
  const redLossLimit = -(input.redRating - MINIMUM_RATING)
  const blackLossLimit = input.blackRating - MINIMUM_RATING
  const redDelta = Math.max(redLossLimit, Math.min(blackLossLimit, rawDelta))
  return {
    redAfter: input.redRating + redDelta,
    blackAfter: input.blackRating - redDelta,
    redDelta,
    blackDelta: -redDelta,
    kFactor,
  }
}
