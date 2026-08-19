import { type MouseEvent, useEffect, useMemo, useState } from 'react'
import {
  createGomokuLanRoom,
  listLanRoomHistory,
  listLanRooms,
  quickMatchLanRoom,
} from '../../lan/api'
import { copyLanText } from '../../lan/browser'
import { resolveLanShareUrl } from '../../lan/network'
import { LanChat } from '../../lan/LanApp'
import { GomokuLanRoomSnapshot, LanRoomSummary } from '../../lan/types'
import { getLanRecentRooms, getLanToken, saveLanToken, useLanRoom } from '../../lan/useLanRoom'
import { quickMatchKey, quickMatchRoomUrl } from '../../lan/quickMatch'
import { PieceColor } from '../../types'
import { GomokuLanBoard } from './GomokuLanBoard'
import ProductDialog from '../../components/ProductDialog'
import MobileChatDock from '../../components/MobileChatDock'
import ProductState from '../../components/ProductState'
import { LanQuickMatch, LanReadySeat, LanRoomCard } from '../../lan/LanProduct'

const NICKNAME_KEY = 'gomoku-lan-nickname'
function load(key: string) {
  try {
    return localStorage.getItem(key) || ''
  } catch {
    return ''
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* optional */
  }
}

export default function GomokuLanApp() {
  const roomId = new URLSearchParams(location.search).get('room')
  const [nickname, setNickname] = useState(() => load(NICKNAME_KEY))
  const update = (value: string) => {
    setNickname(value)
    save(NICKNAME_KEY, value)
  }
  return roomId ? (
    <Room roomId={roomId} nickname={nickname || '访客'} onNickname={update} />
  ) : (
    <Lobby nickname={nickname} onNickname={update} />
  )
}

