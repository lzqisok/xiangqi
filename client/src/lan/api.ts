import { LanRoomSummary } from './types'

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })
  const body = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
  return body
}

export async function listLanRooms(game: 'xiangqi' | 'gomoku' = 'xiangqi') { return (await json<{ rooms: LanRoomSummary[] }>(`/api/rooms/lobby?game=${game}`)).rooms }
export async function listLanRoomHistory(game: 'xiangqi' | 'gomoku' = 'xiangqi') { return (await json<{ rooms: LanRoomSummary[] }>(`/api/rooms/history?game=${game}`)).rooms }
export async function createLanRoom(name: string, variant: 'xiangqi' | 'jieqi') {
  return json<{ room: LanRoomSummary; ownerToken: string; inviteToken: string }>('/api/rooms', { method: 'POST', body: JSON.stringify({ name, variant }) })
}
export async function createGomokuLanRoom(name: string, gomokuRule: 'freestyle' | 'renju') {
  return json<{ room: LanRoomSummary; ownerToken: string; inviteToken: string }>('/api/rooms', { method: 'POST', body: JSON.stringify({ name, variant: 'gomoku', gomokuRule }) })
}
