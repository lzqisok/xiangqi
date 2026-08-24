import { buildJieqiReplayFrames } from '../jieqi-record/replay'
import type { JieqiPublicProjection, JieqiSeatProjection } from '../jieqi-record/types'
import type { LanRole } from './types'

/** Accepts only the projection authorized for the current authenticated LAN role. */
export function authorizeLanJieqiRecord(
  value: unknown,
  role: LanRole,
): JieqiPublicProjection | JieqiSeatProjection | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<JieqiPublicProjection | JieqiSeatProjection>
  const seatRole = role === 'red' || role === 'black' ? role : null
  if (seatRole ? candidate.audience !== seatRole : candidate.audience !== 'public') return null
  try {
    buildJieqiReplayFrames(candidate as JieqiPublicProjection | JieqiSeatProjection)
    return candidate as JieqiPublicProjection | JieqiSeatProjection
  } catch {
    return null
  }
}
