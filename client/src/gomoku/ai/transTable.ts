import { WHITE, type Position, type Player } from '../core/types'
import type { Board } from '../core/board'

export type TTFlag = 'EXACT' | 'LOWER' | 'UPPER'

export interface TTEntry {
  keyHi: number
  keyLo: number
  depth: number
  score: number
  flag: TTFlag
  bestMove: Position | null
}

function nextRand(seed: number): number {
  let x = seed | 0
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  return x >>> 0
}

const CELLS = 15 * 15
const TABLE_SIZE = 1 << 19
const TABLE_MASK = TABLE_SIZE - 1

export class GomokuTransTable {
  private readonly stoneHi: Uint32Array
  private readonly stoneLo: Uint32Array
  private readonly sideHi: number
  private readonly sideLo: number
  private readonly table: Array<TTEntry | null>

  constructor() {
    this.stoneHi = new Uint32Array(CELLS * 2)
    this.stoneLo = new Uint32Array(CELLS * 2)
    this.table = new Array(TABLE_SIZE).fill(null)

    let seed = 0x9e3779b9
    for (let i = 0; i < this.stoneHi.length; i += 1) {
      seed = nextRand(seed)
      this.stoneHi[i] = seed
      seed = nextRand(seed)
      this.stoneLo[i] = seed
    }
    seed = nextRand(seed)
    this.sideHi = seed
    seed = nextRand(seed)
    this.sideLo = seed
  }

  hash(board: Board, turn: Player): { hi: number; lo: number } {
    let hi = 0
    let lo = 0
    for (let idx = 0; idx < board.length; idx += 1) {
      const cell = board[idx]
      if (cell === 0) continue
      const offset = (cell - 1) * CELLS + idx
      hi = (hi ^ this.stoneHi[offset]) >>> 0
      lo = (lo ^ this.stoneLo[offset]) >>> 0
    }
    if (turn === WHITE) {
      hi = (hi ^ this.sideHi) >>> 0
      lo = (lo ^ this.sideLo) >>> 0
    }
    return { hi, lo }
  }

  applyMoveHash(
    hash: { hi: number; lo: number },
    row: number,
    col: number,
    player: Player,
  ): { hi: number; lo: number } {
    const idx = row * 15 + col
    const offset = (player - 1) * CELLS + idx
    return {
      hi: (hash.hi ^ this.stoneHi[offset] ^ this.sideHi) >>> 0,
      lo: (hash.lo ^ this.stoneLo[offset] ^ this.sideLo) >>> 0,
    }
  }

  applyNullHash(hash: { hi: number; lo: number }): { hi: number; lo: number } {
    return {
      hi: (hash.hi ^ this.sideHi) >>> 0,
      lo: (hash.lo ^ this.sideLo) >>> 0,
    }
  }

  get(key: { hi: number; lo: number }): TTEntry | null {
    const idx = key.lo & TABLE_MASK
    const entry = this.table[idx]
    if (!entry) return null
    if (entry.keyHi !== key.hi || entry.keyLo !== key.lo) return null
    return entry
  }

  set(
    key: { hi: number; lo: number },
    depth: number,
    score: number,
    flag: TTFlag,
    bestMove: Position | null,
  ): void {
    const idx = key.lo & TABLE_MASK
    const prev = this.table[idx]
    if (!prev || depth >= prev.depth) {
      this.table[idx] = {
        keyHi: key.hi,
        keyLo: key.lo,
        depth,
        score,
        flag,
        bestMove,
      }
    }
  }
}
