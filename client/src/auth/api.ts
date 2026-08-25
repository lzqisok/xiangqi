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

export class AccountApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfterSeconds?: number,
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
    )
  }
  return payload as T
}

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
