import { useRef, useEffect, useCallback, useState } from 'react'
import { ConnectionState, WSMessage } from '../types'

export function useWebSocket(onMessage: (msg: WSMessage) => void) {
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting')
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage
  const intentionalClose = useRef(false)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>()

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING) {
      return
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.hostname
    setConnectionState('connecting')
    const ws = new WebSocket(`${protocol}//${host}:3001/ws`)

    ws.onopen = () => {
      setConnected(true)
      setConnectionState('connected')
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WSMessage
        onMessageRef.current(msg)
      } catch {
        // ignore
      }
    }

    ws.onclose = () => {
      setConnected(false)
      setConnectionState('disconnected')
      if (!intentionalClose.current) {
        reconnectTimer.current = setTimeout(connect, 2000)
      }
    }

    ws.onerror = () => {
      ws.close()
    }

    wsRef.current = ws
  }, [])

  useEffect(() => {
    intentionalClose.current = false
    connect()
    return () => {
      intentionalClose.current = true
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [connect])

  const send = useCallback((msg: WSMessage): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
      return true
    }
    return false
  }, [])

  return { send, connected, connectionState }
}
