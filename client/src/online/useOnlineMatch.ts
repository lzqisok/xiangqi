import { useCallback, useEffect, useRef, useState } from 'react'
import { createLanCommandId } from '../lan/browser'
import type { OnlineChatMessage, OnlineMatchSnapshot } from './types'
import { mergeOnlineChat } from './model'

const COMMAND_TIMEOUT = 10_000

export function useOnlineMatch(matchId: string) {
  const [match, setMatch] = useState<OnlineMatchSnapshot | null>(null)
  const [messages, setMessages] = useState<OnlineChatMessage[]>([])
  const [connected, setConnected] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<number>()
  const timeoutRef = useRef<number>()
  const matchRef = useRef(match)
  matchRef.current = match

  const finish = useCallback(() => {
    clearTimeout(timeoutRef.current)
    timeoutRef.current = undefined
    setPending(false)
  }, [])

  useEffect(() => {
    let disposed = false
    const connect = () => {
      if (disposed) return
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(`${protocol}//${location.host}/ws`)
      socketRef.current = socket
      socket.onopen = () => {
        setConnected(true)
        setError('')
        socket.send(JSON.stringify({ type: 'match-subscribe', matchId }))
      }
      socket.onmessage = (event) => {
        let message: Record<string, unknown>
        try {
          message = JSON.parse(String(event.data)) as Record<string, unknown>
        } catch {
          setError('收到无法识别的服务端消息')
          return
        }
        if (message.type === 'match-snapshot') {
          setMatch(message.match as OnlineMatchSnapshot)
          setError('')
          finish()
        } else if (message.type === 'match-chat-history') {
          setMessages(Array.isArray(message.messages) ? (message.messages as OnlineChatMessage[]) : [])
        } else if (message.type === 'match-chat-message') {
          const next = message.message as OnlineChatMessage
          if (next?.id) {
            setMessages((current) => mergeOnlineChat(current, next))
          }
          finish()
        } else if (message.type === 'match-chat-delete') {
          setMessages((current) => current.filter((item) => item.id !== String(message.messageId)))
          finish()
        } else if (message.type === 'match-command-ack') {
          finish()
        } else if (message.type === 'match-error' || message.type === 'error') {
          finish()
          setError(String(message.message || message.code || '操作失败'))
          if (Number.isInteger(message.currentRevision)) {
            socket.send(JSON.stringify({ type: 'match-subscribe', matchId }))
          }
        }
      }
      socket.onclose = (event) => {
        setConnected(false)
        finish()
        if (event.code === 4001) setError('席位已由同一账号的新连接接管')
        else if (!disposed) reconnectRef.current = window.setTimeout(connect, 1_500)
      }
      socket.onerror = () => socket.close()
    }
    connect()
    return () => {
      disposed = true
      clearTimeout(reconnectRef.current)
      finish()
      socketRef.current?.close()
    }
  }, [finish, matchId])

  const send = useCallback(
    (type: string, payload: Record<string, unknown> = {}) => {
      const socket = socketRef.current
      const current = matchRef.current
      if (!socket || socket.readyState !== WebSocket.OPEN || !current || pending) return false
      socket.send(
        JSON.stringify({
          type,
          matchId,
          commandId: createLanCommandId(),
          expectedRevision: current.revision,
          ...payload,
        }),
      )
      setPending(true)
      setError('')
      clearTimeout(timeoutRef.current)
      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = undefined
        setPending(false)
        setError('操作响应超时，请检查网络后重试')
      }, COMMAND_TIMEOUT)
      return true
    },
    [matchId, pending],
  )

  return {
    match,
    messages,
    connected,
    pending,
    error,
    send,
    sendChat: (content: string) => send('match-chat-send', { content }),
  }
}
