import {
  createRoomInitialState,
  executeRoomMoveFromState,
  rebuildRoomBoard,
} from '../rooms/core.js'
import { executeGomokuMove, rebuildGomokuRoom } from '../rooms/gomokuCore.js'
import type { MatchVariant } from '../repositories/contracts.js'
import type { RoomMove } from '../rooms/types.js'
import type { OnlinePublicState, OnlineRefereeState } from './types.js'

const LAYOUT_INVENTORY = [...'rraabbnnccppppp'].sort().join('')

function validLayout(layout: string): boolean {
  if (!/^[rabncp]{30}$/.test(layout)) return false
  return [layout.slice(0, 15), layout.slice(15)].every(
    (side) => [...side].sort().join('') === LAYOUT_INVENTORY,
  )
}

export function normalizeOnlineMatchName(value: unknown): string {
  const name = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
  if (Array.from(name).length < 2 || Array.from(name).length > 40) {
    throw new Error('对局名称需为 2 至 40 个字符')
  }
  return name
}

export function createOnlineRefereeState(
  variant: MatchVariant,
  nameValue: unknown,
): OnlineRefereeState {
  const name = normalizeOnlineMatchName(nameValue)
  if (variant === 'jieqi') {
    const initial = createRoomInitialState('jieqi')
    if (!initial.layout) throw new Error('无法创建揭棋裁判局面')
    return { schemaVersion: 1, name, initialLayout: initial.layout, moves: [] }
  }
  return { schemaVersion: 1, name, moves: [] }
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function readOnlineRefereeState(
  value: unknown,
  variant: MatchVariant,
  gomokuRule?: 'freestyle' | 'renju' | null,
): OnlineRefereeState {
  if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.moves)) {
    throw new Error('公网对局裁判状态格式无效')
  }
  const name = normalizeOnlineMatchName(value.name)
  if (value.moves.length > (variant === 'gomoku' ? 225 : 2000)) {
    throw new Error('公网对局走法数量超出上限')
  }
  const source = value.moves as RoomMove[]
  const moves: RoomMove[] = []
  if (variant === 'gomoku') {
    if (value.initialLayout !== undefined) throw new Error('五子棋状态不得包含揭棋布局')
    let rebuilt = rebuildGomokuRoom([])
    for (const persisted of source) {
      const result = executeGomokuMove(
        rebuilt,
        moves,
        Number(persisted?.row),
        Number(persisted?.col),
        persisted?.color,
        gomokuRule || 'freestyle',
      )
      if (persisted?.uci !== result.move.uci) throw new Error('五子棋裁判走法不一致')
      moves.push(result.move)
      rebuilt = { board: result.board, turn: result.turn }
    }
    return { schemaVersion: 1, name, moves }
  }
  const layout = value.initialLayout
  if (variant === 'jieqi') {
    if (typeof layout !== 'string' || !validLayout(layout)) throw new Error('揭棋裁判布局无效')
  } else if (layout !== undefined) {
    throw new Error('普通象棋状态不得包含揭棋布局')
  }
  let rebuilt = rebuildRoomBoard(variant, typeof layout === 'string' ? layout : undefined, [])
  for (const persisted of source) {
    if (!object(persisted) || typeof persisted.uci !== 'string') {
      throw new Error('公网对局走法格式无效')
    }
    const result = executeRoomMoveFromState(variant, rebuilt, moves, persisted.uci, persisted.color)
    moves.push(result.move)
    rebuilt = { board: result.board, turn: result.turn }
  }
  return {
    schemaVersion: 1,
    name,
    ...(variant === 'jieqi' ? { initialLayout: layout as string } : {}),
    moves,
  }
}

export function onlinePublicState(state: OnlineRefereeState): OnlinePublicState {
  return {
    schemaVersion: 1,
    name: state.name,
    moveCount: state.moves.length,
  }
}

export function isOnlinePublicState(value: unknown): value is OnlinePublicState {
  return (
    object(value) &&
    value.schemaVersion === 1 &&
    typeof value.name === 'string' &&
    Number.isInteger(value.moveCount) &&
    Number(value.moveCount) >= 0
  )
}
