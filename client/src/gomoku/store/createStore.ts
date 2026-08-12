import { useSyncExternalStore } from 'react'

type StateUpdater<T> = Partial<T> | ((state: T) => Partial<T>)
type StateCreator<T> = (
  set: (update: StateUpdater<T>) => void,
  get: () => T,
) => T

/**
 * Tiny selector store for the self-contained Gomoku module.
 * It deliberately mirrors only the Zustand surface used by the migrated game.
 */
export function create<T>(initializer: StateCreator<T>) {
  let state: T
  const listeners = new Set<() => void>()

  const get = () => state
  const set = (update: StateUpdater<T>) => {
    const partial = typeof update === 'function' ? update(state) : update
    state = { ...state, ...partial }
    listeners.forEach(listener => listener())
  }
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  state = initializer(set, get)

  return function useStore<Selection>(selector: (current: T) => Selection): Selection {
    return useSyncExternalStore(
      subscribe,
      () => selector(state),
      () => selector(state),
    )
  }
}
