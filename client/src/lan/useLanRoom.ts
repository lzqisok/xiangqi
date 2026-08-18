import { useCallback, useEffect, useRef, useState } from 'react'
import { createLanCommandId } from './browser'
import { mergeLanChatMessage } from './chat'
import { AnyLanRoomSnapshot, LanChatMessage, LanChatSettings, LanRoomSnapshot } from './types'

const COMMAND_TIMEOUT_MS = 10_000
const HINT_TIMEOUT_MS = 70_000
const COMMAND_TIMEOUT_ERROR = '操作响应超时，请检查连接后重试'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function key(id: string) {
  return `xiangqi-lan-room:${id}`
}
function getChatClientId() {
  const storageKey = 'xiangqi-lan-chat-client-id'
  try {
    const current = localStorage.getItem(storageKey)
    if (current && UUID.test(current)) return current
    const created = createLanCommandId()
    localStorage.setItem(storageKey, created)
    return created
  } catch {
    return createLanCommandId()
  }
}
export function getLanToken(id: string) {
  try {
    return localStorage.getItem(key(id)) || ''
  } catch {
    return ''
  }
}
export function saveLanToken(id: string, token: string) {
  try {
    localStorage.setItem(key(id), token)
    return true
  } catch {
    return false
  }
}
export function forgetLanRoom(id: string) {
  try {
    localStorage.removeItem(key(id))
    localStorage.removeItem(`xiangqi-lan-invite:${id}`)
    const recent = getLanRecentRooms().filter((item) => item.id !== id)
    localStorage.setItem('xiangqi-lan-recent', JSON.stringify(recent))
  } catch {
    /* Storage is optional. */
  }
}
export type LanRecentRoom = {
  id: string
  name: string
  variant: string
  role: string
  updatedAt: number
}
export function getLanRecentRooms(): LanRecentRoom[] {
  try {
    const value = JSON.parse(localStorage.getItem('xiangqi-lan-recent') || '[]') as unknown
    return Array.isArray(value)
      ? value.filter((item): item is LanRecentRoom =>
          Boolean(
            item &&
            typeof item === 'object' &&
            typeof item.id === 'string' &&
            typeof item.name === 'string' &&
            typeof item.variant === 'string' &&
            typeof item.role === 'string' &&
            typeof item.updatedAt === 'number',
          ),
        )
      : []
  } catch {
    return []
  }
}

