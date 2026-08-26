import { FormEvent, useState } from 'react'
import {
  AccountDeletionImpact,
  AccountApiError,
  accountDeletionImpact,
  downloadAccountData,
  recoverAccount,
  register,
  requestPasswordReset,
  resetPassword,
} from './api'
import { useAuth } from './AuthContext'
import './auth.css'

type Mode = 'login' | 'register' | 'reset-request' | 'reset' | 'recover' | 'profile' | 'delete'

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
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [deletionImpact, setDeletionImpact] = useState<AccountDeletionImpact | null>(null)

  const chooseMode = (next: Mode) => {
    setMode(next)
    setError('')
    setMessage('')
    setPassword('')
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
        setMessage(
          result.developmentToken
            ? `注册已受理。本地验证 token：${result.developmentToken}`
            : '注册已受理，请查收验证邮件。',
        )
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
              {(mode === 'reset' || mode === 'recover') && (
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
                mode === 'delete') && (
                <label>
                  {mode === 'reset' ? '新密码' : mode === 'delete' ? '当前密码' : '密码'}
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    minLength={12}
                    autoComplete={
                      mode === 'login' || mode === 'delete' ? 'current-password' : 'new-password'
                    }
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
    'reset-request': '找回密码',
    reset: '设置新密码',
    recover: '恢复账号',
    profile: '账号资料',
    delete: '删除账号',
  }[mode]
}

function actionLabel(mode: Mode): string {
  return {
    login: '登录',
    register: '提交注册',
    'reset-request': '发送重置邮件',
    reset: '重置密码',
    recover: '恢复账号',
    profile: '保存资料',
    delete: '确认进入删除恢复期',
  }[mode]
}
