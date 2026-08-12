import { useCallback, useEffect, useRef, useState } from 'react'
import { createLanCommandId } from './browser'
import { LanRoomSnapshot } from './types'

const COMMAND_TIMEOUT_MS = 10_000
const HINT_TIMEOUT_MS = 70_000
const COMMAND_TIMEOUT_ERROR = '操作响应超时，请检查连接后重试'

function key(id: string) { return `xiangqi-lan-room:${id}` }
export function getLanToken(id: string) { try { return localStorage.getItem(key(id)) || '' } catch { return '' } }
export function saveLanToken(id: string, token: string) { try { localStorage.setItem(key(id), token); return true } catch { return false } }
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
  const [pending, setPending] = useState(false)
  const [recoveryToken, setRecoveryToken] = useState(() => getLanToken(roomId))
  const wsRef = useRef<WebSocket | null>(null)
  const tokenRef = useRef(getLanToken(roomId))
  const reconnectRef = useRef<number>()
  const pendingTimerRef = useRef<number>()
  const roomRef = useRef(room)
  const nicknameRef = useRef(nickname)
  roomRef.current = room
  nicknameRef.current = nickname

  const finishPending = useCallback(() => {
    clearTimeout(pendingTimerRef.current)
    pendingTimerRef.current = undefined
    setPending(false)
  }, [])

  const subscribe = useCallback((ws: WebSocket) => {
    ws.send(JSON.stringify({ type: 'room-subscribe', roomId, token: tokenRef.current, nickname: nicknameRef.current }))
  }, [roomId])

  useEffect(() => {
    let disposed = false
    const seatToken = new URLSearchParams(location.search).get('seat')
    if (seatToken) {
      tokenRef.current = seatToken
      saveLanToken(roomId, seatToken)
      setRecoveryToken(seatToken)
      const url = new URL(location.href); url.searchParams.delete('seat'); history.replaceState(null, '', url)
    }
    const connect = () => {
      if (disposed) return
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocol}//${location.host}/ws`)
      wsRef.current = ws
      ws.onopen = () => { setConnected(true); setError(''); subscribe(ws) }
      ws.onmessage = event => {
        let message: Record<string, unknown>
        try { message = JSON.parse(event.data) as Record<string, unknown> } catch { setError('收到无法识别的服务端消息'); return }
        if (message.type === 'room-snapshot') {
          const snapshot = message.room as LanRoomSnapshot
          setRoom(snapshot)
          try {
            localStorage.setItem('xiangqi-lan-recent', JSON.stringify([
              { id: snapshot.id, name: snapshot.name, variant: snapshot.variant, role: snapshot.role, updatedAt: Date.now() },
              ...getLanRecentRooms().filter(item => item.id !== snapshot.id),
            ].slice(0, 20)))
          } catch { /* Recent-room history is optional. */ }
          if (!snapshot.inviteAvailable) try { localStorage.removeItem(`xiangqi-lan-invite:${roomId}`) } catch { /* Storage is optional. */ }
          if (typeof message.warning === 'string') setError(message.warning)
          else setError(current => current === COMMAND_TIMEOUT_ERROR ? '' : current)
          finishPending()
        } else if (message.type === 'room-seat-token') {
          const token = String(message.token)
          tokenRef.current = token
          setRecoveryToken(token)
          const saved = saveLanToken(roomId, token)
          if (!saved) setError('浏览器无法保存席位凭据，请立即复制席位恢复链接')
          const url = new URL(location.href)
          url.searchParams.delete('invite')
          history.replaceState(null, '', url)
          subscribe(ws)
        } else if (message.type === 'room-invite-token') {
          try { localStorage.setItem(`xiangqi-lan-invite:${roomId}`, String(message.inviteToken)) } catch { setError('浏览器无法保存新的邀请链接') }
        } else if (message.type === 'room-private-hint') {
          setPrivateHint(String(message.move))
          finishPending()
        } else if (message.type === 'room-closed') {
          location.href = '?lan=1'
        } else if (message.type === 'error') { finishPending(); setError(String(message.message || '操作失败')) }
      }
      ws.onclose = () => { setConnected(false); finishPending(); if (!disposed) reconnectRef.current = window.setTimeout(connect, 1500) }
      ws.onerror = () => ws.close()
    }
    connect()
    return () => { disposed = true; clearTimeout(reconnectRef.current); finishPending(); wsRef.current?.close() }
  }, [finishPending, roomId, subscribe])

  const send = useCallback((type: string, payload: Record<string, unknown> = {}) => {
    const ws = wsRef.current, current = roomRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN || !current) return false
    ws.send(JSON.stringify({ type, roomId, commandId: createLanCommandId(), expectedRevision: current.revision, ...payload }))
    clearTimeout(pendingTimerRef.current)
    pendingTimerRef.current = window.setTimeout(() => {
      pendingTimerRef.current = undefined
      setPending(false)
      setError(COMMAND_TIMEOUT_ERROR)
    }, type === 'room-hint' ? HINT_TIMEOUT_MS : COMMAND_TIMEOUT_MS)
    setPending(true)
    setError('')
    return true
  }, [roomId])

  return { room, connected, error, privateHint, setPrivateHint, pending, recoveryToken, send }
}
