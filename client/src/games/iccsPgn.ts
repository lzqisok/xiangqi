import { INITIAL_FEN, parseFen } from '../engine/board'
import { moveToUci } from '../engine/notation'
import { buildMoveRecordsFromUci } from '../share/replayLink'
import type { GameDocument, GameStatus, PersistedGameState } from '../types'
import { createVariationTree } from '../variations/tree'

const MAX_PGN_LENGTH = 1_000_000
const RESULT_TOKENS = new Set(['1-0', '0-1', '1/2-1/2', '*'])
const ICCS_MOVE = /^[a-i][0-9]-[a-i][0-9]$/i

export interface ImportedIccsPgn {
  name: string
  state: PersistedGameState
}

function escapeTag(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function unescapeTag(value: string): string {
  return value.replace(/\\([\\"])/g, '$1')
}

function resultForStatus(status: GameStatus): string {
  if (status === 'red-wins') return '1-0'
  if (status === 'black-wins') return '0-1'
  if (status === 'draw') return '1/2-1/2'
  return '*'
}

function statusForResult(result: string): GameStatus {
  if (result === '1-0') return 'red-wins'
  if (result === '0-1') return 'black-wins'
  if (result === '1/2-1/2') return 'draw'
  return 'playing'
}

function uciToIccs(uci: string): string {
  return `${uci.slice(0, 2)}-${uci.slice(2, 4)}`.toUpperCase()
}

function iccsToUci(iccs: string): string {
  return iccs.replace('-', '').toLowerCase()
}

/** XQBase Chinese-chess PGN using the explicit, coordinate-only ICCS move format. */
export function exportIccsPgn(game: GameDocument): string {
  if (game.mode === 'jieqi') throw new Error('揭棋不能导出为普通 ICCS PGN')
  const result = resultForStatus(game.state.gameStatus)
  const tags = [
    '[Game "Chinese Chess"]',
    `[Event "${escapeTag(game.name)}"]`,
    `[Result "${result}"]`,
    `[FEN "${escapeTag(game.state.initialFen)}"]`,
    '[Format "ICCS"]',
  ]
  const [, side, , , , rawFullmove] = game.state.initialFen.trim().split(/\s+/)
  let turn = side === 'b' ? 'black' : 'red'
  let fullmove = /^\d+$/.test(rawFullmove || '') ? Math.max(1, Number(rawFullmove)) : 1
  const tokens: string[] = []

  for (const record of game.state.historyRecords) {
    const move = uciToIccs(moveToUci(record.move.from, record.move.to))
    if (turn === 'red') {
      tokens.push(`${fullmove}.`, move)
      turn = 'black'
    } else {
      if (tokens.length === 0 || /\.$/.test(tokens[tokens.length - 1])) {
        tokens.push(`${fullmove}.`, '...')
      }
      tokens.push(move)
      turn = 'red'
      fullmove++
    }
  }
  tokens.push(result)
  return `${tags.join('\n')}\n\n${tokens.join(' ')}\n`
}

/** Imports one linear ICCS PGN game and semantically replays every move. */
export function importIccsPgn(raw: string): ImportedIccsPgn {
  if (!raw || raw.length > MAX_PGN_LENGTH) throw new Error('ICCS PGN 文件为空或过大')
  if (/[()]/.test(raw.replace(/\{[^}]*\}/gs, ''))) {
    throw new Error('首版 ICCS PGN 暂不支持变例分支')
  }
  const tags = new Map<string, string>()
  const movetextLines: string[] = []
  let movetextStarted = false
  for (const line of raw.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const trimmed = line.trim()
    const tag = /^\[([A-Za-z][A-Za-z0-9_]*)\s+"((?:\\.|[^"\\])*)"\]$/.exec(trimmed)
    if (tag) {
      if (movetextStarted) throw new Error('ICCS PGN 标签必须位于棋谱正文之前')
      if (tags.has(tag[1])) throw new Error(`ICCS PGN 标签重复：${tag[1]}`)
      tags.set(tag[1], unescapeTag(tag[2]))
      continue
    }
    if (trimmed) movetextStarted = true
    movetextLines.push(line)
  }
  if (tags.get('Game') !== 'Chinese Chess') throw new Error('不是 Chinese Chess PGN')
  if (tags.get('Format') !== 'ICCS') throw new Error('首版仅支持 Format 为 ICCS 的 PGN')

  const initialFen = tags.get('FEN') || INITIAL_FEN
  parseFen(initialFen)
  const withoutComments = movetextLines
    .join('\n')
    .replace(/\{[^}]*\}/gs, ' ')
    .replace(/;[^\n]*/g, ' ')
  if (/[{}\[\]]/.test(withoutComments)) throw new Error('ICCS PGN 注释或标签未闭合')
  const uciMoves: string[] = []
  let result = ''
  for (const token of withoutComments.split(/\s+/).filter(Boolean)) {
    if (/^\d+\.$/.test(token) || token === '...') continue
    if (RESULT_TOKENS.has(token)) {
      if (result) throw new Error('ICCS PGN 包含多个结果')
      result = token
      continue
    }
    if (result) throw new Error('ICCS PGN 结果之后不能继续走棋')
    if (!ICCS_MOVE.test(token)) throw new Error(`无法识别 ICCS 着法：${token}`)
    uciMoves.push(iccsToUci(token))
  }
  if (!result) throw new Error('ICCS PGN 缺少终局结果')
  const tagResult = tags.get('Result')
  if (tagResult && tagResult !== result) throw new Error('ICCS PGN 标签与正文结果不一致')

  const historyRecords = buildMoveRecordsFromUci(initialFen, uciMoves)
  const gameStatus = statusForResult(result)
  return {
    name: tags.get('Event')?.trim().slice(0, 100) || '导入的 ICCS 棋谱',
    state: {
      initialFen,
      historyRecords,
      currentMoveIndex: historyRecords.length - 1,
      variationTree: createVariationTree(initialFen, historyRecords),
      gameStatus,
    },
  }
}
