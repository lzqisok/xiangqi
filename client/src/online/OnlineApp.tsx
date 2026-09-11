import { MatchRatingPanel, RatingLedgerPanel } from './RatingPanel'
import { useEffect, useMemo, useState } from 'react'
import { AccountApiError } from '../auth/api'
import AccountEntry from '../auth/AccountEntry'
import { useAuth } from '../auth/AuthContext'
import Board from '../components/Board'
import ProductState from '../components/ProductState'
import { getLegalMoves } from '../engine/rules'
import { GomokuLanBoard } from '../gomoku/lan/GomokuLanBoard'
import { createLanCommandId } from '../lan/browser'
import { LanReadySeat, LanRoomCard } from '../lan/LanProduct'
import type { Board as XiangqiBoard, GameStatusReason, Move, Position } from '../types'
import {
  cancelOnlineMatchmaking,
  createOnlineInvite,
  createOnlineMatch,
  createOnlineRematch,
  joinOnlineInvite,
  joinOnlineMatch,
  listMyMatches,
  listMyRatings,
  listOnlineLobby,
  previewOnlineInvite,
  quickMatchOnline,
  type MatchSetup,
} from './api'
import type { OnlineLobbyMatch, OnlineMatchSummary, OnlineRating } from './types'
import { onlineRoomUrl } from './model'
import { useOnlineMatch } from './useOnlineMatch'

function variantName(match: Pick<OnlineMatchSummary, 'variant' | 'gomokuRule'>) {
  if (match.variant === 'jieqi') return '揭棋'
  if (match.variant === 'gomoku')
    return match.gomokuRule === 'renju' ? '五子棋 · 黑方禁手' : '标准五子棋'
  return '普通象棋'
}

function phaseName(match: OnlineMatchSummary) {
  if (match.phase === 'waiting') return '等待就座'
  if (match.phase === 'playing') return '正在进行'
  if (match.status === 'draw') return '和棋'
  return match.status === 'red-wins' ? '红方胜' : '黑方胜'
}

function ratingPoolName(pool: OnlineRating['pool']) {
  if (pool === 'xiangqi') return '普通象棋'
  if (pool === 'jieqi') return '揭棋'
  if (pool === 'gomoku-renju') return '五子棋 · 黑方禁手'
  return '标准五子棋'
}

export default function OnlineApp() {
  const { user } = useAuth()
  return <OnlineAccountApp key={user?.id ?? 'anonymous'} />
}

