import type { MoveRecord } from '../types'
import { INITIAL_FEN } from '../engine/board'
import { moveToUci } from '../engine/notation'
import { getRepetitionKey } from '../engine/repetition'
import { buildMoveRecordsFromUci } from '../share/replayLink'

export const OPENING_CATALOG_VERSION = '2026.08.1'

export interface OpeningDefinition {
  id: string
  name: string
  family: string
  description: string
  moves: string[]
}

export interface OpeningMatch extends OpeningDefinition {
  matchedPly: number
  nextMoves: string[]
}

/**
 * A deliberately small, reviewable first-party catalog. It contains no copied
 * game statistics or third-party annotations; each line is legal-replayed in
 * tests before its position key is used for recognition.
 */
export const OPENING_CATALOG: OpeningDefinition[] = [
  {
    id: 'central-cannon',
    name: '中炮局',
    family: '中炮',
    description: '红方首着炮二平五，占据中路并直接施压黑方中卒。',
    moves: ['h2e2'],
  },
  {
    id: 'central-cannon-screen-horses',
    name: '中炮对屏风马',
    family: '中炮',
    description: '黑方双马正起，形成屏风马的经典防御骨架。',
    moves: ['h2e2', 'h9g7', 'h0g2', 'b9c7'],
  },
  {
    id: 'central-cannon-same-direction-cannon',
    name: '顺炮',
    family: '中炮',
    description: '黑方以同侧炮平中对攻，局面通常较为直接。',
    moves: ['h2e2', 'h7e7'],
  },
  {
    id: 'central-cannon-opposite-direction-cannon',
    name: '列炮',
    family: '中炮',
    description: '黑方以异侧炮平中，与红方中炮形成列炮布局。',
    moves: ['h2e2', 'b7e7'],
  },
  {
    id: 'central-cannon-sandwich-horses',
    name: '中炮对反宫马',
    family: '中炮',
    description: '黑方双马之间配置士角炮，构成反宫马体系。',
    moves: ['h2e2', 'h9g7', 'h0g2', 'b7f7', 'b0c2', 'b9c7'],
  },
  {
    id: 'elephant-opening',
    name: '飞相局',
    family: '散手布局',
    description: '红方首着相三进五，先巩固中路再观察黑方应手。',
    moves: ['c0e2'],
  },
  {
    id: 'pawn-opening',
    name: '仙人指路',
    family: '散手布局',
    description: '红方首着兵七进一，以灵活兵步试探黑方布局。',
    moves: ['c3c4'],
  },
  {
    id: 'horse-opening',
    name: '起马局',
    family: '散手布局',
    description: '红方首着马八进七，保留中炮与飞相等后续选择。',
    moves: ['b0c2'],
  },
  {
    id: 'palace-corner-cannon',
    name: '仕角炮',
    family: '散手布局',
    description: '红方首着炮二平四，炮居仕角并保持阵形弹性。',
    moves: ['h2f2'],
  },
]

let catalogByPosition: Map<string, OpeningDefinition> | null = null

function getCatalogByPosition(): Map<string, OpeningDefinition> {
  if (catalogByPosition) return catalogByPosition
  catalogByPosition = new Map()
  for (const opening of [...OPENING_CATALOG].sort(
    (left, right) => left.moves.length - right.moves.length,
  )) {
    const records = buildMoveRecordsFromUci(INITIAL_FEN, opening.moves)
    const fen = records[records.length - 1]?.fen || INITIAL_FEN
    catalogByPosition.set(getRepetitionKey(fen), opening)
  }
  return catalogByPosition
}

export function identifyOpening(initialFen: string, records: MoveRecord[]): OpeningMatch | null {
  if (getRepetitionKey(initialFen) !== getRepetitionKey(INITIAL_FEN)) return null
  const byPosition = getCatalogByPosition()
  let matched: { opening: OpeningDefinition; ply: number } | null = null
  const positions = [initialFen, ...records.map((record) => record.fen)]
  for (let ply = 0; ply < positions.length; ply++) {
    const fen = positions[ply]
    const opening = byPosition.get(getRepetitionKey(fen))
    if (
      opening &&
      (!matched ||
        opening.moves.length > matched.opening.moves.length ||
        (opening.moves.length === matched.opening.moves.length && ply > matched.ply))
    )
      matched = { opening, ply }
  }
  if (!matched) return null
  const resolvedMatch: { opening: OpeningDefinition; ply: number } = matched

  const played = records.map((record) => moveToUci(record.move.from, record.move.to))
  const nextMoves = [
    ...new Set(
      OPENING_CATALOG.flatMap((opening) => {
        if (opening.moves.length <= played.length) return []
        return opening.moves.slice(0, played.length).every((move, index) => move === played[index])
          ? [opening.moves[played.length]]
          : []
      }),
    ),
  ]
  return { ...resolvedMatch.opening, matchedPly: resolvedMatch.ply, nextMoves }
}
