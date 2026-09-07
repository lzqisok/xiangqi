import { accountRequest } from '../auth/api'
import type {
  OnlineLobbyMatch,
  OnlineMatchSnapshot,
  OnlineMatchSummary,
  OnlineRating,
  OnlineVariant,
} from './types'

export type MatchSetup = {
  variant: OnlineVariant
  gomokuRule?: 'freestyle' | 'renju'
  clockPreset?: 'none' | '10m' | '15m-10s' | '30m'
  competitionMode?: 'casual' | 'rated'
}

export function listOnlineLobby(variant?: OnlineVariant) {
  const query = variant ? `?variant=${variant}` : ''
  return accountRequest<{ matches: OnlineLobbyMatch[] }>(`/api/online/lobby${query}`).then(
    (result) => result.matches,
  )
}

export function getPublicOnlineReplay(matchId: string) {
  return accountRequest<{ match: OnlineMatchSnapshot }>(
    `/api/online/public/matches/${encodeURIComponent(matchId)}`,
  )
}

export function getMyOnlineMatch(matchId: string) {
  return accountRequest<{ match: OnlineMatchSnapshot }>(
    `/api/online/matches/${encodeURIComponent(matchId)}`,
  )
}

export function listMyMatches(variant?: OnlineVariant) {
  const query = variant ? `?variant=${variant}` : ''
  return accountRequest<{ matches: OnlineMatchSummary[]; nextCursor?: string }>(
    `/api/me/matches${query}`,
  )
}

export function listMyRatings() {
  return accountRequest<{ ratings: OnlineRating[] }>('/api/me/ratings').then(
    (result) => result.ratings,
  )
}

export function createOnlineMatch(
  input: MatchSetup & {
    name: string
    visibility: 'public' | 'invite' | 'private'
    side: 'red' | 'black'
  },
) {
  return accountRequest<{ match: OnlineMatchSnapshot }>('/api/online/matches', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function quickMatchOnline(input: MatchSetup, requestKey: string) {
  return accountRequest<{ match: OnlineMatchSnapshot; created: boolean }>(
    '/api/online/quick-match',
    {
      method: 'POST',
      body: JSON.stringify({
        ...input,
        competitionMode: input.competitionMode ?? 'casual',
        requestKey,
      }),
    },
  )
}

export function cancelOnlineMatchmaking() {
  return accountRequest<{ cancelled: boolean; matchId?: string }>('/api/online/quick-match', {
    method: 'DELETE',
  })
}

export function joinOnlineMatch(matchId: string, side?: 'red' | 'black') {
  return accountRequest<{ match: OnlineMatchSnapshot }>(`/api/online/matches/${matchId}/join`, {
    method: 'POST',
    body: JSON.stringify({ side }),
  })
}

export function createOnlineInvite(matchId: string, side?: 'red' | 'black') {
  return accountRequest<{ token: string; expiresAt: string }>(
    `/api/online/matches/${matchId}/invites`,
    { method: 'POST', body: JSON.stringify({ side }) },
  )
}

export function previewOnlineInvite(token: string) {
  return accountRequest<{ match: OnlineMatchSummary; allowedSide: 'red' | 'black' | null }>(
    `/api/online/invites/${token}`,
  )
}

export function joinOnlineInvite(token: string, side?: 'red' | 'black') {
  return accountRequest<{ match: OnlineMatchSnapshot }>(`/api/online/invites/${token}/join`, {
    method: 'POST',
    body: JSON.stringify({ side }),
  })
}

export function createOnlineRematch(matchId: string) {
  return accountRequest<{ match: OnlineMatchSnapshot }>(`/api/online/matches/${matchId}/rematch`, {
    method: 'POST',
  })
}
