import { ratingDetailText } from './ratingDisplay'
import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { getMatchRating, listRatingLedger } from './api'
import type { MatchRatingDetail, RatingLedgerEntry } from './types'

function Detail({ matchId }: { matchId: string }) {
  const [detail, setDetail] = useState<MatchRatingDetail | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let disposed = false
    setFailed(false)
    getMatchRating(matchId)
      .then((value) => {
        if (!disposed) setDetail(value)
      })
      .catch(() => {
        if (!disposed) setFailed(true)
      })
    return () => {
      disposed = true
    }
  }, [matchId, attempt])
  return (
    <section className="card">
      <h2>本人本局积分</h2>
      {failed ? (
        <button onClick={() => setAttempt(attempt + 1)}>积分查询失败，重试</button>
      ) : (
        <p>{detail ? ratingDetailText(detail) : '正在读取积分…'}</p>
      )}
    </section>
  )
}
export function MatchRatingPanel({ matchId, revision }: { matchId: string; revision: number }) {
  const { user } = useAuth()
  return user ? <Detail key={`${user.id}:${matchId}:${revision}`} matchId={matchId} /> : null
}
function Ledger() {
  const [entries, setEntries] = useState<RatingLedgerEntry[]>([])
  const [cursor, setCursor] = useState<string>()
  const [request, setRequest] = useState<{ cursor?: string; attempt: number }>({ attempt: 0 })
  const [busy, setBusy] = useState(true)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let disposed = false
    setBusy(true)
    setFailed(false)
    listRatingLedger(request.cursor)
      .then((page) => {
        if (disposed) return
        setEntries((old) =>
          request.cursor
            ? [...old, ...page.entries.filter((entry) => !old.some((item) => item.id === entry.id))]
            : page.entries,
        )
        setCursor(page.nextCursor)
      })
      .catch(() => {
        if (!disposed) setFailed(true)
      })
      .finally(() => {
        if (!disposed) setBusy(false)
      })
    return () => {
      disposed = true
    }
  }, [request])
  return (
    <section className="card online-list-section">
      <h2>本人积分流水</h2>
      <button disabled={busy} onClick={() => setRequest({ attempt: request.attempt + 1 })}>
        刷新流水
      </button>
      {!entries.length && !busy && !failed && <p>暂无积分流水。</p>}
      {entries.map((entry) => (
        <p key={entry.id}>
          {new Date(entry.createdAt).toLocaleString()} ·{' '}
          {
            {
              xiangqi: '普通象棋',
              jieqi: '揭棋',
              'gomoku-freestyle': '五子棋自由规则',
              'gomoku-renju': '五子棋禁手规则',
            }[entry.pool]
          }{' '}
          · {entry.type === 'void' ? '作废补偿' : entry.voided ? '原结算（已作废）' : '对局结算'}：
          {entry.before} → {entry.after}（{entry.delta >= 0 ? '+' : ''}
          {entry.delta}）{entry.type === 'void' && ` · ${entry.reason}`}
        </p>
      ))}
      {busy && <p>正在读取流水…</p>}
      {failed && (
        <button onClick={() => setRequest({ ...request, attempt: request.attempt + 1 })}>
          流水加载失败，重试
        </button>
      )}
      {cursor && !failed && (
        <button
          disabled={busy}
          onClick={() => setRequest({ cursor, attempt: request.attempt + 1 })}
        >
          加载更多流水
        </button>
      )}
    </section>
  )
}
export function RatingLedgerPanel() {
  const { user } = useAuth()
  return user ? <Ledger key={user.id} /> : null
}
