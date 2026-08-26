import { randomUUID } from 'node:crypto'
import type { MatchEntity, MatchVariant } from '../repositories/contracts.js'
import { RepositoryNotFoundError, RepositoryRevisionConflictError } from '../db/errors.js'
import { executeRoomMoveFromState, projectBoard, rebuildRoomBoard } from '../rooms/core.js'
import { executeGomokuMove, rebuildGomokuRoom } from '../rooms/gomokuCore.js'
import { buildJieqiRoomProjection } from '../rooms/jieqiRecord.js'
import type { RoomColor, RoomStatusReason, StoredRoom } from '../rooms/types.js'
import {
  ActiveMatchQuotaError,
  MySqlOnlineMatchRepository,
  onlineMatchSummary,
  type OnlineCommandCommit,
} from './repository.js'
import type {
  OnlineActor,
  OnlineChatMessage,
  OnlineHistoryPage,
  OnlineLobbyMatch,
  OnlineMatchRecord,
  OnlineMatchSnapshot,
} from './types.js'
import {
  chatRateRules,
  MySqlRateLimitStore,
  RateLimitExceededError,
} from '../platform/rateLimit.js'
import { metrics } from '../platform/observability.js'
import type { MySqlUserDocumentRepository } from '../repositories/userDocuments.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class OnlineMatchError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
    message = code,
    readonly retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'OnlineMatchError'
  }
}

function variant(value: unknown): MatchVariant {
  if (value !== 'xiangqi' && value !== 'jieqi' && value !== 'gomoku') {
    throw new OnlineMatchError('invalid_variant', 400, '玩法无效')
  }
  return value
}

function gomokuRule(value: unknown, selectedVariant: MatchVariant) {
  if (selectedVariant !== 'gomoku') return undefined
  if (value !== 'freestyle' && value !== 'renju') {
    throw new OnlineMatchError('invalid_gomoku_rule', 400, '五子棋规则无效')
  }
  return value
}

function side(value: unknown, fallback?: RoomColor): RoomColor {
  if (value === undefined && fallback) return fallback
  if (value !== 'red' && value !== 'black')
    throw new OnlineMatchError('invalid_side', 400, '席位无效')
  return value
}

function commandId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new OnlineMatchError('invalid_command_id', 400, '命令 ID 无效')
  }
  return value
}

function expectedRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new OnlineMatchError('invalid_revision', 400, 'expected revision 无效')
  }
  return Number(value)
}

function currentRevision(record: OnlineMatchRecord, value: unknown): number {
  const expected = expectedRevision(value)
  if (record.match.revision !== expected) {
    throw new OnlineMatchError('revision_conflict', 409, String(record.match.revision))
  }
  return expected
}

function requirePlay(actor: OnlineActor): void {
  if (!actor.capabilities.includes('online:play')) {
    throw new OnlineMatchError('online_play_not_allowed', 403, '账号未验证或当前不可参与公网对局')
  }
}

function requireWatch(actor: OnlineActor): void {
  if (!actor.capabilities.includes('online:watch')) {
    throw new OnlineMatchError('online_watch_not_allowed', 403, '当前账号不可实时查看公网对局')
  }
}

function requireParticipant(record: OnlineMatchRecord, userId: string) {
  const participant = record.participants.find((item) => item.userId === userId)
  if (!participant) throw new OnlineMatchError('not_found', 404, '对局不存在')
  return participant
}

function requirePlayer(record: OnlineMatchRecord, userId: string) {
  const participant = requireParticipant(record, userId)
  if (!participant.side) throw new OnlineMatchError('player_required', 403, '当前账号不是本局棋手')
  return participant as typeof participant & { side: RoomColor }
}

function commandBase(
  record: OnlineMatchRecord,
): Pick<
  OnlineCommandCommit,
  'state' | 'phase' | 'status' | 'statusReason' | 'startedAt' | 'finishedAt'
> {
  return {
    state: record.state,
    phase: record.match.phase,
    status: record.match.status,
    ...(record.match.statusReason
      ? { statusReason: record.match.statusReason as RoomStatusReason }
      : {}),
    ...(record.match.startedAt ? { startedAt: record.match.startedAt } : {}),
    ...(record.match.finishedAt ? { finishedAt: record.match.finishedAt } : {}),
  }
}

function normalizeChat(value: unknown): string {
  const content = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
  if (!content) throw new OnlineMatchError('chat_empty', 400, '消息不能为空')
  if (Array.from(content).length > 200 || content.split('\n').length > 4) {
    throw new OnlineMatchError('chat_too_long', 400, '消息最多 200 字且不超过四行')
  }
  return content
}

