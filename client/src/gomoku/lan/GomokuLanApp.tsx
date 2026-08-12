import { useEffect, useMemo, useState } from 'react'
import { createGomokuLanRoom, listLanRoomHistory, listLanRooms } from '../../lan/api'
import { copyLanText } from '../../lan/browser'
import { LanChat } from '../../lan/LanApp'
import { GomokuLanRoomSnapshot, LanRoomSummary } from '../../lan/types'
import { getLanRecentRooms, getLanToken, saveLanToken, useLanRoom } from '../../lan/useLanRoom'
import { PieceColor } from '../../types'
import { GomokuLanBoard } from './GomokuLanBoard'

const NICKNAME_KEY = 'gomoku-lan-nickname'
function load(key: string) { try { return localStorage.getItem(key) || '' } catch { return '' } }
function save(key: string, value: string) { try { localStorage.setItem(key, value) } catch { /* optional */ } }

export default function GomokuLanApp() {
  const roomId = new URLSearchParams(location.search).get('room')
  const [nickname, setNickname] = useState(() => load(NICKNAME_KEY))
  const update = (value: string) => { setNickname(value); save(NICKNAME_KEY, value) }
  return roomId ? <Room roomId={roomId} nickname={nickname || '访客'} onNickname={update} /> : <Lobby nickname={nickname} onNickname={update} />
}

function Lobby({ nickname, onNickname }: { nickname: string; onNickname: (value: string) => void }) {
  const [rooms, setRooms] = useState<LanRoomSummary[]>([]), [history, setHistory] = useState<LanRoomSummary[]>([])
  const [name, setName] = useState('五子棋切磋'), [rule, setRule] = useState<'freestyle' | 'renju'>('freestyle')
  const [error, setError] = useState(''), [creating, setCreating] = useState(false)
  const recent = useMemo(() => getLanRecentRooms().filter(item => item.variant === 'gomoku'), [])
  useEffect(() => { let active = true; const refresh = () => Promise.all([listLanRooms('gomoku'), listLanRoomHistory('gomoku')]).then(([a, b]) => { if (active) { setRooms(a); setHistory(b) } }).catch(cause => active && setError(cause.message)); void refresh(); const timer = setInterval(refresh, 3000); return () => { active = false; clearInterval(timer) } }, [])
  const enter = (id: string) => { const url = new URL(location.href); url.searchParams.set('gomoku', '1'); url.searchParams.set('lan', '1'); url.searchParams.set('room', id); location.href = url.toString() }
  const create = async () => { if (!nickname.trim() || creating) return; setCreating(true); setError(''); try { const result = await createGomokuLanRoom(name, rule); saveLanToken(result.room.id, result.ownerToken); save(`xiangqi-lan-invite:${result.room.id}`, result.inviteToken); enter(result.room.id) } catch (cause) { setError(cause instanceof Error ? cause.message : '创建失败'); setCreating(false) } }
  const cards = (items: LanRoomSummary[], finished = false) => items.map(room => <button className="lan-room-card" key={room.id} onClick={() => enter(room.id)}><strong>{room.name}</strong><span>{room.gomokuRule === 'renju' ? '有禁手' : '无禁手'} · {finished ? resultText(room.status, room.statusReason) : room.phase === 'waiting' ? '等待中' : '进行中'}</span><span>黑：{room.red || '空席'}　白：{room.black || '空席'}　{finished ? `共 ${room.moveCount} 手` : `观众 ${room.spectatorCount}`}</span></button>)
  return <div className="lan-shell gomoku-lan-shell"><header className="lan-header"><div><h1>五子棋在线大厅</h1><p>创建房间、邀请棋友、聊天或实时观战</p></div><a href="?type=gomoku">返回模式选择</a></header>
    <form className="lan-create card" onSubmit={event => { event.preventDefault(); void create() }}><div className="lan-create-heading"><div><h2>创建五子棋房间</h2><p>房间对局由服务端校验落子和胜负，断线后可凭恢复链接继续。</p></div></div><div className="lan-form-grid"><label>你的昵称<input value={nickname} maxLength={20} onChange={event => onNickname(event.target.value)} /></label><label>房间名称<input value={name} maxLength={60} onChange={event => setName(event.target.value)} /></label></div><fieldset className="lan-variant-picker"><legend>规则</legend><button type="button" className={rule === 'freestyle' ? 'active' : ''} onClick={() => setRule('freestyle')}><strong>标准五子棋</strong><span>双方连成五子即可获胜</span><i>{rule === 'freestyle' ? '已选择' : '选择'}</i></button><button type="button" className={rule === 'renju' ? 'active' : ''} onClick={() => setRule('renju')}><strong>黑方禁手</strong><span>黑方不可落长连、双四或双三</span><i>{rule === 'renju' ? '已选择' : '选择'}</i></button></fieldset><button className="lan-create-submit" disabled={!nickname.trim() || creating}>{creating ? '正在创建…' : '创建并进入房间'}</button></form>
    {error && <div className="lan-error">{error}</div>}<section className="lan-lobby"><h2>公开大厅</h2>{rooms.length ? cards(rooms) : <p>暂无五子棋房间。</p>}</section>{history.length > 0 && <section className="lan-lobby"><h2>最近结束</h2>{cards(history, true)}</section>}{recent.length > 0 && <section className="lan-lobby"><h2>最近进入</h2>{recent.map(item => <button className="lan-room-card" key={item.id} onClick={() => enter(item.id)}><strong>{item.name}</strong><span>{item.role === 'red' ? '黑方' : item.role === 'black' ? '白方' : item.role === 'owner' ? '房主' : '观众'}</span></button>)}</section>}
  </div>
}

