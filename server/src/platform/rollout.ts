import type { UserActor } from '../auth/types.js'
import type { PublicOnlineMode } from './config.js'

export type PublicOnlineRollout = {
  mode: PublicOnlineMode
  allowedUserIds: ReadonlySet<string>
}

export function canAccessPublicOnline(
  rollout: PublicOnlineRollout,
  actor: Pick<UserActor, 'userId'>,
): boolean {
  if (rollout.mode === 'off') return false
  return rollout.mode !== 'controlled' || rollout.allowedUserIds.has(actor.userId)
}

export function canStartPublicOnlineOperation(
  rollout: PublicOnlineRollout,
  actor: Pick<UserActor, 'userId'>,
): boolean {
  return rollout.mode !== 'drain' && canAccessPublicOnline(rollout, actor)
}
