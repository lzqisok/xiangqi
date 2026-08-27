import type { MatchEntity } from '../repositories/contracts.js'
import type { RoomColor } from '../rooms/types.js'

export type OnlineClockState = {
  preset: Exclude<MatchEntity['clockPreset'], 'none'>
  redRemainingMs: number
  blackRemainingMs: number
  incrementMs: number
  delayMs: number
  activeSide: RoomColor | null
  deadlineAt: string | null
}

const PRESETS: Record<OnlineClockState['preset'], { baseMs: number; incrementMs: number }> = {
  '10m': { baseMs: 10 * 60_000, incrementMs: 0 },
  '15m-10s': { baseMs: 15 * 60_000, incrementMs: 10_000 },
  '30m': { baseMs: 30 * 60_000, incrementMs: 0 },
}

const WALL_CLOCK_ORIGIN = Date.now()
const MONOTONIC_ORIGIN = performance.now()

/** Stable within one process even if the host wall clock is adjusted while a turn is running. */
export function authoritativeClockNow(): Date {
  return new Date(WALL_CLOCK_ORIGIN + (performance.now() - MONOTONIC_ORIGIN))
}

function opposite(side: RoomColor): RoomColor {
  return side === 'red' ? 'black' : 'red'
}

function finiteMilliseconds(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 86_400_000
}

export function createOnlineClock(
  preset: MatchEntity['clockPreset'],
  startedAt: Date,
): OnlineClockState | undefined {
  if (preset === 'none') return undefined
  const config = PRESETS[preset]
  return {
    preset,
    redRemainingMs: config.baseMs,
    blackRemainingMs: config.baseMs,
    incrementMs: config.incrementMs,
    delayMs: 0,
    activeSide: 'red',
    deadlineAt: new Date(startedAt.getTime() + config.baseMs).toISOString(),
  }
}

export function readOnlineClock(value: unknown): OnlineClockState | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('公网棋钟状态格式无效')
  }
  const source = value as Record<string, unknown>
  if (
    (source.preset !== '10m' && source.preset !== '15m-10s' && source.preset !== '30m') ||
    !finiteMilliseconds(source.redRemainingMs) ||
    !finiteMilliseconds(source.blackRemainingMs) ||
    !finiteMilliseconds(source.incrementMs) ||
    !finiteMilliseconds(source.delayMs) ||
    (source.activeSide !== null && source.activeSide !== 'red' && source.activeSide !== 'black') ||
    (source.deadlineAt !== null &&
      (typeof source.deadlineAt !== 'string' ||
        !Number.isFinite(new Date(source.deadlineAt).getTime()))) ||
    (source.activeSide === null) !== (source.deadlineAt === null)
  ) {
    throw new Error('公网棋钟状态格式无效')
  }
  return {
    preset: source.preset,
    redRemainingMs: source.redRemainingMs,
    blackRemainingMs: source.blackRemainingMs,
    incrementMs: source.incrementMs,
    delayMs: source.delayMs,
    activeSide: source.activeSide,
    deadlineAt: source.deadlineAt,
  }
}

export function projectOnlineClock(clock: OnlineClockState, now: Date) {
  let redRemainingMs = clock.redRemainingMs
  let blackRemainingMs = clock.blackRemainingMs
  if (clock.activeSide && clock.deadlineAt) {
    const remaining = Math.max(0, new Date(clock.deadlineAt).getTime() - now.getTime())
    if (clock.activeSide === 'red') redRemainingMs = remaining
    else blackRemainingMs = remaining
  }
  return {
    redRemainingMs,
    blackRemainingMs,
    incrementMs: clock.incrementMs,
    delayMs: clock.delayMs,
    activeSide: clock.activeSide,
    deadlineAt: clock.deadlineAt,
    serverNow: now.toISOString(),
  }
}

export function advanceOnlineClock(
  clock: OnlineClockState,
  mover: RoomColor,
  receivedAt: Date,
): { clock: OnlineClockState; timedOut: RoomColor | null } {
  if (clock.activeSide !== mover || !clock.deadlineAt) {
    throw new Error('棋钟行棋方与局面轮次不一致')
  }
  const remaining = new Date(clock.deadlineAt).getTime() - receivedAt.getTime()
  if (remaining <= 0) {
    return {
      timedOut: mover,
      clock: {
        ...clock,
        ...(mover === 'red' ? { redRemainingMs: 0 } : { blackRemainingMs: 0 }),
        activeSide: null,
        deadlineAt: null,
      },
    }
  }
  const moverRemaining = remaining + clock.incrementMs
  const next = opposite(mover)
  const nextRemaining = next === 'red' ? clock.redRemainingMs : clock.blackRemainingMs
  return {
    timedOut: null,
    clock: {
      ...clock,
      ...(mover === 'red'
        ? { redRemainingMs: moverRemaining }
        : { blackRemainingMs: moverRemaining }),
      activeSide: next,
      deadlineAt: new Date(receivedAt.getTime() + nextRemaining).toISOString(),
    },
  }
}

export function stopOnlineClock(clock: OnlineClockState, stoppedAt: Date): OnlineClockState {
  const projected = projectOnlineClock(clock, stoppedAt)
  return {
    ...clock,
    redRemainingMs: projected.redRemainingMs,
    blackRemainingMs: projected.blackRemainingMs,
    activeSide: null,
    deadlineAt: null,
  }
}

export function retargetOnlineClock(
  clock: OnlineClockState,
  activeSide: RoomColor,
  changedAt: Date,
): OnlineClockState {
  const projected = projectOnlineClock(clock, changedAt)
  const remaining = activeSide === 'red' ? projected.redRemainingMs : projected.blackRemainingMs
  return {
    ...clock,
    redRemainingMs: projected.redRemainingMs,
    blackRemainingMs: projected.blackRemainingMs,
    activeSide,
    deadlineAt: new Date(changedAt.getTime() + remaining).toISOString(),
  }
}
