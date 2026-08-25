import type { Queryable } from '../db/database.js'

export type AccountStatus =
  'pending_verification' | 'active' | 'restricted' | 'suspended' | 'pending_deletion' | 'deleted'

export type AccountEntity = {
  id: string
  status: AccountStatus
  authEpoch: number
  displayName: string
  locale: string
  createdAt: Date
  updatedAt: Date
}

export type CreateAccountInput = {
  emailNormalized: string
  emailDisplay: string
  displayName: string
  passwordHash: string
  passwordHashVersion: number
  verificationTokenHash: Buffer
  verificationExpiresAt: Date
}

export interface AccountRepository {
  create(input: CreateAccountInput): Promise<AccountEntity>
  findById(id: string): Promise<AccountEntity | null>
}

export type SessionEntity = {
  id: string
  userId: string
  tokenHash: Buffer
  authEpoch: number
  createdAt: Date
  lastSeenAt: Date
  idleExpiresAt: Date
  absoluteExpiresAt: Date
  revokedAt: Date | null
  accountStatus: AccountStatus
}

export type CreateSessionInput = {
  userId: string
  tokenHash: Buffer
  csrfSecretHash: Buffer
  authEpoch: number
  idleExpiresAt: Date
  absoluteExpiresAt: Date
  deviceLabel?: string
  lastIpPrefix?: string
}

export interface SessionRepository {
  create(input: CreateSessionInput): Promise<SessionEntity>
  findValidByTokenHash(tokenHash: Buffer, now?: Date): Promise<SessionEntity | null>
  revoke(sessionId: string, userId: string, now?: Date): Promise<boolean>
  revokeAllForUser(userId: string, exceptSessionId?: string, now?: Date): Promise<number>
}

export type MatchVariant = 'xiangqi' | 'jieqi' | 'gomoku'
export type MatchVisibility = 'public' | 'invite' | 'private'
export type MatchPhase = 'waiting' | 'playing' | 'finished'
export type MatchStatus = 'playing' | 'red-wins' | 'black-wins' | 'draw'

export type MatchEntity = {
  id: string
  variant: MatchVariant
  gomokuRule: 'freestyle' | 'renju' | null
  matchmaking: boolean
  visibility: MatchVisibility
  phase: MatchPhase
  status: MatchStatus
  statusReason: string | null
  revision: number
  createdByUserId: string | null
  createdAt: Date
  updatedAt: Date
  startedAt: Date | null
  finishedAt: Date | null
  expiresAt: Date
}

export type MatchParticipantInput = {
  userId: string
  side?: 'red' | 'black'
  isOwner: boolean
  displayNameSnapshot: string
  ready?: boolean
}

export type CreateMatchInput = {
  variant: MatchVariant
  gomokuRule?: 'freestyle' | 'renju'
  matchmaking?: boolean
  visibility: MatchVisibility
  phase: MatchPhase
  status: MatchStatus
  statusReason?: string
  createdByUserId: string
  participants: MatchParticipantInput[]
  stateSchemaVersion: number
  publicState: unknown
  refereeState: unknown
  startedAt?: Date
  finishedAt?: Date
  expiresAt: Date
}

export type MatchStateEntity = {
  matchId: string
  schemaVersion: number
  revision: number
  publicState: unknown
  refereeState: unknown
  updatedAt: Date
}

export interface MatchRepository {
  create(input: CreateMatchInput): Promise<MatchEntity>
  findById(id: string): Promise<MatchEntity | null>
  getStateForReferee(id: string): Promise<MatchStateEntity | null>
  updateState(
    id: string,
    expectedRevision: number,
    publicState: unknown,
    refereeState: unknown,
    outcome?: { status: MatchStatus; statusReason?: string; finishedAt?: Date },
  ): Promise<MatchEntity>
  deleteWaiting(id: string, expectedRevision: number): Promise<void>
}

export type UserDocumentEntity<T> = {
  id: string
  ownerUserId: string
  schemaVersion: number
  revision: number
  payload: T
  createdAt: Date
  updatedAt: Date
}

export interface UserDocumentRepository<T> {
  list(ownerUserId: string): Promise<readonly UserDocumentEntity<T>[]>
  find(ownerUserId: string, id: string): Promise<UserDocumentEntity<T> | null>
  create(ownerUserId: string, payload: T, clientMutationId?: string): Promise<UserDocumentEntity<T>>
  update(
    ownerUserId: string,
    id: string,
    expectedRevision: number,
    payload: T,
  ): Promise<UserDocumentEntity<T>>
  delete(ownerUserId: string, id: string, expectedRevision: number): Promise<void>
}

export type JsonValidator<T> = (value: unknown) => value is T

/** SQL implementations receive only a transaction-scoped client, never an unchecked pool. */
export type RepositoryTransaction = Queryable
