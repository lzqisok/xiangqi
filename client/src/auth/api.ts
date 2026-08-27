export type AccountStatus = 'pending_verification' | 'active' | 'restricted'

export type AccountUser = {
  id: string
  status: AccountStatus
  authEpoch: number
  displayName: string
  locale: string
  email: string
  emailVerified: boolean
  createdAt: string
}

type TokenResponse = { accepted: true; developmentToken?: string }
type SessionResponse = { authenticated: false } | { authenticated: true; user: AccountUser }

export type AccountDeletionImpact = {
  privateDocuments: Record<string, number>
  privateDocumentTotal: number
  sharedMatchesToAnonymize: number
  activeSessionsToRevoke: number
  recoveryDays: number
}

export type AccountSession = {
  id: string
  deviceLabel: string | null
  createdAt: string
  lastSeenAt: string
  idleExpiresAt: string
  absoluteExpiresAt: string
  revokedAt: string | null
  current: boolean
}

export type AccountOverview = {
  resources: Array<{ resource: string; count: number; bytes: number; quota: number }>
  matches: Record<string, number>
  securityEvents: Array<{ type: string; result: string; createdAt: string }>
}

export class AccountApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfterSeconds?: number,
    readonly details?: unknown,
  ) {
    super(code)
    this.name = 'AccountApiError'
  }
}

let csrfToken: string | null = null

export function accountCacheKey(userId: string, resource: string): string {
  return `xiangqi:user:${userId}:${resource}`
}

export function clearAccountCredentials(): void {
  csrfToken = null
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  if (csrfToken && init.method && init.method !== 'GET') headers.set('X-CSRF-Token', csrfToken)
  let response: Response
  try {
    response = await fetch(path, { ...init, headers, credentials: 'same-origin' })
  } catch {
    throw new AccountApiError(0, 'network_error')
  }
  const payload = response.status === 204 ? undefined : await response.json().catch(() => undefined)
  if (!response.ok) {
    if (response.status === 401) {
      clearAccountCredentials()
      window.dispatchEvent(new CustomEvent('xiangqi-session-expired'))
    }
    throw new AccountApiError(
      response.status,
      payload?.error || 'request_failed',
      Number(response.headers.get('Retry-After')) || undefined,
      payload,
    )
  }
  return payload as T
}

export { request as accountRequest }

export async function restoreSession(): Promise<AccountUser | null> {
  const session = await request<SessionResponse>('/api/auth/session')
  if (!session.authenticated) {
    clearAccountCredentials()
    return null
  }
  const csrf = await request<{ csrfToken: string }>('/api/auth/csrf')
  csrfToken = csrf.csrfToken
  return session.user
}

export async function login(email: string, password: string): Promise<AccountUser> {
  const result = await request<{ user: AccountUser; csrfToken: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, deviceLabel: navigator.userAgent.slice(0, 100) }),
  })
  csrfToken = result.csrfToken
  return result.user
}

export function register(
  email: string,
  password: string,
  displayName: string,
): Promise<TokenResponse> {
  return request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName }),
  })
}

export function verifyEmail(token: string): Promise<{ verified: true }> {
  return request('/api/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
}

export function resendVerification(): Promise<TokenResponse> {
  return request('/api/auth/verification/resend', { method: 'POST' })
}

export function requestPasswordReset(email: string): Promise<TokenResponse> {
  return request('/api/auth/password/reset-request', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export function resetPassword(token: string, password: string): Promise<{ reset: true }> {
  return request('/api/auth/password/reset', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  })
}

export function recoverAccount(token: string): Promise<{ recovered: true }> {
  return request('/api/account/recover', {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
}

export async function updateProfile(displayName: string): Promise<AccountUser> {
  const result = await request<{ user: AccountUser }>('/api/me/profile', {
    method: 'PATCH',
    body: JSON.stringify({ displayName }),
  })
  return result.user
}

export async function logout(): Promise<void> {
  try {
    await request<void>('/api/auth/logout', { method: 'POST' })
  } finally {
    clearAccountCredentials()
  }
}

export async function accountDeletionImpact(): Promise<AccountDeletionImpact> {
  const result = await request<{ impact: AccountDeletionImpact }>('/api/me/deletion-impact')
  return result.impact
}

export async function downloadAccountData(): Promise<void> {
  const payload = await request<Record<string, unknown>>('/api/me/data-export')
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `xiangqi-account-data-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function beginAccountDeletion(currentPassword: string): Promise<void> {
  try {
    await request('/api/me/deletion', {
      method: 'POST',
      body: JSON.stringify({ currentPassword }),
    })
  } finally {
    clearAccountCredentials()
  }
}

export async function accountOverview(): Promise<AccountOverview> {
  const result = await request<{ overview: AccountOverview }>('/api/me/account-overview')
  return result.overview
}

export async function listAccountSessions(): Promise<AccountSession[]> {
  const result = await request<{ sessions: AccountSession[] }>('/api/me/sessions')
  return result.sessions
}

export async function revokeAccountSession(sessionId: string): Promise<void> {
  await request(`/api/me/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
}

export async function changeAccountPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await request('/api/me/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  })
}
