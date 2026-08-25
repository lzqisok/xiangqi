import { type MouseEvent, useEffect, useMemo, useRef, useState } from 'react'
import Board from '../components/Board'
import JieqiRecordReplay from '../components/JieqiRecordReplay'
import ProductDialog from '../components/ProductDialog'
import MobileChatDock from '../components/MobileChatDock'
import ProductState from '../components/ProductState'
import { LanQuickMatch, LanReadySeat, LanRoomCard } from './LanProduct'
import { getLegalMoves, isInCheck } from '../engine/rules'
import { uciToMove } from '../engine/notation'
import { Move, PieceColor, Position } from '../types'
import { upsertJieqiSeatRecord } from '../jieqi-record/storage'
import { createLanRoom, listLanRoomHistory, listLanRooms, quickMatchLanRoom } from './api'
import { copyLanText } from './browser'
import { resolveLanShareUrl } from './network'
import {
  getLanChatContentLength,
  getLanChatLineCount,
  getLanChatRole,
  parseLanRoomSensitiveWords,
} from './chat'
import { LanChatMessage, LanRoomSummary } from './types'
import { getLanRecentRooms, getLanToken, saveLanToken, useLanRoom } from './useLanRoom'
import { quickMatchKey, quickMatchRoomUrl } from './quickMatch'
import { authorizeLanJieqiRecord } from './jieqiRecord'

const NICKNAME_KEY = 'xiangqi-lan-nickname'
function storageGet(key: string) {
  try {
    return localStorage.getItem(key) || ''
  } catch {
    return ''
  }
}
function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* Storage is optional. */
  }
}

export default function LanApp() {
  const params = new URLSearchParams(location.search)
  const roomId = params.get('room')
  const [nickname, setNickname] = useState(() => storageGet(NICKNAME_KEY))
  if (roomId)
    return (
      <LanRoom
        roomId={roomId}
        nickname={nickname || '访客'}
        onNickname={(value) => {
          setNickname(value)
          storageSet(NICKNAME_KEY, value)
        }}
      />
    )
  return (
    <LanLobby
      nickname={nickname}
      onNickname={(value) => {
        setNickname(value)
        storageSet(NICKNAME_KEY, value)
      }}
    />
  )
}