function Room({ roomId, nickname, onNickname }: { roomId: string; nickname: string; onNickname: (value: string) => void }) {
  const state = useLanRoom<GomokuLanRoomSnapshot>(roomId, nickname), { room, connected, error, pending, recoveryToken, send } = state
  const [now, setNow] = useState(Date.now()), [copyState, setCopyState] = useState('')
  const [manualCopyUrl, setManualCopyUrl] = useState('')
  const [creatingRematch, setCreatingRematch] = useState(false)
  const [localError, setLocalError] = useState('')
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer) }, [])
  if (!room) return <div className="lan-shell"><p>{connected ? '正在同步房间…' : '正在连接服务…'}</p>{error && <div className="lan-error">{error}</div>}</div>
  const color = room.role === 'red' || room.role === 'black' ? room.role : null, incomingInvite = new URLSearchParams(location.search).get('invite') || ''
  const sideName = (side: PieceColor) => side === 'red' ? '黑方' : '白方'
  const act = (side: PieceColor) => {
    if (color === side) return send('room-ready', { ready: !room.seats[side]!.ready })
    if (color && !room.seats[side]) return send('room-switch-seat', { side })
    if (color && room.seats[side]) return send('room-swap-request')
    if (incomingInvite) return send('room-invite-seat', { inviteToken: incomingInvite, side, nickname })
    if (room.isOwner) return send('room-claim-seat', { side, nickname })
    return send('room-seat-request', { side, nickname })
  }
  const inviteToken = load(`xiangqi-lan-invite:${roomId}`), inviteUrl = (() => { const url = new URL(location.href); url.searchParams.set('invite', inviteToken); return url.toString() })()
  const recoveryUrl = (() => { const url = new URL(location.href); url.searchParams.delete('invite'); url.searchParams.set('seat', recoveryToken || getLanToken(roomId)); return url.toString() })()
  const copy = async (value: string, label: string) => {
    if (await copyLanText(value)) { setCopyState(label); setManualCopyUrl(''); setTimeout(() => setCopyState(''), 1800) }
    else { setCopyState('浏览器未允许自动复制'); setManualCopyUrl(value) }
  }
  const countdown = room.disconnect ? Math.max(0, Math.ceil((room.disconnect.deadline - now) / 1000)) : null
  const canMove = room.phase === 'playing' && room.status === 'playing' && color === room.turn && !pending
  const rematch = async () => {
    if (creatingRematch) return
    setCreatingRematch(true); setLocalError('')
    try {
      const created = await createGomokuLanRoom(`${room.name} · 再来一局`, room.gomokuRule)
      saveLanToken(created.room.id, created.ownerToken); save(`xiangqi-lan-invite:${created.room.id}`, created.inviteToken)
      const url = new URL(location.href); url.searchParams.set('room', created.room.id); location.href = url.toString()
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : '创建新房间失败'); setCreatingRematch(false) }
  }
  const phaseText = room.phase === 'waiting' ? '等待双方准备' : room.phase === 'playing' ? `${sideName(room.turn)}落子` : resultText(room.status, room.statusReason)
  const seatActionText = (side: PieceColor) => {
    const seat = room.seats[side]
    if (color === side) return seat?.ready ? '已准备 · 点击取消' : '点击准备开局'
    if (color && !seat) return `切换为${sideName(side)}`
    if (color && seat) return room.pendingSwapBy ? '换边协商中' : '申请交换执子'
    if (seat) return '席位已占用'
    return incomingInvite || room.isOwner ? `加入${sideName(side)}` : `申请${sideName(side)}`
  }
  const proposalCountdown = (deadline?: number) => deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0
  return <div className="lan-shell lan-room-shell gomoku-lan-shell">
    <header className="gomoku-room-header"><div className="gomoku-room-brand"><span aria-hidden="true">五</span><div><small>GOMOKU ONLINE</small><h1>{room.name}</h1><p><b className={connected ? 'online' : ''}>{connected ? '已连接' : '重连中'}</b><em>{room.gomokuRule === 'renju' ? '黑方禁手' : '标准五子棋'}</em><em>{room.phase === 'waiting' ? '等待开局' : room.phase === 'playing' ? '进行中' : '已结束'}</em></p></div></div><a href="?gomoku=1&lan=1">返回大厅</a></header>
    {(error || localError) && <div className="gomoku-room-toast">{error || localError}</div>}
    {countdown !== null && <div className="gomoku-room-toast warning">{sideName(room.disconnect!.color)}已断线，{countdown} 秒后判负</div>}
    <div className="gomoku-lan-game"><main className="gomoku-lan-board-wrap"><GomokuLanBoard board={room.board} moves={room.moves} disabled={!canMove} showOrder={room.phase === 'finished'} winner={room.status === 'red-wins' ? 'red' : room.status === 'black-wins' ? 'black' : null} onMove={(row, col) => send('room-move', { row, col })} /><div className="gomoku-board-state"><i className={room.phase} />{phaseText}</div></main>
      <div className="lan-side"><aside className="gomoku-room-panel"><div className="gomoku-room-summary"><div><small>{color ? '我的身份' : room.isOwner ? '房主身份' : '当前身份'}</small><h2>{color ? `你执${sideName(color).slice(0, 1)}` : room.isOwner ? '房主观战' : '观战中'}</h2></div><span>{phaseText}</span></div>
        <div className="gomoku-seat-grid">{(['red', 'black'] as const).map(side => { const seat = room.seats[side], mine = color === side; const disabled = room.phase !== 'waiting' || pending || Boolean(!color && seat) || Boolean(color && seat && room.pendingSwapBy); return <div className={`gomoku-seat-card ${side} ${mine ? 'mine' : ''}`} key={side}><span className="gomoku-seat-stone" /><div><strong>{sideName(side)}<em>{side === 'red' ? '先手' : '后手'}</em></strong><small>{seat ? seat.nickname : '等待棋手加入'}</small><i>{seat ? `${seat.online ? '在线' : '离线'} · ${seat.ready ? '已准备' : '未准备'}` : '空席'}</i></div>{room.phase === 'waiting' && <button disabled={disabled} onClick={() => act(side)}>{seatActionText(side)}</button>}{room.phase === 'waiting' && room.isOwner && seat && !mine && <button className="remove" disabled={pending} aria-label={`移除${sideName(side)}棋手`} onClick={() => send('room-remove-seat', { side })}>移除</button>}</div> })}</div>
        {room.phase === 'waiting' && <div className="gomoku-waiting-tools"><label><span>对局昵称</span><input value={nickname} maxLength={20} onChange={event => onNickname(event.target.value)} /></label>{room.isOwner && <button className="primary" disabled={!room.inviteAvailable || !inviteToken || Boolean(room.seats.red && room.seats.black)} onClick={() => void copy(inviteUrl, '邀请链接已复制')}>邀请棋友加入</button>}{color && <button onClick={() => void copy(recoveryUrl, '席位恢复链接已复制')}>保存席位恢复链接</button>}{color && <button onClick={() => send('room-leave-seat')}>退出席位并观战</button>}{room.isOwner && <details><summary>房间管理</summary><div><button disabled={pending} onClick={() => send('room-renew-invite')}>作废旧邀请并重新生成</button><button className="danger" disabled={pending} onClick={() => confirm('确定解散房间吗？') && send('room-dissolve')}>解散房间</button></div></details>}</div>}
        {room.isOwner && room.applications?.map(item => <div className="gomoku-room-request" key={item.id}><span><strong>{item.nickname}</strong>申请成为{sideName(item.side)}</span><button onClick={() => send('room-seat-approve', { applicationId: item.id, accept: true })}>同意</button><button onClick={() => send('room-seat-approve', { applicationId: item.id, accept: false })}>拒绝</button></div>)}
        {room.pendingSwapBy && color && <Proposal mine={room.pendingSwapBy === color} text="换边申请" seconds={proposalCountdown(room.pendingSwapDeadline)} pending={pending} accept={() => send('room-swap-response', { accept: true })} reject={() => send('room-swap-response', { accept: false })} cancel={() => send('room-proposal-cancel', { kind: 'swap' })} />}
        {room.phase === 'playing' && color && <div className="gomoku-playing-actions"><button disabled={pending || Boolean(room.pendingUndoBy || room.pendingDrawBy)} onClick={() => send('room-undo-request')}>申请悔棋</button><button disabled={pending || Boolean(room.pendingUndoBy || room.pendingDrawBy)} onClick={() => send('room-draw-offer')}>提议和棋</button><button className="danger" disabled={pending} onClick={() => confirm('确定认输吗？') && send('room-resign')}>认输</button></div>}
        {room.pendingUndoBy && color && <Proposal mine={room.pendingUndoBy === color} text="悔棋申请" seconds={proposalCountdown(room.pendingUndoDeadline)} pending={pending} accept={() => send('room-undo-response', { accept: true })} reject={() => send('room-undo-response', { accept: false })} cancel={() => send('room-proposal-cancel', { kind: 'undo' })} />}{room.pendingDrawBy && color && <Proposal mine={room.pendingDrawBy === color} text="和棋提议" seconds={proposalCountdown(room.pendingDrawDeadline)} pending={pending} accept={() => send('room-draw-response', { accept: true })} reject={() => send('room-draw-response', { accept: false })} cancel={() => send('room-proposal-cancel', { kind: 'draw' })} />}
        {room.phase === 'finished' && (color || room.isOwner) && <button className="gomoku-rematch-button" disabled={creatingRematch} onClick={() => void rematch()}>{creatingRematch ? '正在创建新房间…' : '再来一局'}</button>}
        {copyState && <small className="gomoku-copy-state">{copyState}</small>}{manualCopyUrl && <label className="gomoku-manual-copy">手动复制链接<input readOnly value={manualCopyUrl} onFocus={event => event.currentTarget.select()} /></label>}
        {room.phase !== 'waiting' && <details className="gomoku-move-records" open={room.phase === 'finished'}><summary>落子记录 <span>{room.moves.length} 手</span></summary><div className="lan-moves">{room.moves.map((move, index) => <span key={index}>{index + 1}. {sideName(move.color)} {move.notation || `${move.col + 1},${move.row + 1}`}</span>)}</div></details>}
      </aside>
        <LanChat messages={state.chatMessages} connected={connected} isOwner={room.isOwner} settings={state.chatSettings} error={state.chatError} send={state.sendChat} remove={state.deleteChatMessage} mute={state.muteChatMember} updateSettings={state.updateChatSettings} sideLabels={{ red: '黑方', black: '白方' }} />
      </div></div>
  </div>
}

function Proposal({ mine, text, seconds, pending, accept, reject, cancel }: { mine: boolean; text: string; seconds: number; pending: boolean; accept: () => void; reject: () => void; cancel: () => void }) { return <div className="gomoku-room-request"><span>{mine ? `${text}等待对方处理` : `对方发起${text}`} · {seconds} 秒</span>{mine ? <button disabled={pending} onClick={cancel}>撤回</button> : <><button disabled={pending} onClick={accept}>同意</button><button disabled={pending} onClick={reject}>拒绝</button></>}</div> }
function resultText(status: string, reason?: string) { if (status === 'draw') return reason === 'full-board' ? '和棋（棋盘已满）' : '和棋'; const winner = status === 'red-wins' ? '黑方胜' : '白方胜'; return reason === 'forbidden' ? `${winner}（黑方禁手）` : reason === 'resignation' ? `${winner}（对方认输）` : reason === 'disconnect' ? `${winner}（对方断线）` : winner }