export function useLanRoom<T extends AnyLanRoomSnapshot = LanRoomSnapshot>(
  roomId: string,
  nickname: string,
) {
  const [room, setRoom] = useState<T | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [privateHint, setPrivateHint] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [chatMessages, setChatMessages] = useState<LanChatMessage[]>([])
  const [chatError, setChatError] = useState('')
  const [chatSettings, setChatSettings] = useState<LanChatSettings>({
    everyoneMuted: false,
    muted: false,
  })
  const [recoveryToken, setRecoveryToken] = useState(() => getLanToken(roomId))
  const wsRef = useRef<WebSocket | null>(null)
  const tokenRef = useRef(getLanToken(roomId))
  const reconnectRef = useRef<number>()
  const pendingTimerRef = useRef<number>()
  const chatTimersRef = useRef(new Map<string, number>())
  const chatCommandIdsRef = useRef(new Set<string>())
  const roomRef = useRef(room)
  const nicknameRef = useRef(nickname)
  const [chatClientId] = useState(getChatClientId)
  roomRef.current = room
  nicknameRef.current = nickname

  const finishPending = useCallback(() => {
    clearTimeout(pendingTimerRef.current)
    pendingTimerRef.current = undefined
    setPending(false)
  }, [])

  const finishChatCommand = useCallback((commandId: string) => {
    const timer = chatTimersRef.current.get(commandId)
    if (timer !== undefined) clearTimeout(timer)
    chatTimersRef.current.delete(commandId)
    chatCommandIdsRef.current.delete(commandId)
  }, [])

  const subscribe = useCallback(
    (ws: WebSocket) => {
      ws.send(
        JSON.stringify({
          type: 'room-subscribe',
          roomId,
          token: tokenRef.current,
          nickname: nicknameRef.current,
          clientId: chatClientId,
        }),
      )
    },
    [chatClientId, roomId],
  )

  useEffect(() => {
    let disposed = false
    const seatToken = new URLSearchParams(location.search).get('seat')
    if (seatToken) {
      tokenRef.current = seatToken
      saveLanToken(roomId, seatToken)
      setRecoveryToken(seatToken)
      const url = new URL(location.href)
      url.searchParams.delete('seat')
      history.replaceState(null, '', url)
    }
    const connect = () => {
      if (disposed) return
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocol}//${location.host}/ws`)
      wsRef.current = ws
      ws.onopen = () => {
        setConnected(true)
        setError('')
        subscribe(ws)
      }
      ws.onmessage = (event) => {
        let message: Record<string, unknown>
        try {
          message = JSON.parse(event.data) as Record<string, unknown>
        } catch {
          setError('收到无法识别的服务端消息')
          return
        }
        if (message.type === 'room-snapshot') {
          const snapshot = message.room as T
          setRoom(snapshot)
          try {
            localStorage.setItem(
              'xiangqi-lan-recent',
              JSON.stringify(
                [
                  {
                    id: snapshot.id,
                    name: snapshot.name,
                    variant: snapshot.variant,
                    role: snapshot.role,
                    updatedAt: Date.now(),
                  },
                  ...getLanRecentRooms().filter((item) => item.id !== snapshot.id),
                ].slice(0, 20),
              ),
            )
          } catch {
            /* Recent-room history is optional. */
          }
          if (!snapshot.inviteAvailable)
            try {
              localStorage.removeItem(`xiangqi-lan-invite:${roomId}`)
            } catch {
              /* Storage is optional. */
            }
          if (typeof message.warning === 'string') setError(message.warning)
          else setError((current) => (current === COMMAND_TIMEOUT_ERROR ? '' : current))
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
          try {
            localStorage.setItem(`xiangqi-lan-invite:${roomId}`, String(message.inviteToken))
          } catch {
            setError('浏览器无法保存新的邀请链接')
          }
        } else if (message.type === 'room-private-hint') {
          setPrivateHint(String(message.move))
          finishPending()
        } else if (message.type === 'room-chat-history') {
          const messages = Array.isArray(message.messages)
            ? (message.messages as LanChatMessage[])
            : []
          setChatMessages(messages.slice(-100))
        } else if (message.type === 'room-chat-message') {
          const chatMessage = message.message as LanChatMessage
          if (chatMessage && typeof chatMessage.id === 'string')
            setChatMessages((current) => mergeLanChatMessage(current, chatMessage))
          setChatError('')
        } else if (message.type === 'room-chat-settings') {
          setChatSettings(message.settings as LanChatSettings)
        } else if (message.type === 'room-chat-delete') {
          setChatMessages((current) =>
            current.filter((item) => item.id !== String(message.messageId)),
          )
        } else if (message.type === 'room-chat-ack') {
          finishChatCommand(String(message.commandId || ''))
        } else if (message.type === 'room-seat-lost') {
          if (!roomRef.current?.isOwner) {
            tokenRef.current = ''
            setRecoveryToken('')
            try {
              localStorage.removeItem(key(roomId))
            } catch {
              /* Storage is optional. */
            }
          }
        } else if (message.type === 'room-closed') {
          forgetLanRoom(roomId)
          location.href = roomRef.current?.variant === 'gomoku' ? '?gomoku=1&lan=1' : '?lan=1'
        } else if (message.type === 'error') {
          const requestId = String(message.requestId || '')
          if (chatCommandIdsRef.current.has(requestId)) {
            finishChatCommand(requestId)
            setChatError(String(message.message || '发送失败'))
          } else {
            finishPending()
            setError(String(message.message || '操作失败'))
          }
        }
      }
      ws.onclose = () => {
        setConnected(false)
        finishPending()
        for (const commandId of chatTimersRef.current.keys()) finishChatCommand(commandId)
        chatCommandIdsRef.current.clear()
        if (!disposed) reconnectRef.current = window.setTimeout(connect, 1500)
      }
      ws.onerror = () => ws.close()
    }
    connect()
    return () => {
      disposed = true
      clearTimeout(reconnectRef.current)
      finishPending()
      for (const commandId of chatTimersRef.current.keys()) finishChatCommand(commandId)
      chatCommandIdsRef.current.clear()
      wsRef.current?.close()
    }
  }, [finishChatCommand, finishPending, roomId, subscribe])

  const send = useCallback(
    (type: string, payload: Record<string, unknown> = {}) => {
      const ws = wsRef.current,
        current = roomRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN || !current) return false
      ws.send(
        JSON.stringify({
          type,
          roomId,
          commandId: createLanCommandId(),
          expectedRevision: current.revision,
          ...payload,
        }),
      )
      clearTimeout(pendingTimerRef.current)
      pendingTimerRef.current = window.setTimeout(
        () => {
          pendingTimerRef.current = undefined
          setPending(false)
          setError(COMMAND_TIMEOUT_ERROR)
        },
        type === 'room-hint' ? HINT_TIMEOUT_MS : COMMAND_TIMEOUT_MS,
      )
      setPending(true)
      setError('')
      return true
    },
    [roomId],
  )

  const sendChatCommand = useCallback(
    (
      type: 'room-chat-send' | 'room-chat-delete' | 'room-chat-mute' | 'room-chat-settings-update',
      payload: Record<string, unknown>,
    ) => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setChatError('聊天连接尚未建立')
        return false
      }
      const commandId = createLanCommandId()
      ws.send(JSON.stringify({ type, roomId, commandId, ...payload }))
      chatCommandIdsRef.current.add(commandId)
      while (chatCommandIdsRef.current.size > 100) {
        const oldest = chatCommandIdsRef.current.values().next().value!
        clearTimeout(chatTimersRef.current.get(oldest))
        chatTimersRef.current.delete(oldest)
        chatCommandIdsRef.current.delete(oldest)
      }
      chatTimersRef.current.set(
        commandId,
        window.setTimeout(() => {
          chatTimersRef.current.delete(commandId)
          setChatError('聊天操作响应超时，请检查连接后重试')
        }, COMMAND_TIMEOUT_MS),
      )
      setChatError('')
      return true
    },
    [roomId],
  )

  return {
    room,
    connected,
    error,
    privateHint,
    setPrivateHint,
    pending,
    recoveryToken,
    send,
    chatMessages,
    chatError,
    chatSettings,
    sendChat: (content: string) =>
      sendChatCommand('room-chat-send', {
        content,
        nickname: nicknameRef.current,
      }),
    deleteChatMessage: (messageId: string) => sendChatCommand('room-chat-delete', { messageId }),
    muteChatMember: (authorId: string, muted: boolean) =>
      sendChatCommand('room-chat-mute', { authorId, muted }),
    updateChatSettings: (everyoneMuted: boolean, roomSensitiveWords: string[]) =>
      sendChatCommand('room-chat-settings-update', {
        everyoneMuted,
        roomSensitiveWords,
      }),
  }
}