function LanLobby({
  nickname,
  onNickname,
}: {
  nickname: string
  onNickname: (value: string) => void
}) {
  const [rooms, setRooms] = useState<LanRoomSummary[]>([])
  const [historyRooms, setHistoryRooms] = useState<LanRoomSummary[]>([])
  const [name, setName] = useState('局域网对局')
  const [variant, setVariant] = useState<'xiangqi' | 'jieqi'>('xiangqi')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [matching, setMatching] = useState(false)
  const [lobbyView, setLobbyView] = useState<'find' | 'create'>('find')
  const [roomFilter, setRoomFilter] = useState<
    'all' | 'waiting' | 'playing' | 'finished' | 'recent'
  >('waiting')
  const recent = useMemo(() => getLanRecentRooms().filter((item) => item.variant !== 'gomoku'), [])
  useEffect(() => {
    let active = true
    const refresh = () =>
      Promise.all([listLanRooms(), listLanRoomHistory()])
        .then(([activeRooms, finishedRooms]) => {
          if (active) {
            setRooms(activeRooms)
            setHistoryRooms(finishedRooms)
          }
        })
        .catch((cause) => active && setError(cause.message))
    refresh()
    const timer = setInterval(refresh, 3000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])
  const enter = (id: string, invite?: string) => {
    const url = new URL(location.href)
    url.searchParams.set('lan', '1')
    url.searchParams.set('room', id)
    if (invite) url.searchParams.set('invite', invite)
    location.href = url.toString()
  }
  const create = async () => {
    if (!nickname.trim() || creating) return
    setCreating(true)
    setError('')
    try {
      const result = await createLanRoom(name, variant)
      saveLanToken(result.room.id, result.ownerToken)
      storageSet(`xiangqi-lan-invite:${result.room.id}`, result.inviteToken)
      enter(result.room.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建失败')
      setCreating(false)
    }
  }
  const quickMatch = async () => {
    if (!nickname.trim() || matching) return
    setMatching(true)
    setError('')
    try {
      const result = await quickMatchLanRoom(nickname, variant)
      saveLanToken(result.room.id, result.token)
      location.href = quickMatchRoomUrl(location.href, result.room.id, quickMatchKey(variant))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '快速匹配失败')
      setMatching(false)
    }
  }
  const roomIds = new Set([...rooms, ...historyRooms].map((room) => room.id))
  const roomItems = [
    ...rooms.map((room) => ({
      room,
      recent: recent.some((item) => item.id === room.id),
    })),
    ...historyRooms.map((room) => ({
      room,
      recent: recent.some((item) => item.id === room.id),
    })),
  ].filter((item) =>
    roomFilter === 'all' || roomFilter === 'recent'
      ? roomFilter !== 'recent' || item.recent
      : item.room.phase === roomFilter,
  )
  const recentOnly = roomFilter === 'recent' ? recent.filter((item) => !roomIds.has(item.id)) : []
  return (
    <div className="lan-shell">
      <header className="lan-header">
        <div>
          <h1>象棋局域网对战</h1>
          <p>同一局域网内创建对局、邀请棋友、聊天或观战</p>
        </div>
        <a href="?type=xiangqi">返回模式选择</a>
      </header>
      <nav className="lan-lobby-switch" aria-label="局域网大厅功能">
        <button
          className={lobbyView === 'find' ? 'active' : ''}
          onClick={() => setLobbyView('find')}
        >
          <strong>找对局</strong>
          <span>浏览可加入、进行中和历史对局</span>
        </button>
        <button
          className={lobbyView === 'create' ? 'active' : ''}
          onClick={() => setLobbyView('create')}
        >
          <strong>创建对局</strong>
          <span>选择规则并邀请棋友</span>
        </button>
      </nav>
      {lobbyView === 'find' && (
        <LanQuickMatch
          nickname={nickname}
          onNickname={onNickname}
          options={[
            { value: 'xiangqi', label: '普通象棋', description: '标准规则' },
            { value: 'jieqi', label: '揭棋', description: '暗子玩法' },
          ]}
          selected={variant}
          onSelect={setVariant}
          matching={matching}
          onMatch={() => void quickMatch()}
        />
      )}
      {lobbyView === 'create' && (
        <form
          className="lan-create card"
          onSubmit={(event) => {
            event.preventDefault()
            void create()
          }}
        >
          <div className="lan-create-heading">
            <div>
              <h2>创建新对局</h2>
              <p>填写信息并选择玩法，创建后进入独立准备室。</p>
            </div>
            <span>1 分钟内最多创建 10 个对局</span>
          </div>
          <div className="lan-form-grid">
            <label>
              你的昵称
              <input
                value={nickname}
                maxLength={20}
                onChange={(e) => onNickname(e.target.value)}
                placeholder="例如：棋友小李"
                autoComplete="nickname"
              />
            </label>
            <label>
              对局名称
              <input
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：周末切磋"
              />
            </label>
          </div>
          <fieldset className="lan-variant-picker">
            <legend>选择玩法</legend>
            <button
              type="button"
              className={variant === 'xiangqi' ? 'active' : ''}
              onClick={() => setVariant('xiangqi')}
            >
              <strong>普通象棋</strong>
              <span>标准规则，支持协商悔棋</span>
              <i>{variant === 'xiangqi' ? '已选择' : '选择'}</i>
            </button>
            <button
              type="button"
              className={variant === 'jieqi' ? 'active' : ''}
              onClick={() => setVariant('jieqi')}
            >
              <strong>揭棋</strong>
              <span>暗子随机分配，移动后揭晓身份</span>
              <i>{variant === 'jieqi' ? '已选择' : '选择'}</i>
            </button>
          </fieldset>
          <button
            className="lan-create-submit"
            type="submit"
            disabled={!nickname.trim() || creating}
          >
            {creating ? '正在创建并进入…' : `创建${variant === 'jieqi' ? '揭棋' : '普通象棋'}对局`}
          </button>
        </form>
      )}
      {error && (
        <div className="lan-error">
          <ProductState kind="error" title="大厅暂时不可用" description={error} />
        </div>
      )}
      {lobbyView === 'find' && (
        <section className="lan-lobby card">
          <div className="lan-lobby-heading">
            <div>
              <h2>对局大厅</h2>
              <p>可加入和进行中属于实时对局，已结束仅供查看记录</p>
            </div>
            <div className="lan-room-filters">
              {(['all', 'waiting', 'playing', 'finished', 'recent'] as const).map((filter) => (
                <button
                  className={roomFilter === filter ? 'active' : ''}
                  key={filter}
                  onClick={() => setRoomFilter(filter)}
                >
                  {
                    {
                      all: '全部',
                      waiting: '可加入',
                      playing: '进行中',
                      finished: '历史记录',
                      recent: '最近进入',
                    }[filter]
                  }
                </button>
              ))}
            </div>
          </div>
          {roomItems.length === 0 && recentOnly.length === 0 ? (
            <ProductState
              title="当前筛选下没有对局"
              description={
                roomFilter === 'waiting'
                  ? '可以创建一个对局并邀请棋友加入。'
                  : '切换筛选条件看看其他对局。'
              }
            />
          ) : (
            <div className="lan-room-list">
              {roomItems.map(({ room, recent: isRecent }) => (
                <LanRoomCard
                  key={room.id}
                  name={room.name}
                  meta={`${room.variant === 'jieqi' ? '揭棋' : '普通象棋'} · ${room.phase === 'waiting' ? '可加入' : room.phase === 'playing' ? '进行中' : formatResult(room.status, room.statusReason)}${isRecent ? ' · 最近进入' : ''}`}
                  details={`红：${room.red || '空席'}　黑：${room.black || '空席'}　${room.phase === 'finished' ? `共 ${room.moveCount} 手` : `观众 ${room.spectatorCount}`}`}
                  actionLabel={
                    room.phase === 'waiting'
                      ? '加入对局'
                      : room.phase === 'playing'
                        ? '进入观战'
                        : '查看结果'
                  }
                  onOpen={() => enter(room.id)}
                />
              ))}
              {recentOnly.map((item) => (
                <LanRoomCard
                  key={item.id}
                  name={item.name}
                  meta={`${item.variant === 'jieqi' ? '揭棋' : '普通象棋'} · 最近进入`}
                  details={
                    item.role === 'red'
                      ? '红方席位'
                      : item.role === 'black'
                        ? '黑方席位'
                        : item.role === 'owner'
                          ? '发起人'
                          : '观众'
                  }
                  actionLabel="查看记录"
                  onOpen={() => enter(item.id)}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function LanRoom({
  roomId,
  nickname,
  onNickname,
}: {
  roomId: string
  nickname: string
  onNickname: (value: string) => void
}) {
  const {
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
    sendChat,
    deleteChatMessage,
    muteChatMember,
    updateChatSettings,
    disableQuickMatchRecovery,
  } = useLanRoom(roomId, nickname)
  const [selected, setSelected] = useState<Position | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'manual'>('idle')
  const [recoveryCopyState, setRecoveryCopyState] = useState<'idle' | 'copied' | 'manual'>('idle')
  const [manualInviteUrl, setManualInviteUrl] = useState('')
  const [manualRecoveryUrl, setManualRecoveryUrl] = useState('')
  const [spectatorFlipped, setSpectatorFlipped] = useState(false)
  const [creatingRematch, setCreatingRematch] = useState(false)
  const [rematchError, setRematchError] = useState('')
  const [dangerAction, setDangerAction] = useState<'dissolve' | 'resign' | null>(null)
  const [returnAction, setReturnAction] = useState<'leave-seat' | 'disconnect' | null>(null)
  const [returnAfterLeaving, setReturnAfterLeaving] = useState(false)
  const [jieqiReplayOpen, setJieqiReplayOpen] = useState(false)
  const savedJieqiRecordRef = useRef('')
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    setSelected(null)
  }, [room?.revision])
  useEffect(() => {
    setPrivateHint(null)
  }, [room?.moves.length, setPrivateHint])
  useEffect(() => {
    if (returnAfterLeaving && room?.phase === 'waiting' && room.role === 'spectator')
      location.href = '?lan=1'
  }, [returnAfterLeaving, room?.phase, room?.role])
  const legal = useMemo(
    () => (selected && room ? getLegalMoves(room.board, selected, room.variant) : []),
    [room, selected],
  )
  const authorizedJieqiRecord = useMemo(() => {
    if (!room || room.variant !== 'jieqi' || room.phase !== 'finished') return null
    return authorizeLanJieqiRecord(room.jieqiRecord, room.role)
  }, [room])
  useEffect(() => {
    if (
      !authorizedJieqiRecord ||
      (authorizedJieqiRecord.audience !== 'red' && authorizedJieqiRecord.audience !== 'black')
    ) {
      return
    }
    const key = `${authorizedJieqiRecord.recordId}:${authorizedJieqiRecord.updatedAt}`
    if (savedJieqiRecordRef.current === key) return
    try {
      upsertJieqiSeatRecord(authorizedJieqiRecord)
      savedJieqiRecordRef.current = key
    } catch {
      // Keep the result page available if local private storage rejects the projection.
    }
  }, [authorizedJieqiRecord])
  if (!room)
    return (
      <div className="lan-shell lan-room-shell">
        <ProductState
          kind={error ? 'error' : 'loading'}
          title={error ? '无法打开对局' : connected ? '正在同步对局' : '正在连接服务'}
          description={error || '请稍候，正在恢复对局阶段与席位。'}
        />
      </div>
    )
  if (jieqiReplayOpen && authorizedJieqiRecord) {
    return (
      <JieqiRecordReplay
        record={authorizedJieqiRecord}
        initialPly={authorizedJieqiRecord.events.length}
        backLabel="返回对局结果"
        onBack={() => setJieqiReplayOpen(false)}
      />
    )
  }
  const color = room.role === 'red' || room.role === 'black' ? room.role : null
  const requestReturn = (event: MouseEvent<HTMLAnchorElement>) => {
    if (room.phase === 'waiting' && room.isOwner) {
      event.preventDefault()
      setDangerAction('dissolve')
    } else if (room.phase === 'waiting' && color) {
      event.preventDefault()
      setReturnAction('leave-seat')
    } else if (room.phase === 'playing' && color) {
      event.preventDefault()
      setReturnAction('disconnect')
    }
  }
  const boardFlipped = color === 'black' || (!color && spectatorFlipped)
  const canMove = room.phase === 'playing' && room.status === 'playing' && color === room.turn
  const last = room.moves[room.moves.length - 1]
  const lastMove: Move | null = last
    ? (() => {
        const positions = uciToMove(last.uci)
        const piece = room.board[positions.to.row][positions.to.col]
        return piece ? { ...positions, piece } : null
      })()
    : null
  const hintMove: Move | null = privateHint
    ? (() => {
        try {
          const positions = uciToMove(privateHint)
          const piece = room.board[positions.from.row][positions.from.col]
          return piece ? { ...positions, piece } : null
        } catch {
          return null
        }
      })()
    : null
  const click = (position: Position) => {
    if (!canMove) return
    if (selected && legal.some((item) => item.row === position.row && item.col === position.col)) {
      send('room-move', {
        uci: `${String.fromCharCode(97 + selected.col)}${9 - selected.row}${String.fromCharCode(97 + position.col)}${9 - position.row}`,
      })
      setSelected(null)
      return
    }
    setSelected(room.board[position.row][position.col]?.color === color ? position : null)
  }
  const incomingInvite = new URLSearchParams(location.search).get('invite') || ''
  const shareToken = storageGet(`xiangqi-lan-invite:${roomId}`)
  const inviteUrl = (() => {
    const url = new URL(location.href)
    url.searchParams.set('invite', shareToken)
    return url.toString()
  })()
  const shareInvite = async () => {
    const resolvedUrl = await resolveLanShareUrl(inviteUrl)
    setManualInviteUrl(resolvedUrl)
    const copied = await copyLanText(resolvedUrl)
    setCopyState(copied ? 'copied' : 'manual')
    if (copied) setTimeout(() => setCopyState('idle'), 1500)
  }
  const recoveryUrl = (() => {
    const url = new URL(location.href)
    url.searchParams.delete('invite')
    url.searchParams.set('seat', recoveryToken || getLanToken(roomId))
    return url.toString()
  })()
  const shareRecovery = async () => {
    const resolvedUrl = await resolveLanShareUrl(recoveryUrl)
    setManualRecoveryUrl(resolvedUrl)
    const copied = await copyLanText(resolvedUrl)
    setRecoveryCopyState(copied ? 'copied' : 'manual')
    if (copied) setTimeout(() => setRecoveryCopyState('idle'), 1500)
  }
  const rematch = async () => {
    if (creatingRematch) return
    setCreatingRematch(true)
    setRematchError('')
    try {
      const result = await createLanRoom(`${room.name} · 再来一局`, room.variant)
      saveLanToken(result.room.id, result.ownerToken)
      storageSet(`xiangqi-lan-invite:${result.room.id}`, result.inviteToken)
      const url = new URL(location.href)
      url.searchParams.set('room', result.room.id)
      location.href = url.toString()
    } catch (cause) {
      setRematchError(cause instanceof Error ? cause.message : '创建新对局失败')
    } finally {
      setCreatingRematch(false)
    }
  }
  const actionForSeat = (side: PieceColor) => {
    if (incomingInvite) send('room-invite-seat', { inviteToken: incomingInvite, side, nickname })
    else if (room.isOwner) send('room-claim-seat', { side, nickname })
    else send('room-seat-request', { side, nickname })
  }
  const actOnBoardSeat = (side: PieceColor) => {
    if (color === side) return send('room-ready', { ready: !room.seats[side]!.ready })
    if (!color) return actionForSeat(side)
    if (room.seats[side]) return send('room-swap-request')
    return send('room-switch-seat', { side })
  }
  const boardSeatLabel = (side: PieceColor) => {
    const seat = room.seats[side],
      sideName = side === 'red' ? '红方' : '黑方'
    if (color === side) return seat?.ready ? '取消准备' : '准备开局'
    if (color && seat) return room.pendingSwapBy ? '换边申请中' : `申请切换为${sideName}`
    if (color) return `切换为${sideName}`
    if (seat) return '席位已占用'
    return incomingInvite || room.isOwner ? `成为${sideName}` : `申请成为${sideName}`
  }
  const proposalCountdown = (deadline?: number) =>
    deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null
  const ownerOfflineCountdown = proposalCountdown(room.ownerDisconnectDeadline)
  const seatStatus = (side: PieceColor) => {
    const seat = room.seats[side]
    if (!seat) return '席位空缺'
    const deadline = room.seatDisconnectDeadlines?.[side]
    return `${seat.nickname} · ${seat.online ? '在线' : '离线'} · ${seat.ready ? '已准备' : '未准备'}${deadline ? ` · ${proposalCountdown(deadline)} 秒后释放` : ''}`
  }
  if (room.phase === 'waiting')
    return (
      <div className="lan-shell lan-room-shell lan-ready-shell">
        <header className="lan-header">
          <div>
            <h1>{room.name}</h1>
            <p>
              {room.variant === 'jieqi' ? '揭棋' : '普通象棋'} · 准备室 ·{' '}
              {connected ? '已连接' : '重连中'}
            </p>
          </div>
          <a href="?lan=1" onClick={requestReturn}>
            返回大厅
          </a>
        </header>
        {error && <div className="lan-error">{error}</div>}
        {ownerOfflineCountdown !== null && (
          <div className="lan-warning">
            发起人已离线，对局将在 {ownerOfflineCountdown} 秒后自动取消
          </div>
        )}
        <main className="lan-ready-layout">
          <section className="lan-ready-room card">
            <div className="lan-ready-heading">
              <div>
                <small>
                  {room.matchmaking
                    ? '快速匹配'
                    : incomingInvite && !color
                      ? '棋友邀请'
                      : '等待开局'}
                </small>
                <h2>
                  {room.matchmaking
                    ? '正在寻找同玩法的在线对手'
                    : incomingInvite && !color
                      ? '确认昵称与席位后加入'
                      : '双方选择席位并准备'}
                </h2>
                <p>
                  {room.variant === 'jieqi'
                    ? '揭棋：暗子移动后揭晓，暗吃身份仅捕获方可见。'
                    : '普通象棋：红方先行，支持协商悔棋与和棋。'}
                </p>
              </div>
              <span>观众 {room.spectatorCount} 人</span>
            </div>
            <label className="lan-ready-nickname">
              对局昵称
              <input
                value={nickname}
                maxLength={20}
                disabled={room.matchmaking}
                onChange={(event) => onNickname(event.target.value)}
              />
            </label>
            <div className="lan-ready-seats">
              {(['red', 'black'] as const).map((side) => {
                const seat = room.seats[side],
                  current = color === side,
                  occupiedByOther = Boolean(seat && !current)
                const disabled =
                  pending ||
                  room.matchmaking ||
                  ownerOfflineCountdown !== null ||
                  Boolean(room.pendingSwapBy) ||
                  (!color && occupiedByOther) ||
                  (!color && !seat && !nickname.trim())
                return (
                  <LanReadySeat
                    key={side}
                    side={side}
                    mark={side === 'red' ? '红' : '黑'}
                    title={side === 'red' ? '红方 · 先行' : '黑方 · 后手'}
                    status={seatStatus(side)}
                    current={current}
                    disabled={disabled}
                    actionLabel={boardSeatLabel(side)}
                    onAction={() => actOnBoardSeat(side)}
                    onRemove={
                      room.isOwner && !room.matchmaking && occupiedByOther
                        ? () => send('room-remove-seat', { side })
                        : undefined
                    }
                    removeDisabled={pending}
                  />
                )
              })}
            </div>
            {room.pendingSwapBy === color && (
              <div className="lan-request lan-proposal-bar">
                换边申请等待对方处理（
                {proposalCountdown(room.pendingSwapDeadline)} 秒）
                <button
                  disabled={pending}
                  onClick={() => send('room-proposal-cancel', { kind: 'swap' })}
                >
                  撤回
                </button>
              </div>
            )}
            {room.pendingSwapBy && room.pendingSwapBy !== color && color && (
              <div className="lan-request lan-proposal-bar">
                对方申请交换红黑（{proposalCountdown(room.pendingSwapDeadline)} 秒）
                <button
                  disabled={pending}
                  onClick={() => send('room-swap-response', { accept: true })}
                >
                  同意
                </button>
                <button
                  disabled={pending}
                  onClick={() => send('room-swap-response', { accept: false })}
                >
                  拒绝
                </button>
              </div>
            )}
            {room.isOwner &&
              !room.matchmaking &&
              room.applications?.map((item) => (
                <div className="lan-request" key={item.id}>
                  {item.nickname} 申请成为
                  {item.side === 'red' ? '红方' : '黑方'}{' '}
                  <button
                    onClick={() =>
                      send('room-seat-approve', {
                        applicationId: item.id,
                        accept: true,
                      })
                    }
                  >
                    同意
                  </button>
                  <button
                    onClick={() =>
                      send('room-seat-approve', {
                        applicationId: item.id,
                        accept: false,
                      })
                    }
                  >
                    拒绝
                  </button>
                </div>
              ))}
            <div className="lan-ready-primary">
              {room.isOwner && !room.matchmaking && (
                <button
                  className="invite"
                  disabled={
                    pending ||
                    ownerOfflineCountdown !== null ||
                    Boolean(room.seats.red && room.seats.black)
                  }
                  onClick={() => (shareToken ? void shareInvite() : send('room-renew-invite'))}
                >
                  {shareToken
                    ? copyState === 'copied'
                      ? '邀请链接已复制'
                      : '邀请棋友'
                    : '生成邀请链接'}
                </button>
              )}
              <span>
                {room.seats.red?.ready && room.seats.black?.ready
                  ? '双方已准备，正在开始…'
                  : room.matchmaking
                    ? '保持页面在线，匹配成功后自动开局'
                    : '双方入座并准备后自动开始'}
              </span>
            </div>
            {copyState === 'manual' && (
              <label className="lan-copy-fallback">
                浏览器未允许自动复制，请手动复制
                <input
                  readOnly
                  value={manualInviteUrl || inviteUrl}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
            )}
            {!room.matchmaking && (
              <details className="lan-room-management">
                <summary>对局管理</summary>
                <div>
                  {color && <button onClick={() => send('room-leave-seat')}>退出席位并观战</button>}
                  {color && (recoveryToken || getLanToken(roomId)) && (
                    <button onClick={shareRecovery}>
                      {recoveryCopyState === 'copied' ? '恢复链接已复制' : '复制席位恢复链接'}
                    </button>
                  )}
                  {room.isOwner && (
                    <button
                      disabled={pending || Boolean(room.seats.red && room.seats.black)}
                      onClick={() => send('room-renew-invite')}
                    >
                      作废邀请并重新生成
                    </button>
                  )}
                  {room.isOwner && (
                    <button
                      className="danger"
                      disabled={pending}
                      onClick={() => setDangerAction('dissolve')}
                    >
                      取消对局
                    </button>
                  )}
                </div>
              </details>
            )}
            {recoveryCopyState === 'manual' && (
              <label className="lan-copy-fallback">
                请手动复制恢复链接
                <input
                  readOnly
                  value={manualRecoveryUrl || recoveryUrl}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
            )}
          </section>
          <MobileChatDock messageCount={chatMessages.length}>
            <LanChat
              messages={chatMessages}
              connected={connected}
              isOwner={room.isOwner && !room.matchmaking}
              settings={chatSettings}
              error={chatError}
              send={sendChat}
              remove={deleteChatMessage}
              mute={muteChatMember}
              updateSettings={updateChatSettings}
            />
          </MobileChatDock>
        </main>
        {dangerAction && (
          <ProductDialog
            title="取消对局并返回？"
            description="对局尚未开始，返回大厅后当前对局将立即取消，席位、聊天和邀请链接都会失效。"
            confirmLabel="取消对局并返回"
            dangerous
            onCancel={() => setDangerAction(null)}
            onConfirm={() => {
              if (!send('room-dissolve')) return
              disableQuickMatchRecovery()
              setDangerAction(null)
            }}
          />
        )}
        {returnAction === 'leave-seat' && (
          <ProductDialog
            title="释放席位并返回？"
            description="返回大厅后将立即释放当前席位，其他棋友可以重新加入。"
            confirmLabel="释放席位并返回"
            onCancel={() => setReturnAction(null)}
            onConfirm={() => {
              if (!send('room-leave-seat')) return
              disableQuickMatchRecovery()
              setReturnAfterLeaving(true)
              setReturnAction(null)
            }}
          />
        )}
      </div>
    )
  const mapReason =
    room.statusReason === 'resignation'
      ? 'resignation'
      : room.statusReason === 'repetition' ||
          room.statusReason === 'natural-limit' ||
          room.statusReason === 'move-limit' ||
          room.statusReason === 'checkmate' ||
          room.statusReason === 'stalemate'
        ? room.statusReason
        : room.status === 'draw'
          ? 'manual'
          : room.statusReason === 'disconnect'
            ? 'manual'
            : undefined
  const countdown = room.disconnect
    ? Math.max(0, Math.ceil((room.disconnect.deadline - now) / 1000))
    : null
  return (
    <div className="lan-shell lan-room-shell">
      <header className="lan-header">
        <div>
          <h1>{room.name}</h1>
          <p>
            {room.variant === 'jieqi' ? '揭棋' : '普通象棋'} ·{' '}
            {room.phase === 'playing'
              ? `进行中 · ${connected ? '已连接' : '重连中'}`
              : '历史对局 · 只读'}
          </p>
        </div>
        <a href="?lan=1" onClick={requestReturn}>
          返回大厅
        </a>
      </header>
      {error && <div className="lan-error">{error}</div>}
      {rematchError && <div className="lan-error">{rematchError}</div>}
      {room.phase === 'finished' && (
        <div className="lan-history-notice">
          本局已结束。当前页面仅供查看结果、棋谱和历史聊天，不再恢复实时席位。
        </div>
      )}
      {countdown !== null && (
        <div className="lan-warning">
          {room.disconnect!.color === 'both'
            ? `双方已断线，${countdown} 秒后按和棋结束`
            : `${room.disconnect!.color === 'red' ? '红方' : '黑方'}已断线，${countdown} 秒后判负`}
        </div>
      )}
      <div className="lan-game">
        <main className={`board-stage ${boardFlipped ? 'lan-board-flipped' : ''}`}>
          <Board
            board={room.board}
            gameStatus={room.status}
            gameStatusReason={mapReason}
            selectedPos={selected}
            legalMoves={legal}
            lastMove={lastMove}
            hintMove={hintMove}
            inCheck={
              room.phase === 'playing' && isInCheck(room.board, room.turn, room.variant)
                ? findKing(room.board, room.turn)
                : null
            }
            flipped={boardFlipped}
            aiThinking={false}
            thinkingText=""
            interactionDisabled={!canMove || pending}
            onCellClick={click}
            onCancelSelection={() => setSelected(null)}
          />
          {room.captured.length > 0 && (
            <div className="lan-captured">
              <strong>已吃棋子</strong>
              {(['red', 'black'] as const).map((side) => (
                <span key={side}>
                  {side === 'red' ? '红方所吃：' : '黑方所吃：'}
                  {room.captured
                    .filter((item) => item.capturedBy === side)
                    .map((item, index) => (
                      <i key={index}>{item.type ? pieceName(item.type, item.color) : '暗'}</i>
                    ))}
                </span>
              ))}
            </div>
          )}
        </main>
        <div className="lan-side">
          <aside className="lan-panel lan-room-playing card">
            <h2>
              {room.phase === 'finished'
                ? color
                  ? `本局身份：${color === 'red' ? '红方' : '黑方'}`
                  : '对局记录'
                : color
                  ? `你是${color === 'red' ? '红方' : '黑方'}`
                  : '观战中'}
            </h2>
            <p>
              {room.status === 'playing'
                ? `${room.turn === 'red' ? '红方' : '黑方'}走棋`
                : formatResult(room.status, room.statusReason)}
            </p>
            <p>
              红：{room.seats.red?.nickname || '-'}{' '}
              {room.phase === 'playing' ? (room.seats.red?.online ? '●' : '○') : ''}
              <br />
              黑：{room.seats.black?.nickname || '-'}{' '}
              {room.phase === 'playing' ? (room.seats.black?.online ? '●' : '○') : ''}
            </p>
            {!color && (
              <button onClick={() => setSpectatorFlipped((value) => !value)}>
                切换到{spectatorFlipped ? '红方' : '黑方'}视角
              </button>
            )}
            {color && room.phase === 'playing' && (
              <>
                <button
                  disabled={
                    pending || room.turn !== color || (room.seats[color]?.hintsRemaining || 0) < 1
                  }
                  onClick={() => send('room-hint')}
                >
                  大师提示（剩余 {room.seats[color]?.hintsRemaining || 0}）
                </button>
                {room.variant === 'xiangqi' && !room.pendingUndoBy && !room.pendingDrawBy && (
                  <button disabled={pending} onClick={() => send('room-undo-request')}>
                    申请悔棋
                  </button>
                )}
                {!room.pendingUndoBy && !room.pendingDrawBy && (
                  <button disabled={pending} onClick={() => send('room-draw-offer')}>
                    提议和棋
                  </button>
                )}
                <button disabled={pending} onClick={() => setDangerAction('resign')}>
                  认输
                </button>
              </>
            )}
            {room.pendingUndoBy === color && (
              <div className="lan-request lan-proposal-bar">
                悔棋申请等待中（{proposalCountdown(room.pendingUndoDeadline)} 秒）
                <button
                  disabled={pending}
                  onClick={() => send('room-proposal-cancel', { kind: 'undo' })}
                >
                  撤回
                </button>
              </div>
            )}
            {room.pendingDrawBy === color && (
              <div className="lan-request lan-proposal-bar">
                和棋提议等待中（{proposalCountdown(room.pendingDrawDeadline)} 秒）
                <button
                  disabled={pending}
                  onClick={() => send('room-proposal-cancel', { kind: 'draw' })}
                >
                  撤回
                </button>
              </div>
            )}
            {room.pendingUndoBy && room.pendingUndoBy !== color && color && (
              <Request
                text={`对方申请悔棋（${proposalCountdown(room.pendingUndoDeadline)} 秒）`}
                pending={pending}
                accept={() => send('room-undo-response', { accept: true })}
                reject={() => send('room-undo-response', { accept: false })}
              />
            )}
            {room.pendingDrawBy && room.pendingDrawBy !== color && color && (
              <Request
                text={`对方提议和棋（${proposalCountdown(room.pendingDrawDeadline)} 秒）`}
                pending={pending}
                accept={() => send('room-draw-response', { accept: true })}
                reject={() => send('room-draw-response', { accept: false })}
              />
            )}
            {room.phase === 'playing' && color && (recoveryToken || getLanToken(roomId)) && (
              <>
                <button onClick={shareRecovery}>
                  {recoveryCopyState === 'copied'
                    ? '恢复链接已复制'
                    : room.isOwner
                      ? '复制发起人恢复链接'
                      : '复制席位恢复链接'}
                </button>
                {recoveryCopyState === 'manual' && (
                  <label className="lan-copy-fallback">
                    请手动复制恢复链接
                    <input
                      readOnly
                      value={manualRecoveryUrl || recoveryUrl}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  </label>
                )}
              </>
            )}
            {room.phase === 'finished' && (room.isOwner || color) && (
              <button disabled={creatingRematch} onClick={() => void rematch()}>
                {creatingRematch ? '正在创建…' : '创建再来一局'}
              </button>
            )}
            {room.phase === 'finished' &&
              room.variant === 'jieqi' &&
              (authorizedJieqiRecord ? (
                <>
                  <button onClick={() => setJieqiReplayOpen(true)}>
                    {authorizedJieqiRecord.audience === 'public'
                      ? '打开公开回放'
                      : '打开本人视角回放'}
                  </button>
                  {authorizedJieqiRecord.audience !== 'public' && (
                    <small className="lan-jieqi-record-saved">已保存到揭棋记录</small>
                  )}
                </>
              ) : (
                <p className="lan-warning">安全回放不可用，未读取普通棋谱作为替代。</p>
              ))}
            <h3>走棋记录</h3>
            <div className="lan-moves">
              {room.moves.map((move, index) => (
                <span key={index}>
                  {index + 1}. {move.notation || move.uci}
                  {move.capturedHidden
                    ? ` · 吃${move.captured || '暗子'}`
                    : move.captured
                      ? ` · 吃${pieceName(move.captured, move.color === 'red' ? 'black' : 'red')}`
                      : ''}
                </span>
              ))}
            </div>
          </aside>
          <MobileChatDock messageCount={chatMessages.length}>
            <LanChat
              messages={chatMessages}
              connected={connected}
              isOwner={room.isOwner && !room.matchmaking}
              settings={chatSettings}
              error={chatError}
              send={sendChat}
              remove={deleteChatMessage}
              mute={muteChatMember}
              updateSettings={updateChatSettings}
              readOnly={room.phase === 'finished'}
            />
          </MobileChatDock>
        </div>
      </div>
      {dangerAction && (
        <ProductDialog
          title={dangerAction === 'dissolve' ? '取消对局' : '确认认输'}
          description={
            dangerAction === 'dissolve'
              ? '对局将立即取消，所有棋手和观众都会离开。'
              : '当前对局将立即结束，并判对方获胜。'
          }
          confirmLabel={dangerAction === 'dissolve' ? '确认取消' : '确认认输'}
          dangerous
          onCancel={() => setDangerAction(null)}
          onConfirm={() => {
            send(dangerAction === 'dissolve' ? 'room-dissolve' : 'room-resign')
            setDangerAction(null)
          }}
        />
      )}
      {returnAction === 'disconnect' && (
        <ProductDialog
          title="离开进行中的对局？"
          description="返回大厅后你将进入断线倒计时；如果未及时返回，系统会判你超时负。"
          confirmLabel="确认离开"
          dangerous
          onCancel={() => setReturnAction(null)}
          onConfirm={() => {
            location.href = '?lan=1'
          }}
        />
      )}
    </div>
  )
}

export function LanChat({
  messages,
  connected,
  isOwner,
  settings,
  error,
  send,
  remove,
  mute,
  updateSettings,
  sideLabels = { red: '红方', black: '黑方' },
  readOnly = false,
}: {
  messages: LanChatMessage[]
  connected: boolean
  isOwner: boolean
  settings: import('./types').LanChatSettings
  error: string
  send: (content: string) => boolean
  remove: (messageId: string) => boolean
  mute: (authorId: string, muted: boolean) => boolean
  updateSettings: (everyoneMuted: boolean, words: string[]) => boolean
  sideLabels?: { red: string; black: string }
  readOnly?: boolean
}) {
  const [draft, setDraft] = useState('')
  const [managementOpen, setManagementOpen] = useState(false)
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [sensitiveDraft, setSensitiveDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const contentLength = getLanChatContentLength(draft)
  const lineCount = getLanChatLineCount(draft)
  const draftInvalid = contentLength > 200 || lineCount > 4
  const silenced = !isOwner && (settings.everyoneMuted || settings.muted)
  const parsedSensitiveWords = parseLanRoomSensitiveWords(sensitiveDraft)
  const sensitiveWordsInvalid =
    parsedSensitiveWords.length > 20 ||
    parsedSensitiveWords.some((word) => Array.from(word).length > 20)
  const savedSensitiveWords = (settings.roomSensitiveWords || []).join('，')
  const mutedMembers = (settings.mutedAuthorIds || []).map((authorId) => ({
    authorId,
    nickname:
      messages
        .slice()
        .reverse()
        .find((message) => message.authorId === authorId)?.nickname ||
      `成员 ${authorId.slice(0, 6)}`,
  }))
  useEffect(() => {
    if (isOwner) setSensitiveDraft(savedSensitiveWords)
  }, [isOwner, savedSensitiveWords])
  useEffect(() => {
    if (readOnly) {
      setManagementOpen(false)
      setSelectedMessageId(null)
      setDraft('')
    }
  }, [readOnly])
  useEffect(() => {
    const list = listRef.current
    if (list && stickToBottomRef.current) list.scrollTop = list.scrollHeight
  }, [messages])
  const submit = () => {
    if (readOnly || !draft.trim() || draftInvalid || !connected || silenced) return
    if (send(draft)) {
      setDraft('')
      stickToBottomRef.current = true
    }
  }
  return (
    <aside className="lan-panel lan-chat-panel card">
      <div className="lan-chat-heading">
        <div>
          <h2>{readOnly ? '历史聊天' : '聊天'}</h2>
          <p>
            {readOnly
              ? '对局已结束，聊天记录仅供查看'
              : settings.everyoneMuted
                ? '对局发起人已开启全面禁言'
                : settings.muted
                  ? '你已被对局发起人禁言'
                  : '对局发起人、棋手和观众均可发言'}
          </p>
        </div>
        <div>
          <span>{readOnly ? '只读' : connected ? '已连接' : '重连中'}</span>
          {isOwner && !readOnly && (
            <button onClick={() => setManagementOpen((value) => !value)}>管理</button>
          )}
        </div>
      </div>
      {error && <div className="lan-error">{error}</div>}
      {isOwner && managementOpen && (
        <section className="lan-chat-management">
          <div>
            <strong>全面禁言</strong>
            <button
              className={settings.everyoneMuted ? 'active' : ''}
              disabled={!connected}
              onClick={() =>
                updateSettings(!settings.everyoneMuted, settings.roomSensitiveWords || [])
              }
            >
              {settings.everyoneMuted ? '已开启，点击关闭' : '未开启，点击开启'}
            </button>
          </div>
          {mutedMembers.length > 0 && (
            <div className="lan-chat-muted-list">
              <strong>已禁言成员</strong>
              <span>
                {mutedMembers.map((member) => (
                  <button
                    key={member.authorId}
                    disabled={!connected}
                    onClick={() => mute(member.authorId, false)}
                  >
                    {member.nickname} · 解除
                  </button>
                ))}
              </span>
            </div>
          )}
          <label>
            对局敏感词
            <textarea
              rows={3}
              value={sensitiveDraft}
              onChange={(event) => setSensitiveDraft(event.target.value)}
              placeholder="使用逗号、顿号或换行分隔，最多 20 个，每个最多 20 字"
            />
          </label>
          <div>
            <small className={sensitiveWordsInvalid ? 'over' : ''}>
              系统敏感词已由服务端统一启用
            </small>
            <button
              disabled={!connected || sensitiveWordsInvalid}
              onClick={() => updateSettings(settings.everyoneMuted, parsedSensitiveWords)}
            >
              保存敏感词（{parsedSensitiveWords.length}/20）
            </button>
          </div>
        </section>
      )}
      <div
        className="lan-chat-list"
        ref={listRef}
        onScroll={(event) => {
          const target = event.currentTarget
          stickToBottomRef.current =
            target.scrollHeight - target.scrollTop - target.clientHeight < 48
        }}
      >
        {messages.length === 0 ? (
          <p className="lan-chat-empty">
            {readOnly ? '本局没有聊天记录。' : '还没有消息，来打个招呼吧。'}
          </p>
        ) : (
          messages.map((chat) => (
            <article className="lan-chat-message" key={chat.id}>
              <div className="lan-chat-line">
                {isOwner && !readOnly && !chat.isOwner ? (
                  <button
                    className="lan-chat-author"
                    onClick={() =>
                      setSelectedMessageId((current) => (current === chat.id ? null : chat.id))
                    }
                  >
                    {chat.nickname}
                  </button>
                ) : (
                  <strong>{chat.nickname}</strong>
                )}
                <i>「{getLanChatRole(chat, sideLabels)}」</i>
                <span title={chat.content}>：{chat.content.replace(/\s*\n\s*/g, ' ')}</span>
                <time>
                  {new Date(chat.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
                {isOwner && !readOnly && (
                  <button
                    className="lan-chat-delete"
                    title="删除消息"
                    aria-label={`删除 ${chat.nickname} 的消息`}
                    onClick={() => remove(chat.id)}
                  >
                    删除
                  </button>
                )}
              </div>
              {isOwner && !readOnly && selectedMessageId === chat.id && !chat.isOwner && (
                <div className="lan-chat-member-menu">
                  <span>{chat.nickname}</span>
                  <button
                    onClick={() => {
                      mute(chat.authorId, !settings.mutedAuthorIds?.includes(chat.authorId))
                      setSelectedMessageId(null)
                    }}
                  >
                    {settings.mutedAuthorIds?.includes(chat.authorId) ? '解除禁言' : '禁言该成员'}
                  </button>
                </div>
              )}
            </article>
          ))
        )}
      </div>
      {readOnly ? (
        <div className="lan-chat-readonly">实时会话已关闭，可从大厅发起新对局。</div>
      ) : (
        <div className="lan-chat-compose">
          <textarea
            value={draft}
            rows={2}
            placeholder={
              !connected ? '连接恢复后可以发言' : silenced ? '当前无法发言' : '输入消息，Enter 发送'
            }
            disabled={!connected || silenced}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
            }}
          />
          <div>
            <span className={draftInvalid ? 'over' : ''}>
              {lineCount}/4 行 · {contentLength}/200 字
            </span>
            <button
              disabled={!connected || silenced || !draft.trim() || draftInvalid}
              onClick={submit}
            >
              发送
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}

function Request({
  text,
  pending,
  accept,
  reject,
}: {
  text: string
  pending: boolean
  accept: () => void
  reject: () => void
}) {
  return (
    <div className="lan-request lan-proposal-bar">
      {text}
      <button disabled={pending} onClick={accept}>
        同意
      </button>
      <button disabled={pending} onClick={reject}>
        拒绝
      </button>
    </div>
  )
}
function findKing(board: import('../types').Board, color: PieceColor) {
  for (let row = 0; row < 10; row++)
    for (let col = 0; col < 9; col++)
      if (board[row][col]?.type === 'k' && board[row][col]?.color === color) return { row, col }
  return null
}
function formatResult(status: string, reason?: string) {
  if (status === 'draw') return reason === 'abandoned' ? '和棋（双方离线）' : '和棋'
  return `${status === 'red-wins' ? '红方胜' : '黑方胜'}${reason === 'disconnect' ? '（对方断线）' : reason === 'resignation' ? '（对方认输）' : reason === 'repetition' ? '（对方长将或长捉违规）' : ''}`
}
function pieceName(type: string, color: PieceColor) {
  const names =
    color === 'red'
      ? { k: '帅', a: '仕', b: '相', n: '马', r: '车', c: '炮', p: '兵' }
      : { k: '将', a: '士', b: '象', n: '马', r: '车', c: '砲', p: '卒' }
  return names[type as keyof typeof names] || type
}
