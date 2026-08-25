import type { AccountStatus } from '../repositories/contracts.js'

export type AnonymousActor = {
  kind: 'anonymous'
  requestId: string
  ipKey: string
}

export type UserActor = {
  kind: 'user'
  requestId: string
  ipKey: string
  userId: string
  sessionId: string
  authEpoch: number
  expiresAt: Date
  status: Extract<AccountStatus, 'pending_verification' | 'active' | 'restricted'>
  capabilities: readonly string[]
}

export type PublicActor = AnonymousActor | UserActor

export type AuthAccount = {
  id: string
  status: AccountStatus
  authEpoch: number
  displayName: string
  locale: string
  emailNormalized: string
  emailDisplay: string
  verifiedAt: Date | null
  passwordHash: string
  passwordHashVersion: number
  createdAt: Date
  updatedAt: Date
}

export type AuthSession = {
  id: string
  userId: string
  tokenHash: Buffer
  csrfSecretHash: Buffer
  authEpoch: number
  createdAt: Date
  lastSeenAt: Date
  idleExpiresAt: Date
  absoluteExpiresAt: Date
  revokedAt: Date | null
  accountStatus: AccountStatus
  displayName: string
  locale: string
  deviceLabel: string | null
}

export type SessionSummary = Pick<
  AuthSession,
  | 'id'
  | 'createdAt'
  | 'lastSeenAt'
  | 'idleExpiresAt'
  | 'absoluteExpiresAt'
  | 'revokedAt'
  | 'deviceLabel'
>

export type AuthTokenPurpose = 'verify_email' | 'reset_password' | 'recover_deletion'

export type DeliveredAccountToken = {
  purpose: AuthTokenPurpose
  email: string
  token: string
  expiresAt: Date
}

export interface AuthTokenDelivery {
  deliver(token: DeliveredAccountToken): Promise<void>
}
