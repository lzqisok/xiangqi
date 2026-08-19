export type QuickMatchKey = 'xiangqi' | 'jieqi' | 'gomoku-freestyle' | 'gomoku-renju'

export type QuickMatchConfig = {
  key: QuickMatchKey
  variant: 'xiangqi' | 'jieqi' | 'gomoku'
  gomokuRule?: 'freestyle' | 'renju'
}

export function parseQuickMatch(search: string): QuickMatchConfig | null {
  const key = new URLSearchParams(search).get('quick')
  if (key === 'xiangqi' || key === 'jieqi') return { key, variant: key }
  if (key === 'gomoku-freestyle') return { key, variant: 'gomoku', gomokuRule: 'freestyle' }
  if (key === 'gomoku-renju') return { key, variant: 'gomoku', gomokuRule: 'renju' }
  return null
}

export function quickMatchKey(
  variant: 'xiangqi' | 'jieqi' | 'gomoku',
  gomokuRule?: 'freestyle' | 'renju',
): QuickMatchKey {
  return variant === 'gomoku' ? `gomoku-${gomokuRule === 'renju' ? 'renju' : 'freestyle'}` : variant
}

export function quickMatchRoomUrl(currentUrl: string, roomId: string, key: QuickMatchKey) {
  const url = new URL(currentUrl)
  url.searchParams.set('lan', '1')
  url.searchParams.set('room', roomId)
  url.searchParams.set('quick', key)
  if (key.startsWith('gomoku-')) url.searchParams.set('gomoku', '1')
  else url.searchParams.delete('gomoku')
  return url.toString()
}

export function removeQuickMatchMarker(currentUrl: string) {
  const url = new URL(currentUrl)
  url.searchParams.delete('quick')
  return url.toString()
}

export function shouldRequeueQuickMatch(
  config: QuickMatchConfig | null,
  state: {
    error?: string
    snapshot?: { matchmaking?: boolean; phase?: string; role?: string }
  },
) {
  if (!config) return false
  if (state.error === '对局不存在') return true
  const snapshot = state.snapshot
  return Boolean(
    snapshot?.matchmaking && snapshot.phase === 'waiting' && snapshot.role === 'spectator',
  )
}
