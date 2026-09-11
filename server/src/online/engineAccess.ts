import { metrics } from '../platform/observability.js'

// Check both admission and delivery; an already running engine must not leak output
// after the same account starts a rated game on another connection.
export async function engineAccessAllowed(
  lookup: (() => Promise<boolean>) | undefined,
): Promise<boolean> {
  if (!lookup) return true
  try {
    const blocked = await lookup()
    if (blocked) metrics.increment('xiangqi_engine_rejected', { reason: 'active_rated_account' })
    return !blocked
  } catch {
    metrics.increment('xiangqi_engine_rejected', { reason: 'rating_check_unavailable' })
    return false
  }
}
