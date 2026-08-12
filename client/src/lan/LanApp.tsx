import { useEffect, useMemo, useState } from 'react'
import Board from '../components/Board'
import { getLegalMoves, isInCheck } from '../engine/rules'
import { uciToMove } from '../engine/notation'
import { Move, PieceColor, Position } from '../types'
import { createLanRoom, listLanRoomHistory, listLanRooms } from './api'
import { copyLanText } from './browser'
import { LanRoomSummary } from './types'
import { getLanRecentRooms, getLanToken, saveLanToken, useLanRoom } from './useLanRoom'

const NICKNAME_KEY = 'xiangqi-lan-nickname'
function storageGet(key: string) { try { return localStorage.getItem(key) || '' } catch { return '' } }
function storageSet(key: string, value: string) { try { localStorage.setItem(key, value) } catch { /* Storage is optional. */ } }

export default function LanApp() {
  const params = new URLSearchParams(location.search)
  const roomId = params.get('room')
  const [nickname, setNickname] = useState(() => storageGet(NICKNAME_KEY))
  if (roomId) return <LanRoom roomId={roomId} nickname={nickname || '访客'} onNickname={value => { setNickname(value); storageSet(NICKNAME_KEY, value) }} />
  return <LanLobby nickname={nickname} onNickname={value => { setNickname(value); storageSet(NICKNAME_KEY, value) }} />
}

