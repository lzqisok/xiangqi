import type { WebSocket } from 'ws'
import { RepositoryUniqueConflictError } from '../db/errors.js'
import { MySqlAccountRepository } from '../repositories/mysql.js'
import { MySqlAuthRepository } from './repository.js'
import {
  AuthRateLimiter,
  PASSWORD_HASH_VERSION,
  assertPassword,
  createOpaqueToken,
  hashPassword,
  normalizeDisplayName,
  normalizeEmail,
  passwordNeedsUpgrade,
  tokenHash,
  tokenMatches,
  verifyPassword,
} from './security.js'
import type {
  AuthAccount,
  AuthSession,
  AuthTokenDelivery,
  AuthTokenPurpose,
  PublicActor,
  UserActor,
} from './types.js'

const DAY = 86_400_000

export class AuthError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code)
    this.name = 'AuthError'
  }
}

export type SessionCredentials = {
  sessionToken: string
  csrfToken: string
  session: AuthSession
}

export class AuthConnectionRegistry {
  private readonly bySession = new Map<string, Set<WebSocket>>()

  bind(sessionId: string, socket: WebSocket): void {
    const sockets = this.bySession.get(sessionId) ?? new Set<WebSocket>()
    sockets.add(socket)
    this.bySession.set(sessionId, sockets)
    socket.once('close', () => {
      sockets.delete(socket)
      if (!sockets.size) this.bySession.delete(sessionId)
    })
  }

  closeSession(sessionId: string, reason = 'Session revoked'): void {
    for (const socket of this.bySession.get(sessionId) ?? []) socket.close(1008, reason)
    this.bySession.delete(sessionId)
  }

  closeSessions(sessions: readonly { id: string }[], reason: string): void {
    for (const session of sessions) this.closeSession(session.id, reason)
  }
}

function capabilities(status: UserActor['status']): readonly string[] {
  if (status === 'active')
    return ['account:read', 'profile:write', 'online:play', 'online:watch', 'online:history']
  if (status === 'pending_verification')
    return ['account:read', 'profile:write', 'verification:resend']
  return ['account:read', 'profile:write', 'online:history']
}

export class AuthService {
  readonly connections = new AuthConnectionRegistry()
  private readonly loginLimiter = new AuthRateLimiter(5, 15 * 60_000)
  private accountDeletionHandler?: (userId: string) => Promise<void>

  constructor(
    private readonly accounts: MySqlAccountRepository,
    private readonly repository: MySqlAuthRepository,
    private readonly delivery: AuthTokenDelivery,
  ) {}

  setAccountDeletionHandler(handler: (userId: string) => Promise<void>): void {
    this.accountDeletionHandler = handler
  }

  async register(input: {
    email: unknown
    password: unknown
    displayName: unknown
    ipKey: string
    userAgent?: string
  }): Promise<{ accepted: true; developmentToken?: string }> {
    const email = normalizeEmail(input.email)
    const displayName = normalizeDisplayName(input.displayName)
    assertPassword(input.password)
    const password = input.password
    const passwordDigest = await hashPassword(password)
    const verificationToken = createOpaqueToken()
    const expiresAt = new Date(Date.now() + DAY)
    let account: { id: string }
    try {
      account = await this.accounts.create({
        emailNormalized: email,
        emailDisplay: String(input.email).trim(),
        displayName,
        passwordHash: passwordDigest,
        passwordHashVersion: PASSWORD_HASH_VERSION,
        verificationTokenHash: tokenHash(verificationToken),
        verificationExpiresAt: expiresAt,
      })
    } catch (error) {
      if (!(error instanceof RepositoryUniqueConflictError)) throw error
      await this.record({
        type: 'registration',
        result: 'accepted_existing',
        ipPrefix: input.ipKey,
        userAgent: input.userAgent,
      })
      return { accepted: true }
    }
    let delivered = true
    try {
      await this.delivery.deliver({
        purpose: 'verify_email',
        email,
        token: verificationToken,
        expiresAt,
      })
    } catch {
      delivered = false
    }
    await this.record({
      userId: account.id,
      type: 'registration',
      result: delivered ? 'accepted' : 'delivery_failed',
      ipPrefix: input.ipKey,
      userAgent: input.userAgent,
    })
    return {
      accepted: true,
      ...(delivered ? { developmentToken: verificationToken } : {}),
    }
  }