function Lobby({
  nickname,
  onNickname,
}: {
  nickname: string
  onNickname: (value: string) => void
}) {
  const [rooms, setRooms] = useState<LanRoomSummary[]>([]),
    [history, setHistory] = useState<LanRoomSummary[]>([])
  const [name, setName] = useState('五子棋切磋'),
    [rule, setRule] = useState<'freestyle' | 'renju'>('freestyle')
  const [error, setError] = useState(''),
    [creating, setCreating] = useState(false),
    [matching, setMatching] = useState(false)
  const [lobbyView, setLobbyView] = useState<'find' | 'create'>('find')
  const [roomFilter, setRoomFilter] = useState<
    'all' | 'waiting' | 'playing' | 'finished' | 'recent'
  >('waiting')
  const recent = useMemo(() => getLanRecentRooms().filter((item) => item.variant === 'gomoku'), [])
  useEffect(() => {
    let active = true
    const refresh = () =>
      Promise.all([listLanRooms('gomoku'), listLanRoomHistory('gomoku')])
        .then(([a, b]) => {
          if (active) {
            setRooms(a)
            setHistory(b)
          }
        })
        .catch((cause) => active && setError(cause.message))
    void refresh()
    const timer = setInterval(refresh, 3000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])
  const enter = (id: string) => {
    const url = new URL(location.href)
    url.searchParams.set('gomoku', '1')
    url.searchParams.set('lan', '1')
    url.searchParams.set('room', id)
    location.href = url.toString()
  }
  const create = async () => {
    if (!nickname.trim() || creating) return
    setCreating(true)
    setError('')
    try {
      const result = await createGomokuLanRoom(name, rule)
      saveLanToken(result.room.id, result.ownerToken)
      save(`xiangqi-lan-invite:${result.room.id}`, result.inviteToken)
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
      const result = await quickMatchLanRoom(nickname, 'gomoku', rule)
      saveLanToken(result.room.id, result.token)
      location.href = quickMatchRoomUrl(
        location.href,
        result.room.id,
        quickMatchKey('gomoku', rule),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '快速匹配失败')
      setMatching(false)
    }
  }
  const roomIds = new Set([...rooms, ...history].map((room) => room.id))
  const roomItems = [...rooms, ...history]
    .map((room) => ({
      room,
      recent: recent.some((item) => item.id === room.id),
    }))
    .filter((item) =>
      roomFilter === 'all' || roomFilter === 'recent'
        ? roomFilter !== 'recent' || item.recent
        : item.room.phase === roomFilter,
    )
  const recentOnly = roomFilter === 'recent' ? recent.filter((item) => !roomIds.has(item.id)) : []
  return (
    <div className="lan-shell gomoku-lan-shell">
      <header className="lan-header">
        <div>
          <h1>五子棋局域网对战</h1>
          <p>同一局域网内创建对局、邀请棋友、聊天或观战</p>
        </div>
        <a href="?type=gomoku">返回模式选择</a>
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
            { value: 'freestyle', label: '标准五子棋', description: '先连五子获胜' },
            { value: 'renju', label: '黑方禁手', description: '长连、双四、双三禁手' },
          ]}
          selected={rule}
          onSelect={setRule}
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
              <h2>创建五子棋对局</h2>
              <p>创建后进入独立准备室，双方就座并准备后开局。</p>
            </div>
          </div>
          <div className="lan-form-grid">
            <label>
              你的昵称
              <input
                value={nickname}
                maxLength={20}
                onChange={(event) => onNickname(event.target.value)}
              />
            </label>
            <label>
              对局名称
              <input
                value={name}
                maxLength={60}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          </div>
          <fieldset className="lan-variant-picker">
            <legend>规则</legend>
            <button
              type="button"
              className={rule === 'freestyle' ? 'active' : ''}
              onClick={() => setRule('freestyle')}
            >
              <strong>标准五子棋</strong>
              <span>双方连成五子即可获胜</span>
              <i>{rule === 'freestyle' ? '已选择' : '选择'}</i>
            </button>
            <button
              type="button"
              className={rule === 'renju' ? 'active' : ''}
              onClick={() => setRule('renju')}
            >
              <strong>黑方禁手</strong>
              <span>黑方不可落长连、双四或双三</span>
              <i>{rule === 'renju' ? '已选择' : '选择'}</i>
            </button>
          </fieldset>
          <button className="lan-create-submit" disabled={!nickname.trim() || creating}>
            {creating ? '正在创建…' : '创建并进入准备室'}
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
                  meta={`${room.gomokuRule === 'renju' ? '黑方禁手' : '标准五子棋'} · ${room.phase === 'waiting' ? '可加入' : room.phase === 'playing' ? '进行中' : resultText(room.status, room.statusReason)}${isRecent ? ' · 最近进入' : ''}`}
                  details={`黑：${room.red || '空席'}　白：${room.black || '空席'}　${room.phase === 'finished' ? `共 ${room.moveCount} 手` : `观众 ${room.spectatorCount}`}`}
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
                  meta="五子棋 · 最近进入"
                  details={
                    item.role === 'red'
                      ? '黑方席位'
                      : item.role === 'black'
                        ? '白方席位'
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

function Room({
  roomId,
  nickname,
  onNickname,
}: {
  roomId: string
  nickname: string
  onNickname: (value: string) => void
}) {
  const state = useLanRoom<GomokuLanRoomSnapshot>(roomId, nickname),
    { room, connected, error, pending, recoveryToken, send, disableQuickMatchRecovery } = state
  const [now, setNow] = useState(Date.now()),
    [copyState, setCopyState] = useState('')
  const [manualCopyUrl, setManualCopyUrl] = useState('')
  const [creatingRematch, setCreatingRematch] = useState(false)
  const [localError, setLocalError] = useState('')
  const [dangerAction, setDangerAction] = useState<'dissolve' | 'resign' | null>(null)
  const [returnAction, setReturnAction] = useState<'leave-seat' | 'disconnect' | null>(null)
  const [returnAfterLeaving, setReturnAfterLeaving] = useState(false)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (returnAfterLeaving && room?.phase === 'waiting' && room.role === 'spectator')
      location.href = '?gomoku=1&lan=1'
  }, [returnAfterLeaving, room?.phase, room?.role])
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
  const color = room.role === 'red' || room.role === 'black' ? room.role : null,
    incomingInvite = new URLSearchParams(location.search).get('invite') || ''
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
  const sideName = (side: PieceColor) => (side === 'red' ? '黑方' : '白方')
  const act = (side: PieceColor) => {
    if (color === side) return send('room-ready', { ready: !room.seats[side]!.ready })
    if (color && !room.seats[side]) return send('room-switch-seat', { side })
    if (color && room.seats[side]) return send('room-swap-request')
    if (incomingInvite)
      return send('room-invite-seat', {
        inviteToken: incomingInvite,
        side,
        nickname,
      })
    if (room.isOwner) return send('room-claim-seat', { side, nickname })
    return send('room-seat-request', { side, nickname })
  }
  const inviteToken = load(`xiangqi-lan-invite:${roomId}`),
    inviteUrl = (() => {
      const url = new URL(location.href)
      url.searchParams.set('invite', inviteToken)
      return url.toString()
    })()
  const recoveryUrl = (() => {
    const url = new URL(location.href)
    url.searchParams.delete('invite')
    url.searchParams.set('seat', recoveryToken || getLanToken(roomId))
    return url.toString()
  })()
  const copy = async (value: string, label: string) => {
    const resolvedUrl = await resolveLanShareUrl(value)
    if (await copyLanText(resolvedUrl)) {
      setCopyState(label)
      setManualCopyUrl('')
      setTimeout(() => setCopyState(''), 1800)
    } else {
      setCopyState('浏览器未允许自动复制')
      setManualCopyUrl(resolvedUrl)
    }
  }
  const countdown = room.disconnect
    ? Math.max(0, Math.ceil((room.disconnect.deadline - now) / 1000))
    : null
  const canMove =
    room.phase === 'playing' && room.status === 'playing' && color === room.turn && !pending
  const rematch = async () => {
    if (creatingRematch) return
    setCreatingRematch(true)
    setLocalError('')
    try {
      const created = await createGomokuLanRoom(`${room.name} · 再来一局`, room.gomokuRule)
      saveLanToken(created.room.id, created.ownerToken)
      save(`xiangqi-lan-invite:${created.room.id}`, created.inviteToken)
      const url = new URL(location.href)
      url.searchParams.set('room', created.room.id)
      location.href = url.toString()
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : '创建新对局失败')
      setCreatingRematch(false)
    }
  }
  const phaseText =
    room.phase === 'waiting'
      ? '等待双方准备'
      : room.phase === 'playing'
        ? `${sideName(room.turn)}落子`
        : resultText(room.status, room.statusReason)
  const seatActionText = (side: PieceColor) => {
    const seat = room.seats[side]
    if (color === side) return seat?.ready ? '已准备 · 点击取消' : '点击准备开局'
    if (color && !seat) return `切换为${sideName(side)}`
    if (color && seat) return room.pendingSwapBy ? '换边协商中' : '申请交换执子'
    if (seat) return '席位已占用'
    return incomingInvite || room.isOwner ? `加入${sideName(side)}` : `申请${sideName(side)}`
  }
  const proposalCountdown = (deadline?: number) =>
    deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0
  const ownerOfflineCountdown = room.ownerDisconnectDeadline
    ? proposalCountdown(room.ownerDisconnectDeadline)
    : null
  const seatStatus = (side: PieceColor) => {
    const seat = room.seats[side]
    if (!seat) return '席位空缺'
    const deadline = room.seatDisconnectDeadlines?.[side]
    return `${seat.nickname} · ${seat.online ? '在线' : '离线'} · ${seat.ready ? '已准备' : '未准备'}${deadline ? ` · ${proposalCountdown(deadline)} 秒后释放` : ''}`
  }
  if (room.phase === 'waiting')
    return (
      <div className="lan-shell lan-room-shell gomoku-lan-shell lan-ready-shell">
        <header className="lan-header">
          <div>
            <h1>{room.name}</h1>
            <p>
              {room.gomokuRule === 'renju' ? '黑方禁手' : '标准五子棋'} · 准备室 ·{' '}
              {connected ? '已连接' : '重连中'}
            </p>
          </div>
          <a href="?gomoku=1&lan=1" onClick={requestReturn}>
            返回大厅
          </a>
        </header>
        {(error || localError) && <div className="lan-error">{error || localError}</div>}
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
                  {room.gomokuRule === 'renju'
                    ? '黑方先手且需遵守长连、双四、双三禁手。'
                    : '黑方先手，任一方率先连成五子获胜。'}
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
                  current = color === side
                const disabled =
                  pending ||
                  room.matchmaking ||
                  ownerOfflineCountdown !== null ||
                  Boolean(!color && seat) ||
                  Boolean(color && seat && room.pendingSwapBy)
                return (
                  <LanReadySeat
                    key={side}
                    side={side}
                    mark={side === 'red' ? '●' : '○'}
                    title={`${sideName(side)} · ${side === 'red' ? '先手' : '后手'}`}
                    status={seatStatus(side)}
                    current={current}
                    disabled={disabled}
                    actionLabel={seatActionText(side)}
                    onAction={() => act(side)}
                    onRemove={
                      room.isOwner && !room.matchmaking && seat && !current
                        ? () => send('room-remove-seat', { side })
                        : undefined
                    }
                    removeDisabled={pending}
                  />
                )
              })}
            </div>
            {room.pendingSwapBy && color && (
              <Proposal
                mine={room.pendingSwapBy === color}
                text="换边申请"
                seconds={proposalCountdown(room.pendingSwapDeadline)}
                pending={pending}
                accept={() => send('room-swap-response', { accept: true })}
                reject={() => send('room-swap-response', { accept: false })}
                cancel={() => send('room-proposal-cancel', { kind: 'swap' })}
              />
            )}
            {room.isOwner &&
              !room.matchmaking &&
              room.applications?.map((item) => (
                <div className="lan-request" key={item.id}>
                  {item.nickname} 申请成为{sideName(item.side)}{' '}
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
                    !room.inviteAvailable ||
                    !inviteToken ||
                    ownerOfflineCountdown !== null ||
                    Boolean(room.seats.red && room.seats.black)
                  }
                  onClick={() => void copy(inviteUrl, '邀请链接已复制')}
                >
                  邀请棋友
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
            {copyState && <small className="gomoku-copy-state">{copyState}</small>}
            {manualCopyUrl && (
              <label className="gomoku-manual-copy">
                手动复制链接
                <input
                  readOnly
                  value={manualCopyUrl}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
            )}
            {!room.matchmaking && (
              <details className="lan-room-management">
                <summary>对局管理</summary>
                <div>
                  {color && <button onClick={() => send('room-leave-seat')}>退出席位并观战</button>}
                  {color && (
                    <button onClick={() => void copy(recoveryUrl, '席位恢复链接已复制')}>
                      复制席位恢复链接
                    </button>
                  )}
                  {room.isOwner && (
                    <button disabled={pending} onClick={() => send('room-renew-invite')}>
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
          </section>
          <MobileChatDock messageCount={state.chatMessages.length}>
            <LanChat
              messages={state.chatMessages}
              connected={connected}
              isOwner={room.isOwner && !room.matchmaking}
              settings={state.chatSettings}
              error={state.chatError}
              send={state.sendChat}
              remove={state.deleteChatMessage}
              mute={state.muteChatMember}
              updateSettings={state.updateChatSettings}
              sideLabels={{ red: '黑方', black: '白方' }}
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
  return (
    <div className="lan-shell lan-room-shell gomoku-lan-shell">
      <header className="gomoku-room-header">
        <div className="gomoku-room-brand">
          <span aria-hidden="true">五</span>
          <div>
            <small>GOMOKU LAN</small>
            <h1>{room.name}</h1>
            <p>
              <b className={room.phase === 'playing' && connected ? 'online' : ''}>
                {room.phase === 'playing' ? (connected ? '已连接' : '重连中') : '历史记录'}
              </b>
              <em>{room.gomokuRule === 'renju' ? '黑方禁手' : '标准五子棋'}</em>
              <em>{room.phase === 'playing' ? '进行中' : '只读查看'}</em>
            </p>
          </div>
        </div>
        <a href="?gomoku=1&lan=1" onClick={requestReturn}>
          返回大厅
        </a>
      </header>
      {(error || localError) && <div className="gomoku-room-toast">{error || localError}</div>}
      {room.phase === 'finished' && (
        <div className="lan-history-notice">
          本局已结束。当前页面仅供查看结果、棋谱和历史聊天，不再恢复实时席位。
        </div>
      )}
      {countdown !== null && (
        <div className="gomoku-room-toast warning">
          {room.disconnect!.color === 'both'
            ? `双方已断线，${countdown} 秒后按和棋结束`
            : `${sideName(room.disconnect!.color)}已断线，${countdown} 秒后判负`}
        </div>
      )}
      <div className="gomoku-lan-game">
        <main className="gomoku-lan-board-wrap">
          <GomokuLanBoard
            board={room.board}
            moves={room.moves}
            disabled={!canMove}
            showOrder={room.phase === 'finished'}
            winner={
              room.status === 'red-wins' ? 'red' : room.status === 'black-wins' ? 'black' : null
            }
            onMove={(row, col) => send('room-move', { row, col })}
          />
          <div className="gomoku-board-state">
            <i className={room.phase} />
            {phaseText}
          </div>
        </main>
        <div className="lan-side">
          <aside className="gomoku-room-panel">
            <div className="gomoku-room-summary">
              <div>
                <small>
                  {room.phase === 'finished'
                    ? '本局身份'
                    : color
                      ? '我的身份'
                      : room.isOwner
                        ? '发起人身份'
                        : '当前身份'}
                </small>
                <h2>
                  {room.phase === 'finished' && !color
                    ? '对局记录'
                    : color
                      ? `${room.phase === 'finished' ? '本局' : '你'}执${sideName(color).slice(0, 1)}`
                      : room.isOwner
                        ? '发起人观战'
                        : '观战中'}
                </h2>
              </div>
              <span>{phaseText}</span>
            </div>
            <div className="gomoku-seat-grid">
              {(['red', 'black'] as const).map((side) => {
                const seat = room.seats[side],
                  mine = color === side
                return (
                  <div className={`gomoku-seat-card ${side} ${mine ? 'mine' : ''}`} key={side}>
                    <span className="gomoku-seat-stone" />
                    <div>
                      <strong>
                        {sideName(side)}
                        <em>{side === 'red' ? '先手' : '后手'}</em>
                      </strong>
                      <small>{seat ? seat.nickname : '等待棋手加入'}</small>
                      <i>
                        {seat
                          ? room.phase === 'finished'
                            ? '本局棋手'
                            : seat.online
                              ? '在线'
                              : '离线'
                          : '空席'}
                      </i>
                    </div>
                  </div>
                )
              })}
            </div>
            {room.isOwner &&
              room.applications?.map((item) => (
                <div className="gomoku-room-request" key={item.id}>
                  <span>
                    <strong>{item.nickname}</strong>申请成为
                    {sideName(item.side)}
                  </span>
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
            {room.pendingSwapBy && color && (
              <Proposal
                mine={room.pendingSwapBy === color}
                text="换边申请"
                seconds={proposalCountdown(room.pendingSwapDeadline)}
                pending={pending}
                accept={() => send('room-swap-response', { accept: true })}
                reject={() => send('room-swap-response', { accept: false })}
                cancel={() => send('room-proposal-cancel', { kind: 'swap' })}
              />
            )}
            {room.phase === 'playing' && color && (
              <div className="gomoku-playing-actions">
                <button
                  disabled={pending || Boolean(room.pendingUndoBy || room.pendingDrawBy)}
                  onClick={() => send('room-undo-request')}
                >
                  申请悔棋
                </button>
                <button
                  disabled={pending || Boolean(room.pendingUndoBy || room.pendingDrawBy)}
                  onClick={() => send('room-draw-offer')}
                >
                  提议和棋
                </button>
                <button
                  className="danger"
                  disabled={pending}
                  onClick={() => setDangerAction('resign')}
                >
                  认输
                </button>
              </div>
            )}
            {room.pendingUndoBy && color && (
              <Proposal
                mine={room.pendingUndoBy === color}
                text="悔棋申请"
                seconds={proposalCountdown(room.pendingUndoDeadline)}
                pending={pending}
                accept={() => send('room-undo-response', { accept: true })}
                reject={() => send('room-undo-response', { accept: false })}
                cancel={() => send('room-proposal-cancel', { kind: 'undo' })}
              />
            )}
            {room.pendingDrawBy && color && (
              <Proposal
                mine={room.pendingDrawBy === color}
                text="和棋提议"
                seconds={proposalCountdown(room.pendingDrawDeadline)}
                pending={pending}
                accept={() => send('room-draw-response', { accept: true })}
                reject={() => send('room-draw-response', { accept: false })}
                cancel={() => send('room-proposal-cancel', { kind: 'draw' })}
              />
            )}
            {room.phase === 'finished' && (color || room.isOwner) && (
              <button
                className="gomoku-rematch-button"
                disabled={creatingRematch}
                onClick={() => void rematch()}
              >
                {creatingRematch ? '正在创建新对局…' : '再来一局'}
              </button>
            )}
            {copyState && <small className="gomoku-copy-state">{copyState}</small>}
            {manualCopyUrl && (
              <label className="gomoku-manual-copy">
                手动复制链接
                <input
                  readOnly
                  value={manualCopyUrl}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
            )}
            <details className="gomoku-move-records" open={room.phase === 'finished'}>
              <summary>
                落子记录 <span>{room.moves.length} 手</span>
              </summary>
              <div className="lan-moves">
                {room.moves.map((move, index) => (
                  <span key={index}>
                    {index + 1}. {sideName(move.color)}{' '}
                    {move.notation || `${move.col + 1},${move.row + 1}`}
                  </span>
                ))}
              </div>
            </details>
          </aside>
          <MobileChatDock messageCount={state.chatMessages.length}>
            <LanChat
              messages={state.chatMessages}
              connected={connected}
              isOwner={room.isOwner && !room.matchmaking}
              settings={state.chatSettings}
              error={state.chatError}
              send={state.sendChat}
              remove={state.deleteChatMessage}
              mute={state.muteChatMember}
              updateSettings={state.updateChatSettings}
              sideLabels={{ red: '黑方', black: '白方' }}
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
            location.href = '?gomoku=1&lan=1'
          }}
        />
      )}
    </div>
  )
}

function Proposal({
  mine,
  text,
  seconds,
  pending,
  accept,
  reject,
  cancel,
}: {
  mine: boolean
  text: string
  seconds: number
  pending: boolean
  accept: () => void
  reject: () => void
  cancel: () => void
}) {
  return (
    <div className="gomoku-room-request lan-proposal-bar">
      <span>
        {mine ? `${text}等待对方处理` : `对方发起${text}`} · {seconds} 秒
      </span>
      {mine ? (
        <button disabled={pending} onClick={cancel}>
          撤回
        </button>
      ) : (
        <>
          <button disabled={pending} onClick={accept}>
            同意
          </button>
          <button disabled={pending} onClick={reject}>
            拒绝
          </button>
        </>
      )}
    </div>
  )
}
function resultText(status: string, reason?: string) {
  if (status === 'draw')
    return reason === 'full-board'
      ? '和棋（棋盘已满）'
      : reason === 'abandoned'
        ? '和棋（双方离线）'
        : '和棋'
  const winner = status === 'red-wins' ? '黑方胜' : '白方胜'
  return reason === 'forbidden'
    ? `${winner}（黑方禁手）`
    : reason === 'resignation'
      ? `${winner}（对方认输）`
      : reason === 'disconnect'
        ? `${winner}（对方断线）`
        : winner
}
