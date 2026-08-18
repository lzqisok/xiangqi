import { applyMove, boardToFen, parseFen } from '../engine/board'
import { moveToNotation, moveToUci, uciToMove } from '../engine/notation'
import { getLegalMoves } from '../engine/rules'
import { validateFenPosition } from '../engine/validation'
import { MoveRecord, StudyPosition } from '../types'

const PARAM_NAME = 'replay'
export const MAX_REPLAY_MOVES = 600

interface ReplayPayload {
  fen: string
  moves: string[]
  currentMoveIndex: number
}

export type ReplayLinkParseResult =
  { ok: true; study: StudyPosition } | { ok: false; error: string }

function encodeBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBase64Url(value: string): string {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  return atob(padded)
}

function isReplayPayload(value: unknown): value is ReplayPayload {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    typeof item.fen === 'string' &&
    Array.isArray(item.moves) &&
    item.moves.every((move) => typeof move === 'string') &&
    typeof item.currentMoveIndex === 'number' &&
    Number.isInteger(item.currentMoveIndex)
  )
}

export function buildMoveRecordsFromUci(initialFen: string, uciMoves: string[]): MoveRecord[] {
  const fenValidation = validateFenPosition(initialFen)
  if (!fenValidation.ok) {
    throw new Error(fenValidation.errors[0] || 'Invalid FEN')
  }

  let { board, turn } = parseFen(initialFen)
  return uciMoves.map((uci) => {
    const { from, to } = uciToMove(uci)
    const piece = board[from.row][from.col]
    if (!piece) throw new Error(`No piece at ${uci.slice(0, 2)}`)
    if (piece.color !== turn) throw new Error(`Wrong side to move for ${uci}`)
    const legalTargets = getLegalMoves(board, from)
    if (!legalTargets.some((target) => target.row === to.row && target.col === to.col)) {
      throw new Error(`Illegal move ${uci}`)
    }

    const move = {
      from,
      to,
      captured: board[to.row][to.col] || undefined,
      piece,
    }
    const notation = moveToNotation(board, move)
    const applied = applyMove(board, from, to)
    const nextTurn = turn === 'red' ? 'black' : 'red'
    const fen = boardToFen(applied.newBoard, nextTurn)

    board = applied.newBoard
    turn = nextTurn
    return { move, notation, fen }
  })
}

export function createReplayUrl(
  baseUrl: string,
  initialFen: string,
  records: MoveRecord[],
  currentMoveIndex: number,
): string {
  const url = new URL(baseUrl)
  const payload: ReplayPayload = {
    fen: initialFen,
    moves: records.map((record) => moveToUci(record.move.from, record.move.to)),
    currentMoveIndex: Math.max(-1, Math.min(currentMoveIndex, records.length - 1)),
  }
  url.searchParams.set(PARAM_NAME, encodeBase64Url(JSON.stringify(payload)))
  return url.toString()
}

export function parseReplayStudyFromSearch(
  search: string,
  now = Date.now(),
): ReplayLinkParseResult | null {
  const raw = new URLSearchParams(search).get(PARAM_NAME)
  if (!raw) return null

  try {
    const parsed = JSON.parse(decodeBase64Url(raw)) as unknown
    if (!isReplayPayload(parsed)) {
      return { ok: false, error: '回放链接格式无效。' }
    }
    if (parsed.moves.length > MAX_REPLAY_MOVES) {
      return { ok: false, error: `回放链接最多支持 ${MAX_REPLAY_MOVES} 手。` }
    }
    const records = buildMoveRecordsFromUci(parsed.fen, parsed.moves)
    const currentMoveIndex = Math.max(-1, Math.min(parsed.currentMoveIndex, records.length - 1))
    return {
      ok: true,
      study: {
        id: `shared-replay-${now}`,
        name: '分享回放',
        description: '从分享链接恢复',
        initialFen: parsed.fen,
        moves: records,
        currentMoveIndex,
        analysisPoints: [],
        createdAt: now,
        updatedAt: now,
      },
    }
  } catch {
    return { ok: false, error: '回放链接解析失败。' }
  }
}