function OnlineAccountApp() {
  const { user, loading, available } = useAuth()
  const search = new URLSearchParams(location.search)
  const game = search.get('game') === 'gomoku' ? 'gomoku' : 'xiangqi'
  const matchId = search.get('match') || ''
  const inviteToken = search.get('invite') || ''
  const [lobby, setLobby] = useState<OnlineLobbyMatch[]>([])
  const [history, setHistory] = useState<OnlineMatchSummary[]>([])
  const [ratings, setRatings] = useState<OnlineRating[]>([])
  const [variant, setVariant] = useState<'xiangqi' | 'jieqi' | 'gomoku'>(
    game === 'gomoku' ? 'gomoku' : 'xiangqi',
  )
  const [gomokuRule, setGomokuRule] = useState<'freestyle' | 'renju'>('freestyle')
  const [clockPreset, setClockPreset] = useState<'none' | '10m' | '15m-10s' | '30m'>('none')
  const [competitionMode, setCompetitionMode] = useState<'casual' | 'rated'>('casual')
  const [name, setName] = useState('棋友对局')
  const [visibility, setVisibility] = useState<'public' | 'invite'>('public')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [invitePreview, setInvitePreview] = useState<Awaited<
    ReturnType<typeof previewOnlineInvite>
  > | null>(null)

  const setup: MatchSetup = {
    variant,
    ...(variant === 'gomoku' ? { gomokuRule } : {}),
    clockPreset,
  }

  useEffect(() => {
    if (matchId || (user && user.status !== 'active')) return
    let disposed = false
    listOnlineLobby(game === 'gomoku' ? 'gomoku' : undefined)
      .then((nextLobby) => !disposed && setLobby(nextLobby))
      .catch(
        (cause) =>
          !disposed && setError(cause instanceof Error ? cause.message : '无法加载公网大厅'),
      )
    return () => {
      disposed = true
    }
  }, [game, matchId, user])

  useEffect(() => {
    if (!user || !['active', 'restricted'].includes(user.status) || matchId) return
    let disposed = false
    listMyRatings()
      .then((result) => !disposed && setRatings(result))
      .catch(
        (cause) =>
          !disposed && setError(cause instanceof Error ? cause.message : '无法加载本人等级分'),
      )
    return () => {
      disposed = true
    }
  }, [matchId, user])

  useEffect(() => {
    if (!user || !['active', 'restricted'].includes(user.status) || matchId) return
    let disposed = false
    listMyMatches(game === 'gomoku' ? 'gomoku' : undefined)
      .then((result) => !disposed && setHistory(result.matches))
      .catch(
        (cause) =>
          !disposed && setError(cause instanceof Error ? cause.message : '无法加载本人对局历史'),
      )
    return () => {
      disposed = true
    }
  }, [game, matchId, user])

  useEffect(() => {
    if (!user || user.status !== 'active' || !inviteToken || matchId) return
    let disposed = false
    previewOnlineInvite(inviteToken)
      .then((preview) => !disposed && setInvitePreview(preview))
      .catch(
        (cause) => !disposed && setError(cause instanceof Error ? cause.message : '邀请已失效'),
      )
    return () => {
      disposed = true
    }
  }, [inviteToken, matchId, user])

  if (matchId && user?.status === 'active') return <OnlineMatchRoom matchId={matchId} game={game} />
  if (matchId && user?.status === 'restricted') {
    return <OnlineMatchRoom matchId={matchId} game={game} readOnly="history" />
  }
  if (matchId && !loading)
    return <OnlineMatchRoom matchId={matchId} game={game} readOnly="public" />

  if (loading) {
    return <ProductState kind="loading" title="正在恢复账号" description="正在确认公网对局身份。" />
  }
  if (!user || user.status !== 'active') {
    return (
      <main className="home-screen online-shell">
        <section className="home-card online-account-gate">
          <h1>公网对战</h1>
          <p>
            {!available
              ? '当前服务未启用公网账号能力。'
              : user?.status === 'restricted'
                ? '当前账号受限，可只读查看本人公网对局历史。'
                : user
                  ? '验证邮箱后即可进入快速匹配、邀请对局和跨设备历史。'
                  : '登录已验证账号后即可进入公网大厅。'}
          </p>
          <AccountEntry />
          {!user && (
            <section className="card online-list-section">
              <h2>公开大厅</h2>
              {lobby.length ? (
                lobby.map((match) => (
                  <p key={match.id}>
                    <strong>{match.name}</strong> · {variantName(match)} · 登录后可加入
                  </p>
                ))
              ) : (
                <p>暂无公开等待对局。</p>
              )}
            </section>
          )}
          {user?.status === 'restricted' && (
            <section className="card online-list-section">
              <h2>本人对局历史（只读）</h2>
              {history.length ? (
                history.map((match) => (
                  <a
                    className="online-history-link"
                    href={onlineRoomUrl(location.href, match.id, game)}
                    key={match.id}
                  >
                    <strong>{match.name}</strong> · {variantName(match)} · {phaseName(match)} ·{' '}
                    {match.moveCount} 手
                  </a>
                ))
              ) : (
                <p>账号下还没有公网对局。</p>
              )}
            </section>
          )}
          <a className="home-back-link" href={game === 'gomoku' ? '?type=gomoku' : '?type=xiangqi'}>
            ← 返回棋类控制台
          </a>
        </section>
      </main>
    )
  }

  const run = async (action: () => Promise<{ match: { id: string } }>) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await action()
      location.href = onlineRoomUrl(location.href, result.match.id, game)
    } catch (cause) {
      setError(
        cause instanceof AccountApiError && cause.code === 'matchmaking_cooldown'
          ? `取消匹配过于频繁，请在 ${cause.retryAfterSeconds ?? 600} 秒后重试。`
          : cause instanceof Error
            ? cause.message
            : '公网对局操作失败',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="lan-shell online-shell">
      <header className="lan-header">
        <div>
          <small>ACCOUNT ONLINE</small>
          <h1>{game === 'gomoku' ? '五子棋公网大厅' : '象棋公网大厅'}</h1>
          <p>{user.displayName} · 席位与历史由账号关系恢复，无需复制恢复口令</p>
        </div>
        <a href={game === 'gomoku' ? '?type=gomoku' : '?type=xiangqi'}>返回棋类控制台</a>
      </header>

      {error && <div className="lan-status error">{error}</div>}

      {ratings.length > 0 && (
        <section className="card online-list-section">
          <div className="online-section-title">
            <div>
              <small>RATING</small>
              <h2>我的等级分</h2>
            </div>
            <span>初始 1500</span>
          </div>
          <div className="lan-room-list">
            {ratings.map((rating) => (
              <p key={rating.pool}>
                <strong>{ratingPoolName(rating.pool)}</strong> · {rating.rating} 分
                {rating.provisional ? '（暂定）' : ''} · {rating.gamesPlayed} 局 · {rating.wins} 胜
                {rating.draws} 和 {rating.losses} 负
              </p>
            ))}
          </div>
        </section>
      )}

      {invitePreview && (
        <section className="card online-invite-preview">
          <small>INVITATION</small>
          <h2>{invitePreview.match.name}</h2>
          <p>
            {variantName(invitePreview.match)} · {phaseName(invitePreview.match)} · 空缺席位
            {invitePreview.allowedSide === 'red'
              ? '红方'
              : invitePreview.allowedSide === 'black'
                ? '黑方'
                : '由你选择'}
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              run(() => joinOnlineInvite(inviteToken, invitePreview.allowedSide || undefined))
            }
          >
            {busy ? '正在加入…' : '确认昵称与席位并加入'}
          </button>
        </section>
      )}

      <section className="online-actions-grid">
        <article className="card online-quick-card">
          <small>QUICK MATCH</small>
          <h2>快速匹配</h2>
          <p>按棋类、规则和棋钟档位原子匹配；重复点击或多标签页不会重复占位。</p>
          <div className="online-choice-row">
            <button
              className={competitionMode === 'casual' ? 'active' : ''}
              onClick={() => setCompetitionMode('casual')}
            >
              休闲
            </button>
            <button
              className={competitionMode === 'rated' ? 'active' : ''}
              onClick={() => {
                setCompetitionMode('rated')
                if (clockPreset === 'none') setClockPreset('10m')
              }}
            >
              排位
            </button>
          </div>
          {game === 'xiangqi' ? (
            <div className="online-choice-row">
              <button
                className={variant === 'xiangqi' ? 'active' : ''}
                onClick={() => setVariant('xiangqi')}
              >
                普通象棋
              </button>
              <button
                className={variant === 'jieqi' ? 'active' : ''}
                onClick={() => setVariant('jieqi')}
              >
                揭棋
              </button>
            </div>
          ) : (
            <div className="online-choice-row">
              <button
                className={gomokuRule === 'freestyle' ? 'active' : ''}
                onClick={() => setGomokuRule('freestyle')}
              >
                标准规则
              </button>
              <button
                className={gomokuRule === 'renju' ? 'active' : ''}
                onClick={() => setGomokuRule('renju')}
              >
                黑方禁手
              </button>
            </div>
          )}
          <label>
            棋钟
            <select
              value={clockPreset}
              onChange={(event) =>
                setClockPreset(event.target.value as 'none' | '10m' | '15m-10s' | '30m')
              }
            >
              <option value="none" disabled={competitionMode === 'rated'}>
                无棋钟
              </option>
              <option value="10m">10 分钟包干</option>
              <option value="15m-10s">15 分钟，每步加 10 秒</option>
              <option value="30m">30 分钟包干</option>
            </select>
          </label>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              run(() => quickMatchOnline({ ...setup, competitionMode }, createLanCommandId()))
            }
          >
            {busy ? '正在匹配…' : competitionMode === 'rated' ? '开始排位匹配' : '开始休闲匹配'}
          </button>
          {competitionMode === 'rated' && (
            <p>
              公平竞赛：排位禁止悔棋及使用引擎辅助。匹配开局即计入规则，尚未走子也不能通过单方断线免扣分。双方断线宽限均届满则按放弃处理，不计分。同一分池与同一对手
              24 小时最多匹配 3 局排位，达到上限后等待其他对手。
            </p>
          )}
          <p>10 分钟内成功取消匹配 5 次后，新匹配暂停 10 分钟。</p>
        </article>

        <article className="card online-create-card">
          <small>CREATE MATCH</small>
          <h2>创建对局</h2>
          <label>
            对局名称
            <input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            可见性
            <select
              value={visibility}
              onChange={(event) => setVisibility(event.target.value as 'public' | 'invite')}
            >
              <option value="public">公开大厅</option>
              <option value="invite">仅邀请</option>
            </select>
          </label>
          <button
            className="primary"
            disabled={busy || name.trim().length < 2}
            onClick={() =>
              run(() => createOnlineMatch({ ...setup, name, visibility, side: 'red' }))
            }
          >
            创建并进入准备室
          </button>
        </article>
      </section>

      <section className="card online-list-section">
        <div className="online-section-title">
          <div>
            <small>PUBLIC LOBBY</small>
            <h2>可加入对局</h2>
          </div>
          <span>{lobby.length} 局</span>
        </div>
        <div className="lan-room-list">
          {lobby.length ? (
            lobby.map((match) => (
              <LanRoomCard
                key={match.id}
                name={match.name}
                meta={`${variantName(match)} · 等待就座`}
                details={`红方 ${match.red || '空缺'} · 黑方 ${match.black || '空缺'}`}
                actionLabel="加入准备室"
                onOpen={() => run(() => joinOnlineMatch(match.id))}
              />
            ))
          ) : (
            <p className="lan-empty">暂无公开等待对局，可以快速匹配或创建一局。</p>
          )}
        </div>
      </section>

      <RatingLedgerPanel />
      <section className="card online-list-section">
        <div className="online-section-title">
          <div>
            <small>MY MATCHES</small>
            <h2>我的对局历史</h2>
          </div>
          <span>{history.length} 局</span>
        </div>
        <div className="lan-room-list">
          {history.length ? (
            history.map((match) => (
              <LanRoomCard
                key={match.id}
                name={match.name}
                meta={`${variantName(match)} · ${match.competitionMode === 'rated' ? '排位 · ' : ''}${phaseName(match)}`}
                details={`${match.moveCount} 手 · ${new Date(match.updatedAt).toLocaleString()}`}
                actionLabel={match.phase === 'finished' ? '查看历史' : '恢复对局'}
                onOpen={() => {
                  location.href = onlineRoomUrl(location.href, match.id, game)
                }}
              />
            ))
          ) : (
            <p className="lan-empty">账号下还没有公网对局。</p>
          )}
        </div>
      </section>
    </main>
  )
}

