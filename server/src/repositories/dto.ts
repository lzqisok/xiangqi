import type { AccountEntity, MatchEntity, MatchStateEntity } from './contracts.js'

export type AccountDto = {
  id: string
  status: AccountEntity['status']
  displayName: string
  locale: string
}

export function toAccountDto(account: AccountEntity): AccountDto {
  return {
    id: account.id,
    status: account.status,
    displayName: account.displayName,
    locale: account.locale,
  }
}

export type PublicMatchDto = {
  id: string
  variant: MatchEntity['variant']
  gomokuRule?: 'freestyle' | 'renju'
  phase: MatchEntity['phase']
  status: MatchEntity['status']
  revision: number
  publicState: unknown
  updatedAt: string
}

/** Referee state is deliberately absent from the ordinary HTTP/WS DTO. */
export function toPublicMatchDto(match: MatchEntity, state: MatchStateEntity): PublicMatchDto {
  if (match.id !== state.matchId || match.revision !== state.revision) {
    throw new Error('Match and public state revisions do not match')
  }
  return {
    id: match.id,
    variant: match.variant,
    ...(match.gomokuRule ? { gomokuRule: match.gomokuRule } : {}),
    phase: match.phase,
    status: match.status,
    revision: match.revision,
    publicState: structuredClone(state.publicState),
    updatedAt: match.updatedAt.toISOString(),
  }
}
