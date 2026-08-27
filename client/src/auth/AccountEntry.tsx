import { FormEvent, useState } from 'react'
import {
  AccountDeletionImpact,
  AccountApiError,
  type AccountOverview,
  type AccountSession,
  accountOverview,
  accountDeletionImpact,
  downloadAccountData,
  listAccountSessions,
  recoverAccount,
  register,
  resendVerification,
  requestPasswordReset,
  resetPassword,
  revokeAccountSession,
  verifyEmail,
} from './api'
import { useAuth } from './AuthContext'
import {
  clearImportedLegacyData,
  type ImportableResource,
  type LegacyConflictPreview,
  type LegacyImportJob,
  type LegacyImportScan,
  runLegacyImport,
  previewLegacyConflicts,
  scanLegacyLocalData,
} from '../sync/localImport'
import {
  downloadPendingCloudMutations,
  pendingCloudMutationCount,
  retryPendingCloudMutations,
} from '../sync/cloudDocuments'
import { listMyMatches } from '../online/api'
import type { OnlineMatchSummary } from '../online/types'
import './auth.css'

type Mode =
  | 'login'
  | 'register'
  | 'verify'
  | 'reset-request'
  | 'reset'
  | 'recover'
  | 'profile'
  | 'password'
  | 'delete'

const ERROR_TEXT: Record<string, string> = {
  invalid_credentials: '邮箱或密码不正确',
  invalid_email: '请输入有效的邮箱地址',
  invalid_password: '密码至少需要 12 个字节',
  invalid_display_name: '昵称需要 2～20 个字符',
  invalid_token: '链接无效或已经过期',
  csrf_rejected: '安全校验已失效，请刷新后重试',
  origin_not_allowed: '当前来源不允许执行此操作',
  network_error: '网络连接失败，请稍后重试',
  database_unavailable: '账号服务暂时不可用',
}

function errorText(error: unknown): string {
  if (!(error instanceof AccountApiError)) return '操作失败，请稍后重试'
  if (error.status === 429) return `操作过于频繁，请在 ${error.retryAfterSeconds || 60} 秒后重试`
  if (error.status === 401) return ERROR_TEXT.invalid_credentials
  if (error.status === 403) return ERROR_TEXT[error.code] || '当前账号无权执行此操作'
  return ERROR_TEXT[error.code] || '操作失败，请稍后重试'
}

