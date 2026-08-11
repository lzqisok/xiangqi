import { useCallback, useEffect, useRef, useState } from 'react'
import { GameDocument, PersistedGameState } from '../types'
import { saveGameState } from './api'

export type GameSaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error'

function signature(state: PersistedGameState): string {
  return JSON.stringify(state)
}

export function retainNewestPendingState(
  newerState: PersistedGameState | null,
  failedState: PersistedGameState,
): PersistedGameState {
  return newerState || failedState
}

export function useGamePersistence({
  game,
  baselineState,
  state,
  leaseToken,
  enabled,
  onSaved,
}: {
  game: GameDocument | null
  baselineState: PersistedGameState | null
  state: PersistedGameState | null
  leaseToken: string | null
  enabled: boolean
  onSaved: (game: GameDocument) => void
}) {
  const [status, setStatus] = useState<GameSaveStatus>('idle')
  const [error, setError] = useState('')
  const gameRef = useRef(game)
  const leaseTokenRef = useRef(leaseToken)
  const pendingRef = useRef<PersistedGameState | null>(null)
  const savedSignatureRef = useRef<string | null>(baselineState ? signature(baselineState) : null)
  const savingPromiseRef = useRef<Promise<void> | null>(null)
  const saveFailedRef = useRef(false)
  const onSavedRef = useRef(onSaved)

  gameRef.current = game
  leaseTokenRef.current = leaseToken
  onSavedRef.current = onSaved

  useEffect(() => {
    pendingRef.current = null
    savedSignatureRef.current = baselineState ? signature(baselineState) : null
    setStatus(game ? 'saved' : 'idle')
    setError('')
    saveFailedRef.current = false
  }, [baselineState, game?.id])

  const flush = useCallback(async (latestState?: PersistedGameState | null) => {
    if (latestState && signature(latestState) !== savedSignatureRef.current) {
      pendingRef.current = latestState
    }
    while (pendingRef.current) {
      if (savingPromiseRef.current) {
        await savingPromiseRef.current
        continue
      }

      const pending = pendingRef.current
      pendingRef.current = null
      if (signature(pending) === savedSignatureRef.current) continue
      const currentGame = gameRef.current
      const currentLeaseToken = leaseTokenRef.current
      if (!currentGame || !currentLeaseToken) {
        pendingRef.current = pending
        return false
      }

      setStatus('saving')
      setError('')
      let savedSuccessfully = false
      const task = saveGameState(currentGame, pending, currentLeaseToken)
        .then(saved => {
          gameRef.current = saved
          savedSignatureRef.current = signature(pending)
          onSavedRef.current(saved)
          saveFailedRef.current = false
          savedSuccessfully = true
          setStatus('saved')
        })
        .catch(cause => {
          // A newer snapshot may have been queued while this request was in flight.
          // Keep that snapshot; otherwise retain the failed one for an explicit retry.
          pendingRef.current = retainNewestPendingState(pendingRef.current, pending)
          const message = cause instanceof Error ? cause.message : '保存失败'
          saveFailedRef.current = true
          setError(message)
          setStatus((cause as { status?: number })?.status === 409 ? 'conflict' : 'error')
        })
        .finally(() => {
          savingPromiseRef.current = null
        })
      savingPromiseRef.current = task
      await task
      if (!savedSuccessfully) return false
    }
    return !saveFailedRef.current
  }, [])

  useEffect(() => {
    if (!enabled || !game || !state || !leaseToken) return
    const nextSignature = signature(state)
    if (nextSignature === savedSignatureRef.current) return
    pendingRef.current = state
    setStatus('dirty')
    void flush().catch(() => undefined)
  }, [enabled, flush, game, leaseToken, state])

  return { status, error, flush }
}