function uciPositions(uci: string) {
  return {
    from: { col: uci.charCodeAt(0) - 97, row: 9 - Number(uci[1]) },
    to: { col: uci.charCodeAt(2) - 97, row: 9 - Number(uci[3]) },
  }
}

function OnlineMatchRoom({
  matchId,
  game,
  readOnly = null,
}: {
  matchId: string
  game: 'xiangqi' | 'gomoku'
  readOnly?: 'public' | 'history' | null
}) {
  const { user } = useAuth()
  const { match, messages, connected, pending, error, send, sendChat } = useOnlineMatch(
    matchId,
    readOnly,
  )
  const [selected, setSelected] = useState<Position | null>(null)
  const [chat, setChat] = useState('')
  const [inviteUrl, setInviteUrl] = useState('')
  const [actionError, setActionError] = useState('')
  const [mutedUserIds, setMutedUserIds] = useState<Set<string>>(() => new Set())
  const [now, setNow] = useState(Date.now())
  const [clockNow, setClockNow] = useState(() => performance.now())
  const [clockAnchor, setClockAnchor] = useState({ revision: -1, receivedAt: performance.now() })
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now())
      setClockNow(performance.now())
    }, 250)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (match?.clock) {
      const receivedAt = performance.now()
      setClockAnchor({ revision: match.revision, receivedAt })
      setClockNow(receivedAt)
    }
  }, [match?.clock, match?.revision])
  const board = match?.variant === 'gomoku' ? null : (match?.board as XiangqiBoard | undefined)
  const legal = useMemo(
    () =>
      selected && board && match
        ? getLegalMoves(board, selected, match.variant === 'jieqi' ? 'jieqi' : 'xiangqi')
        : [],
    [board, match, selected],
  )
  if (!match) {
    return (
      <main className="lan-shell online-shell">
        <ProductState
          kind={error ? 'error' : 'loading'}
          title={error ? '无法打开公网对局' : connected ? '正在同步对局' : '正在连接公网服务'}
          description={error || '登录会话将自动恢复席位与对局阶段。'}
        />
      </main>
    )
  }
  const color = match.side
  const canMove =
    match.phase === 'playing' && match.status === 'playing' && color === match.turn && !pending
  const last = match.moves[match.moves.length - 1]
  const lastMove: Move | null =
    last && board
      ? (() => {
          const positions = uciPositions(last.uci)
          const piece = board[positions.to.row]?.[positions.to.col]
          return piece ? { ...positions, piece } : null
        })()
      : null
  const click = (position: Position) => {
    if (!canMove || !board || !color) return
    if (selected && legal.some((item) => item.row === position.row && item.col === position.col)) {
      send('match-move', {
        uci: `${String.fromCharCode(97 + selected.col)}${9 - selected.row}${String.fromCharCode(97 + position.col)}${9 - position.row}`,
      })
      setSelected(null)
      return
    }
    setSelected(board[position.row][position.col]?.color === color ? position : null)
  }
  const boardReason: GameStatusReason | undefined =
    match.statusReason === 'agreement'
      ? 'manual'
      : [
            'checkmate',
            'stalemate',
            'resignation',
            'repetition',
            'natural-limit',
            'move-limit',
          ].includes(match.statusReason || '')
        ? (match.statusReason as GameStatusReason)
        : undefined
  const invite = async () => {
    try {
      const result = await createOnlineInvite(match.id)
      const url = new URL(location.href)
      url.searchParams.delete('match')
      url.searchParams.set('invite', result.token)
      setInviteUrl(url.toString())
      await navigator.clipboard?.writeText(url.toString())
    } catch (cause) {
      setInviteUrl(cause instanceof Error ? cause.message : '无法创建邀请')
    }
  }
  const proposalSeconds = match.proposal
    ? Math.max(0, Math.ceil((new Date(match.proposal.deadline).getTime() - now) / 1_000))
    : 0
  const remaining = (side: 'red' | 'black') => {
    if (!match.clock) return 0
    const snapshot = side === 'red' ? match.clock.redRemainingMs : match.clock.blackRemainingMs
    const elapsed =
      match.clock.activeSide === side && clockAnchor.revision === match.revision
        ? Math.max(0, clockNow - clockAnchor.receivedAt)
        : 0
    return Math.max(0, snapshot - elapsed)
  }
  const clockText = (milliseconds: number) => {
    const seconds = Math.ceil(milliseconds / 1_000)
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  }

  return (
    <main className="lan-shell online-shell online-match-shell">
      <header className="lan-header">
        <div>
          <small>ACCOUNT MATCH</small>
          <h1>{match.name}</h1>
          <p>
            {variantName(match)} ·{' '}
            {readOnly === 'public'
              ? '公开只读回放'
              : readOnly === 'history'
                ? '本人历史只读视图'
                : connected
                  ? '实时连接正常'
                  : '正在重连'}{' '}
            · revision {match.revision}
          </p>
        </div>
        <a href={`?online=1&game=${game}`}>返回公网大厅</a>
      </header>
      {error && <div className="lan-status error">{error}</div>}
      {actionError && <div className="lan-status error">{actionError}</div>}

      <section className="online-match-layout">
        <div className="online-board-column">
          <section className="card online-ready-room">
            <div className="online-section-title">
              <div>
                <small>{match.phase === 'waiting' ? 'READY ROOM' : 'PLAYERS'}</small>
                <h2>{match.phase === 'waiting' ? '准备室' : '对局席位'}</h2>
              </div>
              <span>{phaseName(match)}</span>
            </div>
            <div className="lan-ready-seats">
              {(['red', 'black'] as const).map((seat) => {
                const player = match.seats[seat]
                const mine = color === seat
                return (
                  <LanReadySeat
                    key={seat}
                    side={seat}
                    mark={
                      match.variant === 'gomoku'
                        ? seat === 'red'
                          ? '●'
                          : '○'
                        : seat === 'red'
                          ? '帅'
                          : '将'
                    }
                    title={seat === 'red' ? '红方' : '黑方'}
                    status={
                      player
                        ? `${player.nickname} · ${player.online ? '在线' : '离线'} · ${player.ready ? '已准备' : '未准备'}`
                        : '席位空缺'
                    }
                    current={mine}
                    disabled={Boolean(readOnly) || !mine || match.phase !== 'waiting' || pending}
                    actionLabel={
                      readOnly
                        ? '只读'
                        : mine
                          ? player?.ready
                            ? '取消准备'
                            : '准备开局'
                          : player
                            ? '已就座'
                            : '等待加入'
                    }
                    onAction={() => mine && send('match-ready', { ready: !player?.ready })}
                  />
                )
              })}
            </div>
            {!readOnly && match.isOwner && match.phase === 'waiting' && !match.matchmaking && (
              <div className="online-invite-actions">
                <button onClick={invite}>创建一次性邀请链接</button>
                {inviteUrl && (
                  <input
                    readOnly
                    value={inviteUrl}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                )}
              </div>
            )}
            {!readOnly && match.isOwner && match.phase === 'waiting' && match.matchmaking && (
              <button
                className="danger"
                disabled={pending}
                onClick={() => {
                  setActionError('')
                  cancelOnlineMatchmaking()
                    .then(() => {
                      location.href = `?online=1&game=${game}`
                    })
                    .catch((cause) =>
                      setActionError(cause instanceof Error ? cause.message : '取消匹配失败'),
                    )
                }}
              >
                取消匹配并返回大厅
              </button>
            )}
          </section>

          <section className="card online-board-card">
            {match.variant === 'gomoku' ? (
              <GomokuLanBoard
                board={match.board as Array<Array<'red' | 'black' | null>>}
                moves={match.moves.filter(
                  (move): move is typeof move & { row: number; col: number } =>
                    Number.isInteger(move.row) && Number.isInteger(move.col),
                )}
                disabled={!canMove}
                showOrder
                winner={
                  match.status === 'red-wins'
                    ? 'red'
                    : match.status === 'black-wins'
                      ? 'black'
                      : null
                }
                onMove={(row, col) => send('match-move', { row, col })}
              />
            ) : (
              <Board
                board={board!}
                gameStatus={match.status}
                gameStatusReason={boardReason}
                selectedPos={selected}
                legalMoves={legal}
                lastMove={lastMove}
                hintMove={null}
                inCheck={null}
                flipped={color === 'black'}
                aiThinking={false}
                thinkingText=""
                interactionDisabled={!canMove}
                onCellClick={click}
                onCancelSelection={() => setSelected(null)}
              />
            )}
          </section>
        </div>

        <aside className="online-side-column">
          {match.proposal && !readOnly && (
            <section className="card online-proposal-strip">
              <strong>
                {match.proposal.kind === 'draw'
                  ? '议和'
                  : match.proposal.kind === 'undo'
                    ? '悔棋'
                    : '换边'}
                协商
              </strong>
              <span>{proposalSeconds} 秒后失效</span>
              {match.proposal.canRespond && (
                <>
                  <button
                    disabled={match.competitionMode === 'rated' && match.proposal.kind === 'undo'}
                    onClick={() =>
                      send('match-proposal-respond', {
                        proposalId: match.proposal!.id,
                        accept: true,
                      })
                    }
                  >
                    同意
                  </button>
                  <button
                    onClick={() =>
                      send('match-proposal-respond', {
                        proposalId: match.proposal!.id,
                        accept: false,
                      })
                    }
                  >
                    拒绝
                  </button>
                </>
              )}
              {match.proposal.canWithdraw && (
                <button
                  onClick={() =>
                    send('match-proposal-withdraw', { proposalId: match.proposal!.id })
                  }
                >
                  撤回
                </button>
              )}
            </section>
          )}
          {readOnly !== 'public' && match.role !== 'spectator' && (
            <MatchRatingPanel matchId={match.id} revision={match.revision} />
          )}
          <section className="card online-match-tools">
            <small>MATCH ACTIONS</small>
            <h2>对局操作</h2>
            {match.competitionMode === 'rated' && (
              <p>排位对局禁止悔棋，单方断线超过宽限按负局计分。</p>
            )}
            {color && match.phase === 'playing' && !readOnly && (
              <div className="online-choice-row">
                <button
                  disabled={pending || !match.moves.length || match.competitionMode === 'rated'}
                  title={match.competitionMode === 'rated' ? '排位对局禁止悔棋' : undefined}
                  onClick={() => send('match-propose', { kind: 'undo' })}
                >
                  申请悔棋
                </button>
                <button disabled={pending} onClick={() => send('match-propose', { kind: 'draw' })}>
                  提议和棋
                </button>
              </div>
            )}
            {color && match.phase === 'playing' && !readOnly && (
              <button className="danger" disabled={pending} onClick={() => send('match-resign')}>
                认输并结束本局
              </button>
            )}
            {match.phase === 'finished' && !readOnly && (
              <button
                className="primary"
                onClick={() => {
                  setActionError('')
                  createOnlineRematch(match.id)
                    .then((result) => {
                      location.href = onlineRoomUrl(location.href, result.match.id, game)
                    })
                    .catch((cause) =>
                      setActionError(cause instanceof Error ? cause.message : '创建新对局失败'),
                    )
                }}
              >
                再来一局
              </button>
            )}
          </section>
          {match.clock && (
            <section className="card online-match-tools" aria-label="服务端权威棋钟">
              <small>SERVER CLOCK</small>
              <h2>棋钟</h2>
              <div className="online-choice-row">
                <strong>红方 {clockText(remaining('red'))}</strong>
                <strong>黑方 {clockText(remaining('black'))}</strong>
              </div>
              <p>
                服务端权威计时
                {match.clock.incrementMs ? ` · 每步加 ${match.clock.incrementMs / 1_000} 秒` : ''}
              </p>
            </section>
          )}
          <section className="card online-chat-card">
            <small>MATCH CHAT</small>
            <h2>对局聊天</h2>
            <div className="online-chat-log">
              {messages.length ? (
                messages.map((message) => (
                  <p key={message.id}>
                    <strong>{message.nickname}</strong>
                    <span>{message.content}</span>
                    {!readOnly && (match.isOwner || message.authorUserId === user?.id) && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => send('match-chat-delete', { messageId: message.id })}
                      >
                        删除
                      </button>
                    )}
                    {!readOnly &&
                      match.isOwner &&
                      message.authorUserId &&
                      message.authorUserId !== user?.id && (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => {
                            const muted = !mutedUserIds.has(message.authorUserId!)
                            if (
                              send('match-chat-mute', {
                                targetUserId: message.authorUserId,
                                muted,
                              })
                            ) {
                              setMutedUserIds((current) => {
                                const next = new Set(current)
                                if (muted) next.add(message.authorUserId!)
                                else next.delete(message.authorUserId!)
                                return next
                              })
                            }
                          }}
                        >
                          {mutedUserIds.has(message.authorUserId) ? '解除禁言' : '禁言'}
                        </button>
                      )}
                  </p>
                ))
              ) : (
                <em>暂无消息</em>
              )}
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                if (chat.trim() && sendChat(chat)) setChat('')
              }}
            >
              <textarea
                value={chat}
                maxLength={200}
                rows={3}
                disabled={Boolean(readOnly) || match.phase === 'finished'}
                onChange={(event) => setChat(event.target.value)}
                placeholder={
                  readOnly || match.phase === 'finished' ? '历史聊天只读' : '发送给本局棋友'
                }
              />
              <button
                className="primary"
                disabled={
                  !chat.trim() || pending || Boolean(readOnly) || match.phase === 'finished'
                }
              >
                发送
              </button>
            </form>
          </section>
        </aside>
      </section>
    </main>
  )
}