type Rate = { startedAt: number; count: number }

export class OnlineMatchService {
  private readonly chatRates = new Map<string, Rate>()

  constructor(
    readonly repository: MySqlOnlineMatchRepository,
    private readonly options: {
      rateLimitStore?: MySqlRateLimitStore
      maxActiveMatchesPerUser?: number
      jieqiSeatRecords?: MySqlUserDocumentRepository<Record<string, unknown>>
    } = {},
  ) {}

  async create(actor: OnlineActor, input: Record<string, unknown>): Promise<OnlineMatchRecord> {
    requirePlay(actor)
    const selectedVariant = variant(input.variant)
    const visibility =
      input.visibility === 'private'
        ? 'private'
        : input.visibility === 'public'
          ? 'public'
          : 'invite'
    return this.repository.create({
      userId: actor.userId,
      name: String(input.name ?? ''),
      variant: selectedVariant,
      gomokuRule: gomokuRule(input.gomokuRule, selectedVariant),
      visibility,
      side: side(input.side, 'red'),
      competitionMode: 'casual',
      clockPreset:
        input.clockPreset === '10m' ||
        input.clockPreset === '15m-10s' ||
        input.clockPreset === '30m'
          ? input.clockPreset
          : 'none',
      maxActiveMatches: this.options.maxActiveMatchesPerUser,
    })
  }

  async quickMatch(actor: OnlineActor, input: Record<string, unknown>) {
    requirePlay(actor)
    const selectedVariant = variant(input.variant)
    if (input.competitionMode === 'rated') {
      throw new OnlineMatchError('rated_not_available', 400, '排位匹配将在棋钟与等级分批次开放')
    }
    const result = await this.repository.quickMatch({
      userId: actor.userId,
      variant: selectedVariant,
      gomokuRule: gomokuRule(input.gomokuRule, selectedVariant),
      competitionMode: 'casual',
      clockPreset:
        input.clockPreset === '10m' ||
        input.clockPreset === '15m-10s' ||
        input.clockPreset === '30m'
          ? input.clockPreset
          : 'none',
      requestKey: commandId(input.requestKey),
      maxActiveMatches: this.options.maxActiveMatchesPerUser,
    })
    metrics.increment('xiangqi_matchmaking_requests', {
      result: result.record.match.phase === 'playing' ? 'matched' : 'waiting',
      variant: selectedVariant,
    })
    if (result.record.match.startedAt) {
      metrics.observe(
        'xiangqi_matchmaking_wait',
        result.record.match.startedAt.getTime() - result.record.match.createdAt.getTime(),
        { variant: selectedVariant },
      )
    }
    return result
  }

  cancelMatchmaking(actor: OnlineActor) {
    requirePlay(actor)
    return this.repository.cancelMatchmaking(actor.userId)
  }

  async createInvite(actor: OnlineActor, matchId: string, allowedSide?: unknown) {
    requirePlay(actor)
    return this.repository.createInvite(
      actor.userId,
      matchId,
      allowedSide === undefined ? undefined : side(allowedSide),
    )
  }

  previewInvite(token: string) {
    if (!UUID.test(token)) throw new OnlineMatchError('not_found', 404, '邀请不存在')
    return this.repository.previewInvite(token)
  }

  async joinInvite(actor: OnlineActor, token: string, requestedSide?: unknown) {
    requirePlay(actor)
    if (!UUID.test(token)) throw new OnlineMatchError('not_found', 404, '邀请不存在')
    return this.repository.joinInvite(
      actor.userId,
      token,
      requestedSide === undefined ? undefined : side(requestedSide),
      this.options.maxActiveMatchesPerUser,
    )
  }

  joinPublic(actor: OnlineActor, matchId: string, requestedSide?: unknown) {
    requirePlay(actor)
    return this.repository.joinPublic(
      actor.userId,
      matchId,
      requestedSide === undefined ? undefined : side(requestedSide),
      this.options.maxActiveMatchesPerUser,
    )
  }

  async get(actor: OnlineActor, matchId: string): Promise<OnlineMatchRecord> {
    requireWatch(actor)
    const record = await this.repository.findAccessible(matchId, actor.userId)
    if (!record) throw new OnlineMatchError('not_found', 404, '对局不存在')
    return record
  }