  async login(input: {
    email: unknown
    password: unknown
    ipKey: string
    deviceKey: string
    deviceLabel?: string
    userAgent?: string
  }): Promise<SessionCredentials> {
    const email = normalizeEmail(input.email)
    if (typeof input.password !== 'string') throw new AuthError('invalid_credentials', 401)
    const keys = [`ip:${input.ipKey}`, `email:${email}`, `device:${input.deviceKey}`]
    const limit = this.loginLimiter.consume(keys)
    if (!limit.allowed) throw new AuthError(`rate_limited:${limit.retryAfterSeconds}`, 429)
    const account = await this.repository.findAccountByEmail(email)
    const valid = await verifyPassword(account?.passwordHash, input.password)
    if (
      !valid ||
      !account ||
      !['pending_verification', 'active', 'restricted'].includes(account.status)
    ) {
      await this.record({
        userId: account?.id,
        type: 'login',
        result: 'rejected',
        ipPrefix: input.ipKey,
        userAgent: input.userAgent,
      })
      throw new AuthError('invalid_credentials', 401)
    }
    this.loginLimiter.reset(keys)
    if (passwordNeedsUpgrade(account.passwordHash, account.passwordHashVersion)) {
      const upgraded = await hashPassword(input.password)
      await this.repository.upgradePasswordHash(
        account.id,
        account.passwordHash,
        upgraded,
        PASSWORD_HASH_VERSION,
        new Date(),
      )
    }
    const credentials = await this.createSession(account, input.deviceLabel, input.ipKey)
    await this.record({
      userId: account.id,
      sessionId: credentials.session.id,
      type: 'login',
      result: 'success',
      ipPrefix: input.ipKey,
      userAgent: input.userAgent,
    })
    return credentials
  }

  async authenticate(
    sessionToken: string | undefined,
    requestId: string,
    ipKey: string,
  ): Promise<{ actor: PublicActor; session?: AuthSession }> {
    if (!sessionToken) return { actor: { kind: 'anonymous', requestId, ipKey } }
    const now = new Date()
    const session = await this.repository.findValidSession(tokenHash(sessionToken), now)
    if (
      !session ||
      !['pending_verification', 'active', 'restricted'].includes(session.accountStatus)
    ) {
      return { actor: { kind: 'anonymous', requestId, ipKey } }
    }
    if (now.getTime() - session.lastSeenAt.getTime() >= 5 * 60_000) {
      const nextIdleExpiry = new Date(
        Math.min(now.getTime() + 7 * DAY, session.absoluteExpiresAt.getTime()),
      )
      await this.repository.touchSession(session.id, now, nextIdleExpiry)
      session.lastSeenAt = now
      session.idleExpiresAt = nextIdleExpiry
    }
    const status = session.accountStatus as UserActor['status']
    return {
      actor: {
        kind: 'user',
        requestId,
        ipKey,
        userId: session.userId,
        sessionId: session.id,
        authEpoch: session.authEpoch,
        expiresAt: new Date(
          Math.min(session.idleExpiresAt.getTime(), session.absoluteExpiresAt.getTime()),
        ),
        status,
        capabilities: capabilities(status),
      },
      session,
    }
  }

  csrfValid(session: AuthSession, token: string | undefined): boolean {
    return Boolean(token) && tokenMatches(token!, session.csrfSecretHash)
  }

  async rotateCsrf(actor: UserActor): Promise<string> {
    const token = createOpaqueToken()
    if (!(await this.repository.rotateCsrf(actor.sessionId, actor.userId, tokenHash(token)))) {
      throw new AuthError('session_expired', 401)
    }
    return token
  }

  async logout(actor: UserActor): Promise<void> {
    await this.repository.revokeSession(actor.sessionId, actor.userId, new Date())
    this.connections.closeSession(actor.sessionId)
    await this.record({
      userId: actor.userId,
      sessionId: actor.sessionId,
      type: 'logout',
      result: 'success',
    })
  }

  async verifyEmail(token: unknown): Promise<boolean> {
    if (typeof token !== 'string' || token.length > 200) return false
    return Boolean(await this.repository.verifyEmailToken(tokenHash(token), new Date()))
  }

  async resendVerification(actor: UserActor): Promise<string | undefined> {
    if (actor.status !== 'pending_verification') throw new AuthError('not_allowed', 403)
    const account = await this.requireAccount(actor.userId)
    const token = await this.issueToken(account, 'verify_email', DAY)
    return token
  }

  async requestPasswordReset(emailValue: unknown): Promise<string | undefined> {
    let email: string
    try {
      email = normalizeEmail(emailValue)
    } catch {
      await verifyPassword(undefined, createOpaqueToken(12))
      return undefined
    }
    const account = await this.repository.findAccountByEmail(email)
    if (!account || ['deleted'].includes(account.status)) {
      await verifyPassword(undefined, createOpaqueToken(12))
      return undefined
    }
    return this.issueToken(account, 'reset_password', 30 * 60_000)
  }