export default function AccountEntry() {
  const auth = useAuth()
  const verificationToken = new URLSearchParams(window.location.search).get('verify-email') || ''
  const [open, setOpen] = useState(Boolean(verificationToken))
  const [mode, setMode] = useState<Mode>(verificationToken ? 'verify' : 'login')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [token, setToken] = useState(verificationToken)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [deletionImpact, setDeletionImpact] = useState<AccountDeletionImpact | null>(null)
  const [legacyScan, setLegacyScan] = useState<LegacyImportScan | null>(null)
  const [selectedLegacyResources, setSelectedLegacyResources] = useState<ImportableResource[]>([])
  const [legacyImportJob, setLegacyImportJob] = useState<LegacyImportJob | null>(null)
  const [legacyConflicts, setLegacyConflicts] = useState<Partial<LegacyConflictPreview> | null>(
    null,
  )
  const [overview, setOverview] = useState<AccountOverview | null>(null)
  const [sessions, setSessions] = useState<AccountSession[]>([])
  const [onlineHistory, setOnlineHistory] = useState<OnlineMatchSummary[]>([])

  const chooseMode = (next: Mode) => {
    setMode(next)
    setError('')
    setMessage('')
    setPassword('')
    setNewPassword('')
  }

  const loadAccountCenter = async () => {
    const [nextOverview, nextSessions, nextHistory] = await Promise.all([
      accountOverview(),
      listAccountSessions(),
      listMyMatches().catch(() => ({ matches: [] })),
    ])
    setOverview(nextOverview)
    setSessions(nextSessions)
    setOnlineHistory(nextHistory.matches)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    setMessage('')
    try {
      if (mode === 'login') {
        await auth.login(email, password)
        setOpen(false)
      } else if (mode === 'register') {
        const result = await register(email, password, displayName)
        if (result.developmentToken) {
          setToken(result.developmentToken)
          setMode('verify')
        }
        setMessage(
          result.developmentToken
            ? '注册已受理，请提交本地验证 token。'
            : '注册已受理，请查收验证邮件。',
        )
      } else if (mode === 'verify') {
        await verifyEmail(token)
        const url = new URL(window.location.href)
        url.searchParams.delete('verify-email')
        window.history.replaceState(null, '', url)
        await auth.refresh()
        setMessage('邮箱已验证，可以使用公网功能。')
        setMode(auth.user ? 'profile' : 'login')
      } else if (mode === 'reset-request') {
        const result = await requestPasswordReset(email)
        setToken(result.developmentToken || '')
        setMessage('如果该邮箱已注册，重置邮件会很快送达。')
        if (result.developmentToken) setMode('reset')
      } else if (mode === 'reset') {
        await resetPassword(token, password)
        setMessage('密码已重置，请使用新密码登录。')
        setMode('login')
      } else if (mode === 'recover') {
        await recoverAccount(token)
        setMessage('账号已恢复，请重新登录。')
        setMode('login')
      } else if (mode === 'profile') {
        await auth.updateProfile(displayName)
        setMessage('昵称已更新。')
      } else if (mode === 'password') {
        await auth.changePassword(password, newPassword)
        chooseMode('profile')
        setMessage('密码已修改，其他设备会话已撤销。')
        await loadAccountCenter()
      } else {
        await auth.deleteAccount(password)
        setOpen(false)
      }
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setSubmitting(false)
    }
  }

  if (auth.loading) return <div className="account-entry account-entry-loading">正在检查账号…</div>

  return (
    <div className="account-entry">
      <button
        className="account-entry-button"
        type="button"
        onClick={() => {
          chooseMode(auth.user ? 'profile' : 'login')
          setDisplayName(auth.user?.displayName || '')
          setOpen(true)
          if (auth.user) void loadAccountCenter().catch(() => undefined)
        }}
      >
        <span aria-hidden="true">{auth.user?.displayName.slice(0, 1) || '人'}</span>
        <span>
          <strong>{auth.user?.displayName || '登录云端账号'}</strong>
          <small>
            {auth.user
              ? auth.user.emailVerified
                ? '已登录，可使用公网功能'
                : '邮箱待验证，公网功能受限'
              : auth.available
                ? '跨设备保存与在线对战'
                : '账号服务未启用，本地模式不受影响'}
          </small>
        </span>
      </button>

      {open && (
        <div className="account-overlay" role="presentation" onMouseDown={() => setOpen(false)}>
          <section
            className="account-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="account-close"
              type="button"
              aria-label="关闭"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
            <small>XIANGQI ACCOUNT</small>
            <h2 id="account-title">{title(mode)}</h2>
            <form onSubmit={submit}>
              {(mode === 'login' || mode === 'register' || mode === 'reset-request') && (
                <label>
                  邮箱
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </label>
              )}
              {(mode === 'register' || mode === 'profile') && (
                <label>
                  昵称
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    minLength={2}
                    maxLength={20}
                    required
                  />
                </label>
              )}
              {(mode === 'verify' || mode === 'reset' || mode === 'recover') && (
                <label>
                  一次性 token
                  <textarea
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    required
                  />
                </label>
              )}
              {(mode === 'login' ||
                mode === 'register' ||
                mode === 'reset' ||
                mode === 'password' ||
                mode === 'delete') && (
                <label>
                  {mode === 'reset'
                    ? '新密码'
                    : mode === 'delete' || mode === 'password'
                      ? '当前密码'
                      : '密码'}
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    minLength={12}
                    autoComplete={
                      mode === 'login' || mode === 'delete' || mode === 'password'
                        ? 'current-password'
                        : 'new-password'
                    }
                    required
                  />
                </label>
              )}
              {mode === 'password' && (
                <label>
                  新密码
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    minLength={12}
                    autoComplete="new-password"
                    required
                  />
                </label>
              )}
              {mode === 'delete' && deletionImpact && (
                <div className="account-deletion-impact">
                  <strong>删除影响</strong>
                  <p>
                    {deletionImpact.privateDocumentTotal} 条私有数据将在恢复期后删除；
                    {deletionImpact.sharedMatchesToAnonymize}{' '}
                    盘共享对局会保留并将你的参与信息匿名化；
                    {deletionImpact.activeSessionsToRevoke} 个有效会话会立即撤销。
                  </p>
                  <p>提交后有 {deletionImpact.recoveryDays} 天可通过邮件 token 恢复账号。</p>
                </div>
              )}
              {error && (
                <p className="account-error" role="alert">
                  {error}
                </p>
              )}
              {message && (
                <p className="account-message" role="status">
                  {message}
                </p>
              )}
              <button className="account-submit" type="submit" disabled={submitting}>
                {submitting ? '正在处理…' : actionLabel(mode)}
              </button>
            </form>
            {auth.user && mode === 'profile' && overview && (
              <section className="account-center-summary" aria-label="账号中心摘要">
                <strong>账号中心</strong>
                <p>
                  {auth.user.email} · {auth.user.emailVerified ? '邮箱已验证' : '邮箱待验证'} · 状态{' '}
                  {auth.user.status}
                </p>
                {auth.user.status === 'restricted' && (
                  <p className="account-readonly-notice">
                    当前账号受限：云端私有数据和对局历史保持只读，账号安全与数据导出仍可使用。
                  </p>
                )}
                {!auth.user.emailVerified && (
                  <button
                    className="account-link"
                    type="button"
                    disabled={submitting}
                    onClick={() => {
                      setSubmitting(true)
                      setError('')
                      void resendVerification()
                        .then((result) => {
                          if (result.developmentToken) {
                            setToken(result.developmentToken)
                            setMode('verify')
                          }
                          setMessage(
                            result.developmentToken
                              ? '验证邮件已重发，请提交本地验证 token。'
                              : '验证邮件已重发，请检查邮箱。',
                          )
                        })
                        .catch((cause) => setError(errorText(cause)))
                        .finally(() => setSubmitting(false))
                    }}
                  >
                    重发验证邮件
                  </button>
                )}
                <p>
                  云端私有数据 {overview.resources.reduce((sum, item) => sum + item.count, 0)} 项；
                  在线历史：象棋 {overview.matches.xiangqi || 0}、揭棋 {overview.matches.jieqi || 0}
                  、 五子棋 {overview.matches.gomoku || 0}。
                </p>
                <div className="account-resource-grid">
                  {overview.resources.map((item) => (
                    <span key={item.resource}>
                      {item.resource} {item.count}/{item.quota}
                    </span>
                  ))}
                </div>
                <strong>活跃会话</strong>
                {sessions
                  .filter((session) => !session.revokedAt)
                  .map((session) => (
                    <div className="account-session" key={session.id}>
                      <span>
                        {session.deviceLabel || '未知设备'} {session.current ? '（当前设备）' : ''}
                      </span>
                      {!session.current && (
                        <button
                          className="account-link"
                          type="button"
                          onClick={() =>
                            void revokeAccountSession(session.id).then(() => loadAccountCenter())
                          }
                        >
                          撤销
                        </button>
                      )}
                    </div>
                  ))}
                <strong>本人在线对局</strong>
                {onlineHistory.length === 0 ? (
                  <p>暂无在线对局历史。</p>
                ) : (
                  onlineHistory.slice(0, 10).map((match) => (
                    <a
                      className="account-match-link"
                      key={match.id}
                      href={`?online=1&game=${match.variant === 'gomoku' ? 'gomoku' : 'xiangqi'}&match=${encodeURIComponent(match.id)}`}
                    >
                      <span>{match.name}</span>
                      <small>
                        {match.variant === 'xiangqi'
                          ? '普通象棋'
                          : match.variant === 'jieqi'
                            ? '揭棋'
                            : '五子棋'}{' '}
                        · {match.phase === 'finished' ? '已结束' : '进行中'}
                      </small>
                    </a>
                  ))
                )}
                <strong>最近安全事件</strong>
                {overview.securityEvents.slice(0, 5).map((event, index) => (
                  <p key={`${event.createdAt}:${index}`}>
                    {event.type} · {event.result} · {new Date(event.createdAt).toLocaleString()}
                  </p>
                ))}
              </section>
            )}
            {auth.user && mode === 'profile' && legacyScan && (
              <section className="account-legacy-import" aria-label="本机旧数据导入">
                <strong>本机旧数据</strong>
                {legacyScan.categories.length === 0 ? (
                  <p>未发现可迁移的旧版全局数据。</p>
                ) : (
                  legacyScan.categories.map((category) => (
                    <label key={category.resource}>
                      <input
                        type="checkbox"
                        disabled={!category.selectable || submitting}
                        checked={selectedLegacyResources.includes(
                          category.resource as ImportableResource,
                        )}
                        onChange={(event) => {
                          setLegacyConflicts(null)
                          setSelectedLegacyResources((current) =>
                            event.target.checked
                              ? [...current, category.resource as ImportableResource]
                              : current.filter((resource) => resource !== category.resource),
                          )
                        }}
                      />
                      <span>
                        {category.label}：{category.count} 项
                        {category.reason === 'damaged'
                          ? '（数据损坏，已跳过）'
                          : category.reason === 'sensitive'
                            ? '（私密席位备份需走专用校验，已跳过）'
                            : ''}
                      </span>
                    </label>
                  ))
                )}
                {legacyScan.excludedCapabilityCount > 0 && (
                  <p>
                    已排除 {legacyScan.excludedCapabilityCount} 项 LAN token、邀请等设备
                    capability。
                  </p>
                )}
                <p>
                  导入前不会上传；重复提交使用同一导入 ID。旧数据不会自动删除，请先另行导出备份。
                </p>
                {legacyConflicts && (
                  <div className="account-conflict-preview">
                    {Object.entries(legacyConflicts).map(([resource, summary]) => (
                      <span key={resource}>
                        {resource}：新增 {summary.newItems}，相同跳过 {summary.sameContent}
                        ，内容不同保留云端并跳过 {summary.differentContent}
                      </span>
                    ))}
                  </div>
                )}
                <button
                  className="account-link"
                  type="button"
                  disabled={submitting || selectedLegacyResources.length === 0}
                  onClick={() => {
                    setSubmitting(true)
                    void previewLegacyConflicts(selectedLegacyResources)
                      .then(setLegacyConflicts)
                      .catch((cause) => setError(errorText(cause)))
                      .finally(() => setSubmitting(false))
                  }}
                >
                  预览冲突
                </button>
                <button
                  className="account-link"
                  type="button"
                  disabled={submitting || selectedLegacyResources.length === 0 || !legacyConflicts}
                  onClick={() => {
                    setSubmitting(true)
                    setError('')
                    void runLegacyImport(auth.user!.id, selectedLegacyResources)
                      .then((job) => {
                        setLegacyImportJob(job)
                        setMessage(
                          job.status === 'complete'
                            ? '选中的旧数据已导入。'
                            : '部分导入失败，可原样重试。',
                        )
                      })
                      .catch((cause) => setError(errorText(cause)))
                      .finally(() => setSubmitting(false))
                  }}
                >
                  导入选中数据
                </button>
                {legacyImportJob?.status === 'complete' && (
                  <button
                    className="account-link account-danger"
                    type="button"
                    onClick={() => {
                      clearImportedLegacyData(legacyImportJob.selected)
                      setLegacyScan(scanLegacyLocalData())
                      setSelectedLegacyResources([])
                      setMessage('已清理确认导入的旧数据；设备 capability 未受影响。')
                    }}
                  >
                    已备份，清理成功导入的旧数据
                  </button>
                )}
              </section>
            )}
            {auth.user ? (
              <div className="account-user-actions">
                {mode !== 'delete' && (
                  <>
                    <button
                      className="account-link"
                      type="button"
                      disabled={submitting}
                      onClick={() => {
                        setSubmitting(true)
                        setError('')
                        void downloadAccountData()
                          .then(() => setMessage('账号数据已导出。'))
                          .catch((cause) => setError(errorText(cause)))
                          .finally(() => setSubmitting(false))
                      }}
                    >
                      导出账号数据
                    </button>
                    <button
                      className="account-link"
                      type="button"
                      disabled={submitting}
                      onClick={() => {
                        const scan = scanLegacyLocalData()
                        setLegacyScan(scan)
                        setSelectedLegacyResources(
                          scan.categories
                            .filter((category) => category.selectable)
                            .map((category) => category.resource as ImportableResource),
                        )
                        setLegacyConflicts(null)
                      }}
                    >
                      检查本机旧数据
                    </button>
                    <button
                      className="account-link"
                      type="button"
                      onClick={() => chooseMode('password')}
                    >
                      修改密码
                    </button>
                    {pendingCloudMutationCount() > 0 && (
                      <>
                        <button
                          className="account-link"
                          type="button"
                          onClick={retryPendingCloudMutations}
                        >
                          重试待同步数据
                        </button>
                        <button
                          className="account-link"
                          type="button"
                          onClick={downloadPendingCloudMutations}
                        >
                          导出待同步快照
                        </button>
                      </>
                    )}
                    <button
                      className="account-link account-danger"
                      type="button"
                      disabled={submitting}
                      onClick={() => {
                        setSubmitting(true)
                        setError('')
                        void accountDeletionImpact()
                          .then((impact) => {
                            setDeletionImpact(impact)
                            chooseMode('delete')
                          })
                          .catch((cause) => setError(errorText(cause)))
                          .finally(() => setSubmitting(false))
                      }}
                    >
                      删除账号
                    </button>
                  </>
                )}
                {mode === 'delete' && (
                  <button
                    className="account-link"
                    type="button"
                    onClick={() => chooseMode('profile')}
                  >
                    取消删除
                  </button>
                )}
                <button
                  className="account-link account-logout"
                  type="button"
                  disabled={submitting}
                  onClick={() =>
                    void auth
                      .logout()
                      .catch(() => undefined)
                      .finally(() => setOpen(false))
                  }
                >
                  退出当前账号
                </button>
              </div>
            ) : (
              <nav className="account-mode-links" aria-label="账号操作">
                {mode !== 'login' && (
                  <button type="button" onClick={() => chooseMode('login')}>
                    返回登录
                  </button>
                )}
                {mode !== 'register' && (
                  <button type="button" onClick={() => chooseMode('register')}>
                    注册账号
                  </button>
                )}
                {mode !== 'reset-request' && (
                  <button type="button" onClick={() => chooseMode('reset-request')}>
                    忘记密码
                  </button>
                )}
                {mode !== 'recover' && (
                  <button type="button" onClick={() => chooseMode('recover')}>
                    恢复待删除账号
                  </button>
                )}
              </nav>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function title(mode: Mode): string {
  return {
    login: '登录账号',
    register: '注册账号',
    verify: '验证邮箱',
    'reset-request': '找回密码',
    reset: '设置新密码',
    recover: '恢复账号',
    profile: '账号资料',
    password: '修改密码',
    delete: '删除账号',
  }[mode]
}

function actionLabel(mode: Mode): string {
  return {
    login: '登录',
    register: '提交注册',
    verify: '确认验证邮箱',
    'reset-request': '发送重置邮件',
    reset: '重置密码',
    recover: '恢复账号',
    profile: '保存资料',
    password: '确认修改密码',
    delete: '确认进入删除恢复期',
  }[mode]
}
