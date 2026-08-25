import type { OnlineChatMessage } from './types'

export function onlineRoomUrl(
  currentUrl: string,
  matchId: string,
  game: 'xiangqi' | 'gomoku',
): string {
  const url = new URL(currentUrl)
  url.searchParams.set('online', '1')
  url.searchParams.set('game', game)
  url.searchParams.set('match', matchId)
  url.searchParams.delete('invite')
  return url.toString()
}

export function mergeOnlineChat(
  messages: readonly OnlineChatMessage[],
  next: OnlineChatMessage,
  limit = 100,
): OnlineChatMessage[] {
  return [...messages.filter((item) => item.id !== next.id), next]
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-Math.max(1, limit))
}
