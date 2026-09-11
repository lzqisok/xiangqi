export const matchmakingPolicy = {
  repeatOpponentWindowMs: 24 * 60 * 60_000,
  repeatOpponentLimit: 3,
  cancellationWindowMs: 10 * 60_000,
  cancellationLimit: 5,
  cancellationCooldownMs: 10 * 60_000,
} as const

export class MatchmakingCooldownError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('matchmaking_cooldown')
  }
}