function LanLobby({ nickname, onNickname }: { nickname: string; onNickname: (value: string) => void }) {
  const [rooms, setRooms] = useState<LanRoomSummary[]>([])
  const [historyRooms, setHistoryRooms] = useState<LanRoomSummary[]>([])
  const [name, setName] = useState('局域网对局')
  const [variant, setVariant] = useState<'xiangqi' | 'jieqi'>('xiangqi')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const recent = useMemo(getLanRecentRooms, [])
  useEffect(() => {
    let active = true
    const refresh = () => Promise.all([listLanRooms(), listLanRoomHistory()]).then(([activeRooms, finishedRooms]) => { if (active) { setRooms(activeRooms); setHistoryRooms(finishedRooms) } }).catch(cause => active && setError(cause.message))
    refresh(); const timer = setInterval(refresh, 3000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  const enter = (id: string, invite?: string) => {
    const url = new URL(location.href); url.searchParams.set('lan', '1'); url.searchParams.set('room', id); if (invite) url.searchParams.set('invite', invite); location.href = url.toString()
  }
  const create = async () => {
    if (!nickname.trim() || creating) return
    setCreating(true); setError('')
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
  return <div className="lan-shell"><header className="lan-header"><div><h1>在线对局</h1><p>创建房间、邀请棋友，或进入公开房间观战</p></div><a href="/">返回主页</a></header>
    <form className="lan-create card" onSubmit={event => { event.preventDefault(); void create() }}><div className="lan-create-heading"><div><h2>创建新房间</h2><p>填写信息并选择玩法，创建后直接进入棋盘等待。</p></div><span>1 分钟内最多创建 10 个房间</span></div><div className="lan-form-grid"><label>你的昵称<input value={nickname} maxLength={20} onChange={e => onNickname(e.target.value)} placeholder="例如：棋友小李" autoComplete="nickname" /></label><label>房间名称<input value={name} maxLength={60} onChange={e => setName(e.target.value)} placeholder="例如：周末切磋" /></label></div><fieldset className="lan-variant-picker"><legend>选择玩法</legend><button type="button" className={variant === 'xiangqi' ? 'active' : ''} onClick={() => setVariant('xiangqi')}><strong>普通象棋</strong><span>标准规则，支持协商悔棋</span><i>{variant === 'xiangqi' ? '已选择' : '选择'}</i></button><button type="button" className={variant === 'jieqi' ? 'active' : ''} onClick={() => setVariant('jieqi')}><strong>揭棋</strong><span>暗子随机分配，移动后揭晓身份</span><i>{variant === 'jieqi' ? '已选择' : '选择'}</i></button></fieldset><button className="lan-create-submit" type="submit" disabled={!nickname.trim() || creating}>{creating ? '正在创建并进入…' : `创建${variant === 'jieqi' ? '揭棋' : '普通象棋'}房间`}</button></form>
    {error && <div className="lan-error">{error}</div>}
    <section className="lan-lobby"><h2>公开大厅</h2>{rooms.length === 0 ? <p>暂无等待或进行中的房间。</p> : rooms.map(room => <button className="lan-room-card" key={room.id} onClick={() => enter(room.id)}><strong>{room.name}</strong><span>{room.variant === 'jieqi' ? '揭棋' : '普通象棋'} · {room.phase === 'waiting' ? '等待中' : '进行中'}</span><span>红：{room.red || '空席'}　黑：{room.black || '空席'}　观众 {room.spectatorCount}</span></button>)}</section>
    {historyRooms.length > 0 && <section className="lan-lobby"><h2>最近结束</h2>{historyRooms.map(room => <button className="lan-room-card" key={room.id} onClick={() => enter(room.id)}><strong>{room.name}</strong><span>{room.variant === 'jieqi' ? '揭棋' : '普通象棋'} · {formatResult(room.status, room.statusReason)}</span><span>红：{room.red || '-'}　黑：{room.black || '-'}　共 {room.moveCount} 手</span></button>)}</section>}
    {recent.length > 0 && <section className="lan-lobby"><h2>最近进入</h2>{recent.map(item => <button className="lan-room-card" key={item.id} onClick={() => enter(item.id)}><strong>{item.name}</strong><span>{item.variant === 'jieqi' ? '揭棋' : '普通象棋'} · {item.role === 'red' ? '红方' : item.role === 'black' ? '黑方' : item.role === 'owner' ? '房主' : '观众'}</span></button>)}</section>}
  </div>
}

function LanRoom({ roomId, nickname, onNickname }: { roomId: string; nickname: string; onNickname: (value: string) => void }) {
  const { room, connected, error, privateHint, setPrivateHint, pending, recoveryToken, send } = useLanRoom(roomId, nickname)
  const [selected, setSelected] = useState<Position | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'manual'>('idle')
  const [recoveryCopyState, setRecoveryCopyState] = useState<'idle' | 'copied' | 'manual'>('idle')
  const [spectatorFlipped, setSpectatorFlipped] = useState(false)
  const [creatingRematch, setCreatingRematch] = useState(false)
  const [rematchError, setRematchError] = useState('')
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer) }, [])
  useEffect(() => { setSelected(null) }, [room?.revision])
  useEffect(() => { setPrivateHint(null) }, [room?.moves.length, setPrivateHint])
  const legal = useMemo(() => selected && room ? getLegalMoves(room.board, selected, room.variant) : [], [room, selected])
  if (!room) return <div className="lan-shell"><p>{connected ? '正在同步房间…' : '正在连接服务…'}</p>{error && <div className="lan-error">{error}</div>}</div>
  const color = room.role === 'red' || room.role === 'black' ? room.role : null
  const canMove = room.phase === 'playing' && room.status === 'playing' && color === room.turn
  const last = room.moves[room.moves.length - 1]
  const lastMove: Move | null = last ? (() => { const positions = uciToMove(last.uci); const piece = room.board[positions.to.row][positions.to.col]; return piece ? { ...positions, piece } : null })() : null
  const hintMove: Move | null = privateHint ? (() => { try { const positions = uciToMove(privateHint); const piece = room.board[positions.from.row][positions.from.col]; return piece ? { ...positions, piece } : null } catch { return null } })() : null
  const click = (position: Position) => {
    if (!canMove) return
    if (selected && legal.some(item => item.row === position.row && item.col === position.col)) {
      send('room-move', { uci: `${String.fromCharCode(97 + selected.col)}${9 - selected.row}${String.fromCharCode(97 + position.col)}${9 - position.row}` }); setSelected(null); return
    }
    setSelected(room.board[position.row][position.col]?.color === color ? position : null)
  }
  const incomingInvite = new URLSearchParams(location.search).get('invite') || ''
  const shareToken = storageGet(`xiangqi-lan-invite:${roomId}`)
  const inviteUrl = (() => { const url = new URL(location.href); url.searchParams.set('invite', shareToken); return url.toString() })()
  const shareInvite = async () => {
    const copied = await copyLanText(inviteUrl)
    setCopyState(copied ? 'copied' : 'manual')
    if (copied) setTimeout(() => setCopyState('idle'), 1500)
  }
  const recoveryUrl = (() => { const url = new URL(location.href); url.searchParams.delete('invite'); url.searchParams.set('seat', recoveryToken || getLanToken(roomId)); return url.toString() })()
  const shareRecovery = async () => {
    const copied = await copyLanText(recoveryUrl)
    setRecoveryCopyState(copied ? 'copied' : 'manual')
    if (copied) setTimeout(() => setRecoveryCopyState('idle'), 1500)
  }
  const rematch = async () => {
    if (creatingRematch) return
    setCreatingRematch(true); setRematchError('')
    try {
      const result = await createLanRoom(`${room.name} · 再来一局`, room.variant)
      saveLanToken(result.room.id, result.ownerToken)
      storageSet(`xiangqi-lan-invite:${result.room.id}`, result.inviteToken)
      const url = new URL(location.href); url.searchParams.set('room', result.room.id); location.href = url.toString()
    } catch (cause) { setRematchError(cause instanceof Error ? cause.message : '创建新房间失败') }
    finally { setCreatingRematch(false) }
  }
  const actionForSeat = (side: PieceColor) => {
    if (incomingInvite) send('room-invite-seat', { inviteToken: incomingInvite, side, nickname })
    else if (room.isOwner) send('room-claim-seat', { side, nickname })
    else send('room-seat-request', { side, nickname })
  }
  const mapReason = room.statusReason === 'resignation' ? 'resignation' : room.statusReason === 'repetition' || room.statusReason === 'natural-limit' || room.statusReason === 'move-limit' || room.statusReason === 'checkmate' || room.statusReason === 'stalemate' ? room.statusReason : room.status === 'draw' ? 'manual' : room.statusReason === 'disconnect' ? 'manual' : undefined
  const countdown = room.disconnect ? Math.max(0, Math.ceil((room.disconnect.deadline - now) / 1000)) : null
  const proposalCountdown = (deadline?: number) => deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null
  return <div className="lan-shell">
    <header className="lan-header"><div><h1>{room.name}</h1><p>{room.variant === 'jieqi' ? '揭棋' : '普通象棋'} · {room.phase === 'waiting' ? '等待开局' : room.phase === 'playing' ? '进行中' : '已结束'} · {connected ? '已连接' : '重连中'}</p></div><a href="?lan=1">返回大厅</a></header>
    {error && <div className="lan-error">{error}</div>}
    {rematchError && <div className="lan-error">{rematchError}</div>}
    {countdown !== null && <div className="lan-warning">{room.disconnect!.color === 'red' ? '红方' : '黑方'}已断线，{countdown} 秒后判负</div>}
    <div className="lan-game">
      <main className="board-stage"><Board board={room.board} gameStatus={room.status} gameStatusReason={mapReason} selectedPos={selected} legalMoves={legal} lastMove={lastMove} hintMove={hintMove} inCheck={room.phase === 'playing' && isInCheck(room.board, room.turn, room.variant) ? findKing(room.board, room.turn) : null} flipped={color === 'black' || !color && spectatorFlipped} aiThinking={false} thinkingText="" interactionDisabled={!canMove || pending} onCellClick={click} onCancelSelection={() => setSelected(null)} />
        {room.captured.length > 0 && <div className="lan-captured"><strong>已吃棋子</strong>{(['red', 'black'] as const).map(side => <span key={side}>{side === 'red' ? '红方所吃：' : '黑方所吃：'}{room.captured.filter(item => item.capturedBy === side).map((item, index) => <i key={index}>{item.type ? pieceName(item.type, item.color) : '暗'}</i>)}</span>)}</div>}
      </main>
      {room.phase === 'waiting' ? <aside className="lan-panel lan-room-waiting card">
        <div><h2>等待开局</h2><p>选择席位，双方准备后自动开始。</p></div>
        <label>你的昵称<input value={nickname} maxLength={20} onChange={event => onNickname(event.target.value)} /></label>
        <div className="lan-seats">{(['red', 'black'] as const).map(side => <div className={`lan-seat ${side}`} key={side}><h3>{side === 'red' ? '红方' : '黑方'}</h3>{room.seats[side] ? <><strong>{room.seats[side]!.nickname}</strong><span>{room.seats[side]!.online ? '在线' : '离线'} · {room.seats[side]!.ready ? '已准备' : '未准备'}</span>{color === side && <><button disabled={pending} className="lan-ready-button" onClick={() => send('room-ready', { ready: !room.seats[side]!.ready })}>{room.seats[side]!.ready ? '取消准备' : '准备开局'}</button><button disabled={pending} onClick={() => send('room-leave-seat')}>离开席位</button></>}{room.isOwner && color !== side && <button disabled={pending} onClick={() => send('room-remove-seat', { side })}>移除棋手</button>}</> : <button disabled={!nickname.trim() || pending} onClick={() => actionForSeat(side)}>{incomingInvite || room.isOwner ? `成为${side === 'red' ? '红方' : '黑方'}` : `申请${side === 'red' ? '红方' : '黑方'}`}</button>}</div>)}</div>
        {color && room.seats.red && room.seats.black && !room.pendingSwapBy && <button disabled={pending} onClick={() => send('room-swap-request')}>申请交换红黑</button>}
        {room.pendingSwapBy === color && <div className="lan-request">等待对方处理（{proposalCountdown(room.pendingSwapDeadline)} 秒）<button disabled={pending} onClick={() => send('room-proposal-cancel', { kind: 'swap' })}>撤回</button></div>}
        {room.pendingSwapBy && room.pendingSwapBy !== color && color && <div className="lan-request">对方申请交换红黑（{proposalCountdown(room.pendingSwapDeadline)} 秒） <button disabled={pending} onClick={() => send('room-swap-response', { accept: true })}>同意</button><button disabled={pending} onClick={() => send('room-swap-response', { accept: false })}>拒绝</button></div>}
        {room.isOwner && (!room.seats.red || !room.seats.black) && <><button disabled={pending} onClick={() => shareToken ? void shareInvite() : send('room-renew-invite')}>{shareToken ? copyState === 'copied' ? '邀请链接已复制' : '复制玩家邀请链接' : '生成玩家邀请链接'}</button>{shareToken && <button disabled={pending} onClick={() => send('room-renew-invite')}>作废旧链接并重新生成</button>}{copyState === 'manual' && <label className="lan-copy-fallback">浏览器未允许自动复制，请手动复制<input readOnly value={inviteUrl} onFocus={event => event.currentTarget.select()} /></label>}</>}
        {room.isOwner && room.applications?.map(item => <div className="lan-request" key={item.id}>{item.nickname} 申请成为{item.side === 'red' ? '红方' : '黑方'} <button onClick={() => send('room-seat-approve', { applicationId: item.id, accept: true })}>批准</button><button onClick={() => send('room-seat-approve', { applicationId: item.id, accept: false })}>拒绝</button></div>)}
        {color && (recoveryToken || getLanToken(roomId)) && <><button onClick={shareRecovery}>{recoveryCopyState === 'copied' ? '恢复链接已复制' : room.isOwner ? '复制房主恢复链接' : '复制席位恢复链接'}</button>{recoveryCopyState === 'manual' && <label className="lan-copy-fallback">请手动复制恢复链接<input readOnly value={recoveryUrl} onFocus={event => event.currentTarget.select()} /></label>}</>}
        {room.isOwner && <button className="lan-danger-button" disabled={pending} onClick={() => confirm('确定解散这个房间吗？') && send('room-dissolve')}>解散房间</button>}
        <p className="lan-spectators">当前观众 {room.spectatorCount} 人</p>
      </aside> : <aside className="lan-panel card"><h2>{color ? `你是${color === 'red' ? '红方' : '黑方'}` : '观战中'}</h2><p>{room.status === 'playing' ? `${room.turn === 'red' ? '红方' : '黑方'}走棋` : formatResult(room.status, room.statusReason)}</p><p>红：{room.seats.red?.nickname || '-'} {room.seats.red?.online ? '●' : '○'}<br/>黑：{room.seats.black?.nickname || '-'} {room.seats.black?.online ? '●' : '○'}</p>
        {!color && <button onClick={() => setSpectatorFlipped(value => !value)}>切换到{spectatorFlipped ? '红方' : '黑方'}视角</button>}
        {color && room.phase === 'playing' && <><button disabled={pending || room.turn !== color || (room.seats[color]?.hintsRemaining || 0) < 1} onClick={() => send('room-hint')}>大师提示（剩余 {room.seats[color]?.hintsRemaining || 0}）</button>{room.variant === 'xiangqi' && !room.pendingUndoBy && !room.pendingDrawBy && <button disabled={pending} onClick={() => send('room-undo-request')}>申请悔棋</button>}{!room.pendingUndoBy && !room.pendingDrawBy && <button disabled={pending} onClick={() => send('room-draw-offer')}>提议和棋</button>}<button disabled={pending} onClick={() => confirm('确定认输吗？') && send('room-resign')}>认输</button></>}
        {room.pendingUndoBy === color && <div className="lan-request">悔棋申请等待中（{proposalCountdown(room.pendingUndoDeadline)} 秒）<button disabled={pending} onClick={() => send('room-proposal-cancel', { kind: 'undo' })}>撤回</button></div>}
        {room.pendingDrawBy === color && <div className="lan-request">和棋提议等待中（{proposalCountdown(room.pendingDrawDeadline)} 秒）<button disabled={pending} onClick={() => send('room-proposal-cancel', { kind: 'draw' })}>撤回</button></div>}
        {room.pendingUndoBy && room.pendingUndoBy !== color && color && <Request text={`对方申请悔棋（${proposalCountdown(room.pendingUndoDeadline)} 秒）`} pending={pending} accept={() => send('room-undo-response', { accept: true })} reject={() => send('room-undo-response', { accept: false })} />}
        {room.pendingDrawBy && room.pendingDrawBy !== color && color && <Request text={`对方提议和棋（${proposalCountdown(room.pendingDrawDeadline)} 秒）`} pending={pending} accept={() => send('room-draw-response', { accept: true })} reject={() => send('room-draw-response', { accept: false })} />}
        {color && (recoveryToken || getLanToken(roomId)) && <><button onClick={shareRecovery}>{recoveryCopyState === 'copied' ? '恢复链接已复制' : room.isOwner ? '复制房主恢复链接' : '复制席位恢复链接'}</button>{recoveryCopyState === 'manual' && <label className="lan-copy-fallback">请手动复制恢复链接<input readOnly value={recoveryUrl} onFocus={event => event.currentTarget.select()} /></label>}</>}
        {room.phase === 'finished' && (room.isOwner || color) && <button disabled={creatingRematch} onClick={() => void rematch()}>{creatingRematch ? '正在创建…' : '创建再来一局'}</button>}
        <h3>走棋记录</h3><div className="lan-moves">{room.moves.map((move, index) => <span key={index}>{index + 1}. {move.notation || move.uci}{move.capturedHidden ? ` · 吃${move.captured || '暗子'}` : move.captured ? ` · 吃${pieceName(move.captured, move.color === 'red' ? 'black' : 'red')}` : ''}</span>)}</div>
      </aside>}
    </div>
  </div>
}

function Request({ text, pending, accept, reject }: { text: string; pending: boolean; accept: () => void; reject: () => void }) { return <div className="lan-request">{text}<button disabled={pending} onClick={accept}>同意</button><button disabled={pending} onClick={reject}>拒绝</button></div> }
function findKing(board: import('../types').Board, color: PieceColor) { for (let row=0;row<10;row++) for(let col=0;col<9;col++) if(board[row][col]?.type==='k'&&board[row][col]?.color===color)return {row,col}; return null }
function formatResult(status: string, reason?: string) { if (status === 'draw') return reason === 'abandoned' ? '对局中止（双方长期离线）' : '和棋'; return `${status === 'red-wins' ? '红方胜' : '黑方胜'}${reason === 'disconnect' ? '（对方断线）' : reason === 'resignation' ? '（对方认输）' : ''}` }
function pieceName(type: string, color: PieceColor) { const names = color === 'red' ? { k:'帅',a:'仕',b:'相',n:'马',r:'车',c:'炮',p:'兵' } : { k:'将',a:'士',b:'象',n:'马',r:'车',c:'砲',p:'卒' }; return names[type as keyof typeof names] || type }