  lobby(
    actor: OnlineActor,
    input: { variant?: unknown; limit?: unknown },
  ): Promise<OnlineLobbyMatch[]> {
    requireWatch(actor)
    return this.repository.listLobby({
      ...(input.variant ? { variant: variant(input.variant) } : {}),
      limit: Number(input.limit) || 20,
    })
  }

  history(actor: OnlineActor, input: Record<string, unknown>): Promise<OnlineHistoryPage> {
    requireWatch(actor)
    const parseDate = (value: unknown, code: string): Date | undefined => {
      if (value === undefined || value === '') return undefined
      if (typeof value !== 'string') throw new OnlineMatchError(code)
      const result = new Date(value)
      if (!Number.isFinite(result.getTime())) throw new OnlineMatchError(code)
      return result
    }
    let before: Date | undefined
    if (typeof input.cursor === 'string') {
      before = new Date(input.cursor)
      if (!Number.isFinite(before.getTime())) throw new OnlineMatchError('invalid_cursor')
    }
    const status =
      input.status === 'playing' ||
      input.status === 'red-wins' ||
      input.status === 'black-wins' ||
      input.status === 'draw'
        ? input.status
        : undefined
    const from = parseDate(input.from, 'invalid_from')
    const to = parseDate(input.to, 'invalid_to')
    if (from && to && from > to) throw new OnlineMatchError('invalid_time_range')
    return this.repository.listHistory({
      userId: actor.userId,
      ...(input.variant ? { variant: variant(input.variant) } : {}),
      ...(status ? { status } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(before ? { before } : {}),
      limit: Number(input.limit) || 20,
    })
  }

  async rematch(actor: OnlineActor, matchId: string): Promise<OnlineMatchRecord> {
    requirePlay(actor)
    const previous = await this.get(actor, matchId)
    const player = requirePlayer(previous, actor.userId)
    if (previous.match.phase !== 'finished') throw new OnlineMatchError('match_not_finished')
    return this.repository.create({
      userId: actor.userId,
      name: `再来一局 · ${previous.state.name}`.slice(0, 40),
      variant: previous.match.variant,
      ...(previous.match.gomokuRule ? { gomokuRule: previous.match.gomokuRule } : {}),
      visibility: previous.match.visibility,
      side: player.side,
      previousMatchId: previous.match.id,
      competitionMode: previous.match.competitionMode,
      clockPreset: previous.match.clockPreset,
      maxActiveMatches: this.options.maxActiveMatchesPerUser,
    })
  }

  async ready(actor: OnlineActor, input: Record<string, unknown>) {
    requirePlay(actor)
    const matchId = String(input.matchId || '')
    const id = commandId(input.commandId)
    const duplicate = await this.repository.findCommand(matchId, actor.userId, id)
    if (duplicate) return { record: duplicate, duplicate: true }
    const record = await this.get(actor, matchId)
    const revision = currentRevision(record, input.expectedRevision)
    const player = requirePlayer(record, actor.userId)
    if (record.match.phase !== 'waiting') throw new OnlineMatchError('match_not_waiting')
    const ready = input.ready !== false
    const otherReady = record.participants.some(
      (item) => item.userId !== actor.userId && item.side && item.ready,
    )
    const start = ready && otherReady
    return this.repository.commitCommand({
      userId: actor.userId,
      matchId,
      commandId: id,
      commandType: 'ready',
      expectedRevision: revision,
      expectedSide: player.side,
      commit: {
        ...commandBase(record),
        participantReady: ready,
        ...(start ? { phase: 'playing', startedAt: new Date() } : {}),
      },
    })
  }

  async move(actor: OnlineActor, input: Record<string, unknown>) {
    requirePlay(actor)
    const matchId = String(input.matchId || '')
    const id = commandId(input.commandId)
    const duplicate = await this.repository.findCommand(matchId, actor.userId, id)
    if (duplicate) return { record: duplicate, duplicate: true }
    const record = await this.get(actor, matchId)
    const revision = currentRevision(record, input.expectedRevision)
    const player = requirePlayer(record, actor.userId)
    if (record.match.phase !== 'playing' || record.match.status !== 'playing') {
      throw new OnlineMatchError('match_not_playing')
    }
    const result =
      record.match.variant === 'gomoku'
        ? executeGomokuMove(
            rebuildGomokuRoom(record.state.moves),
            record.state.moves,
            Number(input.row),
            Number(input.col),
            player.side,
            record.match.gomokuRule || 'freestyle',
          )
        : executeRoomMoveFromState(
            record.match.variant,
            rebuildRoomBoard(record.match.variant, record.state.initialLayout, record.state.moves),
            record.state.moves,
            String(input.uci || ''),
            player.side,
          )
    const finished = result.detail.status !== 'playing'
    return this.repository.commitCommand({
      userId: actor.userId,
      matchId,
      commandId: id,
      commandType: 'move',
      expectedRevision: revision,
      expectedSide: player.side,
      commit: {
        ...commandBase(record),
        state: { ...record.state, moves: [...record.state.moves, result.move] },
        status: result.detail.status,
        ...(result.detail.reason ? { statusReason: result.detail.reason } : {}),
        ...(finished ? { phase: 'finished', finishedAt: new Date() } : {}),
      },
    })
  }

  async resign(actor: OnlineActor, input: Record<string, unknown>) {
    requirePlay(actor)
    const matchId = String(input.matchId || '')
    const id = commandId(input.commandId)
    const duplicate = await this.repository.findCommand(matchId, actor.userId, id)
    if (duplicate) return { record: duplicate, duplicate: true }
    const record = await this.get(actor, matchId)
    const revision = currentRevision(record, input.expectedRevision)
    const player = requirePlayer(record, actor.userId)
    if (record.match.phase !== 'playing') throw new OnlineMatchError('match_not_playing')
    return this.repository.commitCommand({
      userId: actor.userId,
      matchId,
      commandId: id,
      commandType: 'resign',
      expectedRevision: revision,
      expectedSide: player.side,
      commit: {
        ...commandBase(record),
        phase: 'finished',
        status: player.side === 'red' ? 'black-wins' : 'red-wins',
        statusReason: 'resignation',
        finishedAt: new Date(),
      },
    })
  }

  async propose(actor: OnlineActor, input: Record<string, unknown>) {
    requirePlay(actor)
    const matchId = String(input.matchId || '')
    const id = commandId(input.commandId)
    const duplicate = await this.repository.findCommand(matchId, actor.userId, id)
    if (duplicate) return { record: duplicate, duplicate: true }
    const record = await this.get(actor, matchId)
    const revision = currentRevision(record, input.expectedRevision)
    const player = requirePlayer(record, actor.userId)
    const kind = input.kind
    if (kind !== 'undo' && kind !== 'draw' && kind !== 'swap')
      throw new OnlineMatchError('invalid_proposal')
    if (record.proposal) throw new OnlineMatchError('proposal_pending', 409, '已有待处理协商')
    if (kind === 'swap' ? record.match.phase !== 'waiting' : record.match.phase !== 'playing') {
      throw new OnlineMatchError('proposal_not_allowed')
    }
    if (kind === 'undo' && !record.state.moves.length) throw new OnlineMatchError('nothing_to_undo')
    return this.repository.commitCommand({
      userId: actor.userId,
      matchId,
      commandId: id,
      commandType: `proposal:${kind}`,
      expectedRevision: revision,
      expectedSide: player.side,
      commit: {
        ...commandBase(record),
        proposal: { action: 'create', kind, deadline: new Date(Date.now() + 30_000) },
      },
    })
  }

  async respondProposal(actor: OnlineActor, input: Record<string, unknown>) {
    requirePlay(actor)
    const matchId = String(input.matchId || '')
    const id = commandId(input.commandId)
    const duplicate = await this.repository.findCommand(matchId, actor.userId, id)
    if (duplicate) return { record: duplicate, duplicate: true }
    const record = await this.get(actor, matchId)
    const revision = currentRevision(record, input.expectedRevision)
    const player = requirePlayer(record, actor.userId)
    const active = record.proposal
    if (!active || active.id !== input.proposalId)
      throw new OnlineMatchError('proposal_not_found', 404)
    if (active.proposedByUserId === actor.userId)
      throw new OnlineMatchError('proposal_self_response')
    const accept = input.accept === true
    const commit: OnlineCommandCommit = {
      ...commandBase(record),
      proposal: { action: 'resolve', id: active.id, status: accept ? 'accepted' : 'rejected' },
    }
    if (accept && active.kind === 'undo') {
      commit.state = { ...record.state, moves: record.state.moves.slice(0, -1) }
      commit.phase = 'playing'
      commit.status = 'playing'
      delete commit.statusReason
      delete commit.finishedAt
    } else if (accept && active.kind === 'draw') {
      commit.phase = 'finished'
      commit.status = 'draw'
      commit.statusReason = 'agreement'
      commit.finishedAt = new Date()
    } else if (accept && active.kind === 'swap') {
      commit.swapSides = true
    }
    return this.repository.commitCommand({
      userId: actor.userId,
      matchId,
      commandId: id,
      commandType: `proposal-response:${active.kind}`,
      expectedRevision: revision,
      expectedSide: player.side,
      commit,
    })
  }

  async withdrawProposal(actor: OnlineActor, input: Record<string, unknown>) {
    requirePlay(actor)
    const matchId = String(input.matchId || '')
    const id = commandId(input.commandId)
    const duplicate = await this.repository.findCommand(matchId, actor.userId, id)
    if (duplicate) return { record: duplicate, duplicate: true }
    const record = await this.get(actor, matchId)
    const revision = currentRevision(record, input.expectedRevision)
    const player = requirePlayer(record, actor.userId)
    if (
      !record.proposal ||
      record.proposal.id !== input.proposalId ||
      record.proposal.proposedByUserId !== actor.userId
    ) {
      throw new OnlineMatchError('proposal_not_found', 404)
    }
    return this.repository.commitCommand({
      userId: actor.userId,
      matchId,
      commandId: id,
      commandType: 'proposal-withdraw',
      expectedRevision: revision,
      expectedSide: player.side,
      commit: {
        ...commandBase(record),
        proposal: { action: 'resolve', id: record.proposal.id, status: 'withdrawn' },
      },
    })
  }

  async chat(
    actor: OnlineActor,
    matchId: string,
    commandIdValue: unknown,
    contentValue: unknown,
  ): Promise<OnlineChatMessage> {
    requireWatch(actor)
    this.consumeChatRate(actor, matchId)
    if (this.options.rateLimitStore) {
      try {
        await this.options.rateLimitStore.consume(
          chatRateRules({ ip: actor.ipKey, userId: actor.userId, matchId }),
        )
      } catch (error) {
        if (error instanceof RateLimitExceededError) {
          throw new OnlineMatchError(
            'chat_rate_limited',
            429,
            '发送过于频繁，请稍后再试',
            error.retryAfterSeconds,
          )
        }
        throw error
      }
    }
    return this.repository.appendChat({
      matchId,
      userId: actor.userId,
      commandId: commandId(commandIdValue),
      content: normalizeChat(contentValue),
    })
  }

  chatHistory(actor: OnlineActor, matchId: string) {
    requireWatch(actor)
    return this.repository.listChat(matchId, actor.userId)
  }

  deleteChat(actor: OnlineActor, matchId: string, messageId: string) {
    requireWatch(actor)
    return this.repository.deleteChat(matchId, actor.userId, messageId)
  }

  setMute(actor: OnlineActor, matchId: string, targetUserId: string, muted: boolean) {
    requirePlay(actor)
    return this.repository.setMute(matchId, actor.userId, targetUserId, muted)
  }

  snapshot(
    record: OnlineMatchRecord,
    userId: string,
    onlineUsers: ReadonlySet<string>,
  ): OnlineMatchSnapshot {
    const viewer = record.participants.find((item) => item.userId === userId)
    const role = viewer?.side ?? (viewer?.isOwner ? 'owner' : 'spectator')
    const audience = viewer?.side ?? 'public'
    const gomoku = record.match.variant === 'gomoku'
    const gomokuState = gomoku ? rebuildGomokuRoom(record.state.moves) : null
    const xiangqiState = gomoku
      ? null
      : rebuildRoomBoard(record.match.variant, record.state.initialLayout, record.state.moves)
    let jieqiRecord: OnlineMatchSnapshot['jieqiRecord']
    if (record.match.variant === 'jieqi' && record.match.phase === 'finished') {
      try {
        const room: StoredRoom = {
          schemaVersion: 1,
          id: record.match.id,
          name: record.state.name,
          variant: 'jieqi',
          phase: 'finished',
          revision: record.match.revision,
          ownerHash: '0'.repeat(64),
          seats: Object.fromEntries(
            record.participants.flatMap((item) =>
              item.side
                ? [
                    [
                      item.side,
                      {
                        nickname: item.displayNameSnapshot,
                        credentialHash: '0'.repeat(64),
                        ready: item.ready,
                        hintsUsed: item.hintsUsed,
                      },
                    ],
                  ]
                : [],
            ),
          ),
          initialLayout: record.state.initialLayout,
          moves: record.state.moves,
          status: record.match.status,
          ...(record.match.statusReason
            ? { statusReason: record.match.statusReason as RoomStatusReason }
            : {}),
          createdAt: record.match.createdAt.getTime(),
          updatedAt: record.match.updatedAt.getTime(),
          startedAt: record.match.startedAt?.getTime(),
          finishedAt: record.match.finishedAt?.getTime(),
        }
        jieqiRecord = {
          ...buildJieqiRoomProjection(room, audience),
          recordId: `online-match:${record.match.id}:${audience}`,
        }
        if (viewer?.side && jieqiRecord.audience === viewer.side) {
          void this.options.jieqiSeatRecords
            ?.create(
              userId,
              jieqiRecord as unknown as Record<string, unknown>,
              `online-match:${record.match.id}:${viewer.side}`,
            )
            .catch(() => metrics.increment('xiangqi_jieqi_record_sync_failures'))
        }
      } catch {
        // Invalid referee data fails closed and never falls back to a broader projection.
      }
    }
    const proposer = record.proposal
      ? record.participants.find((item) => item.userId === record.proposal?.proposedByUserId)
      : undefined
    return {
      ...onlineMatchSummary(record),
      revision: record.match.revision,
      role,
      side: viewer?.side ?? null,
      isOwner: Boolean(viewer?.isOwner),
      seats: Object.fromEntries(
        record.participants.flatMap((item) =>
          item.side
            ? [
                [
                  item.side,
                  {
                    nickname: item.displayNameSnapshot,
                    ready: item.ready,
                    online: Boolean(item.userId && onlineUsers.has(item.userId)),
                    ...(item.disconnectDeadline
                      ? { disconnectDeadline: item.disconnectDeadline.toISOString() }
                      : {}),
                  },
                ],
              ]
            : [],
        ),
      ),
      board: gomokuState ? gomokuState.board : projectBoard(xiangqiState!.board),
      turn: gomokuState?.turn ?? xiangqiState!.turn,
      moves: record.state.moves.map((move) => ({
        uci: move.uci,
        color: move.color,
        row: move.row,
        col: move.col,
        notation: move.notation,
        revealed: move.revealed,
        captured: !move.capturedHidden || audience === move.color ? move.captured : null,
        capturedHidden: move.capturedHidden,
      })),
      captured: record.state.moves.flatMap((move) =>
        move.capturedColor
          ? [
              {
                color: move.capturedColor,
                type:
                  !move.capturedHidden || audience === move.color ? (move.captured ?? null) : null,
                hidden: Boolean(move.capturedHidden),
                capturedBy: move.color,
              },
            ]
          : [],
      ),
      ...(record.proposal && proposer?.side
        ? {
            proposal: {
              id: record.proposal.id,
              kind: record.proposal.kind,
              proposedBySide: proposer.side,
              deadline: record.proposal.deadline.toISOString(),
              canRespond: Boolean(viewer?.side && viewer.userId !== proposer.userId),
              canWithdraw: viewer?.userId === proposer.userId,
            },
          }
        : {}),
      ...(jieqiRecord ? { jieqiRecord } : {}),
    }
  }

  async safe<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action()
    } catch (error) {
      if (error instanceof OnlineMatchError) throw error
      if (error instanceof RepositoryNotFoundError) throw new OnlineMatchError('not_found', 404)
      if (error instanceof RepositoryRevisionConflictError) {
        throw new OnlineMatchError('revision_conflict', 409, String(error.currentRevision ?? ''))
      }
      if (error instanceof ActiveMatchQuotaError) {
        throw new OnlineMatchError(
          'active_match_quota_exceeded',
          429,
          '当前账号的活跃公网对局已达上限',
          30,
        )
      }
      throw error
    }
  }

  private consumeChatRate(actor: OnlineActor, matchId: string) {
    const now = Date.now()
    const keys = [`user:${actor.userId}`, `ip:${actor.ipKey}`, `match:${matchId}`]
    for (const key of keys) {
      const rate = this.chatRates.get(key)
      if (!rate || now - rate.startedAt >= 10_000) {
        this.chatRates.set(key, { startedAt: now, count: 1 })
      } else if (++rate.count > (key.startsWith('match:') ? 30 : 8)) {
        throw new OnlineMatchError('chat_rate_limited', 429, '发送过于频繁，请稍后再试')
      }
    }
    if (this.chatRates.size > 2_000) {
      for (const [key, rate] of this.chatRates)
        if (now - rate.startedAt >= 10_000) this.chatRates.delete(key)
    }
  }
}

export function newCommandId(): string {
  return randomUUID()
}
