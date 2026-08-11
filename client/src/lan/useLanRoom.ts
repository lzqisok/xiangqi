import { useCallback, useEffect, useRef, useState } from 'react'
import { createLanCommandId } from './browser'
import { LanRoomSnapshot } from './types'

function key(id: string) { return `xiangqi-lan-room:${id}` }
export function getLanToken(id: string) { return localStorage.getItem(key(id)) || '' }
export function saveLanToken(id: string, token: string) { localStorage.setItem(key(id), token) }
export type LanRecentRoom = { id: string; name: string; variant: string; role: string; updatedAt: number }
export function getLanRecentRooms(): LanRecentRoom[] {
  try {
    const value = JSON.parse(localStorage.getItem('xiangqi-lan-recent') || '[]') as unknown
    return Array.isArray(value) ? value.filter((item): item is LanRecentRoom => Boolean(
      item && typeof item === 'object' && typeof item.id === 'string' && typeof item.name === 'string' &&
      typeof item.variant === 'string' && typeof item.role === 'string' && typeof item.updatedAt === 'number',
    )) : []
  } catch { return [] }
}

export function useLanRoom(roomId: string, nickname: string) {
  const [room, setRoom] = useState<LanRoomSnapshot | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [privateHint, setPrivateHint] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<number>()
  const roomRef = useRef(room)
  const nicknameRef = useRef(nickname)
  roomRef.current = room
  nicknameRef.current = nickname

  const subscribe = useCallback((ws: WebSocket) => {
    ws.send(JSON.stringify({ type: 'room-subscribe', roomId, token: getLanToken(roomId), nickname: nicknameRef.current }))
  }, [roomId])

  useEffect(() => {
    let disposed = false
    const connect = () => {
      if (disposed) return
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocol}//${location.host}/ws`)
      wsRef.current = ws
      ws.onopen = () => { setConnected(true); setError(''); subscribe(ws) }
      ws.onmessage = event => {
        const message = JSON.parse(event.data) as Record<string, unknown>
        if (message.type === 'room-snapshot') {
          const snapshot = message.room as LanRoomSnapshot
          setRoom(snapshot)
          try {
            localStorage.setItem('xiangqi-lan-recent', JSON.stringify([
              { id: snapshot.id, name: snapshot.name, variant: snapshot.variant, role: snapshot.role, updatedAt: Date.now() },
              ...getLanRecentRooms().filter(item => item.id !== snapshot.id),
            ].slice(0, 20)))
          } catch { /* Recent-room history is optional. */ }
          if (typeof message.warning === 'string') setError(message.warning)
        } else if (message.type === 'room-seat-token') {
          saveLanToken(roomId, String(message.token))
          const url = new URL(location.href)
          url.searchParams.delete('invite')
          history.replaceState(null, '', url)
          subscribe(ws)
        } else if (message.type === 'room-private-hint') {
          setPrivateHint(String(message.move))
        } else if (message.type === 'error') setError(String(message.message || '操作失败'))
      }
      ws.onclose = () => { setConnected(false); if (!disposed) reconnectRef.current = window.setTimeout(connect, 1500) }
      ws.onerror = () => ws.close()
    }
    connect()
    return () => { disposed = true; clearTimeout(reconnectRef.current); wsRef.current?.close() }
  }, [roomId, subscribe])

  const send = useCallback((type: string, payload: Record<string, unknown> = {}) => {
    const ws = wsRef.current, current = roomRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN || !current) return false
    ws.send(JSON.stringify({ type, roomId, commandId: createLanCommandId(), expectedRevision: current.revision, ...payload }))
    setError('')
    return true
  }, [roomId])

  return { room, connected, error, privateHint, setPrivateHint, send }
}