  async resetPassword(token: unknown, passwordValue: unknown): Promise<boolean> {
    if (typeof token !== 'string' || token.length > 200) return false
    assertPassword(passwordValue)
    const digest = await hashPassword(passwordValue)
    const userId = await this.repository.resetPasswordWithToken(
      tokenHash(token),
      digest,
      PASSWORD_HASH_VERSION,
      new Date(),
    )
    if (!userId) return false
    const sessions = await this.repository.listSessions(userId)
    this.connections.closeSessions(sessions, 'Credentials changed')
    return true
  }

  async profile(actor: UserActor): Promise<AuthAccount> {
    return this.requireAccount(actor.userId)
  }

  async updateProfile(actor: UserActor, displayNameValue: unknown): Promise<AuthAccount> {
    return this.repository.updateProfile(actor.userId, normalizeDisplayName(displayNameValue))
  }

  listSessions(actor: UserActor) {
    return this.repository.listSessions(actor.userId)
  }

  async revokeSession(actor: UserActor, sessionId: string): Promise<boolean> {
    const revoked = await this.repository.revokeSession(sessionId, actor.userId, new Date())
    if (revoked) this.connections.closeSession(sessionId)
    return revoked
  }

  async changePassword(actor: UserActor, current: unknown, next: unknown): Promise<void> {
    if (typeof current !== 'string') throw new AuthError('invalid_credentials', 401)
    assertPassword(next)
    const account = await this.requireAccount(actor.userId)
    if (!(await verifyPassword(account.passwordHash, current))) {
      throw new AuthError('invalid_credentials', 401)
    }
    const digest = await hashPassword(next)
    await this.repository.changePassword(
      actor.userId,
      actor.sessionId,
      digest,
      PASSWORD_HASH_VERSION,
      new Date(),
    )
    const sessions = await this.repository.listSessions(actor.userId)
    for (const session of sessions) {
      if (session.id !== actor.sessionId)
        this.connections.closeSession(session.id, 'Credentials changed')
    }
  }

  async beginDeletion(actor: UserActor, currentPassword: unknown): Promise<string> {
    if (typeof currentPassword !== 'string') throw new AuthError('invalid_credentials', 401)
    const account = await this.requireAccount(actor.userId)
    if (!(await verifyPassword(account.passwordHash, currentPassword))) {
      throw new AuthError('invalid_credentials', 401)
    }
    const token = await this.issueToken(account, 'recover_deletion', 30 * DAY)
    const sessions = await this.repository.listSessions(actor.userId)
    await this.repository.beginDeletion(actor.userId, new Date(), new Date(Date.now() + 30 * DAY))
    this.connections.closeSessions(sessions, 'Account pending deletion')
    if (this.accountDeletionHandler) {
      try {
        await this.accountDeletionHandler(actor.userId)
      } catch {
        await this.record({
          userId: actor.userId,
          type: 'account_deletion_activity_cleanup',
          result: 'retry_required',
        })
      }
    }
    return token
  }

  async recoverDeletion(tokenValue: unknown): Promise<boolean> {
    if (typeof tokenValue !== 'string' || tokenValue.length > 200) return false
    return Boolean(await this.repository.recoverDeletion(tokenHash(tokenValue), new Date()))
  }

  private async createSession(
    account: AuthAccount,
    deviceLabel: string | undefined,
    ipKey: string,
  ): Promise<SessionCredentials> {
    const sessionToken = createOpaqueToken()
    const csrfToken = createOpaqueToken()
    const now = Date.now()
    const session = await this.repository.createSession({
      userId: account.id,
      tokenHash: tokenHash(sessionToken),
      csrfSecretHash: tokenHash(csrfToken),
      authEpoch: account.authEpoch,
      idleExpiresAt: new Date(now + 7 * DAY),
      absoluteExpiresAt: new Date(now + 30 * DAY),
      deviceLabel: deviceLabel?.slice(0, 100),
      ipPrefix: ipKey,
    })
    return { sessionToken, csrfToken, session }
  }

  private async issueToken(
    account: AuthAccount,
    purpose: AuthTokenPurpose,
    lifetimeMs: number,
  ): Promise<string> {
    const token = createOpaqueToken()
    const expiresAt = new Date(Date.now() + lifetimeMs)
    await this.repository.replaceAccountToken(account.id, purpose, tokenHash(token), expiresAt)
    await this.delivery.deliver({ purpose, email: account.emailNormalized, token, expiresAt })
    return token
  }

  private async requireAccount(userId: string): Promise<AuthAccount> {
    const account = await this.repository.findAccountById(userId)
    if (!account) throw new AuthError('not_found', 404)
    return account
  }

  private async record(
    input: Parameters<MySqlAuthRepository['recordSecurityEvent']>[0],
  ): Promise<void> {
    await this.repository.recordSecurityEvent(input).catch(() => undefined)
  }
}
