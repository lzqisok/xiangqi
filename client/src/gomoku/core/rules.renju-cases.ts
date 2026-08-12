import { applyMove, createEmptyBoard } from './board'
import { checkWinResult, isForbiddenMove } from './rules'
import { BLACK, WHITE, type Move, type Player, type RuleConfig } from './types'

interface RenjuCase {
  name: string
  config: RuleConfig
  moves: Move[]
  lastMove: Move
  expectForbidden: boolean
  expectWinner: Player | null
}

interface RenjuCaseResult {
  name: string
  pass: boolean
  actualForbidden: boolean
  actualWinner: Player | null
  expectedForbidden: boolean
  expectedWinner: Player | null
}

function boardFromMoves(moves: Move[]) {
  let board = createEmptyBoard()
  for (const move of moves) {
    board = applyMove(board, move)
  }
  return board
}

export const RENJU_REGRESSION_CASES: RenjuCase[] = [
  {
    name: 'black-overline-is-forbidden',
    config: { forbiddenEnabled: true },
    moves: [
      { row: 7, col: 3, player: BLACK },
      { row: 7, col: 4, player: BLACK },
      { row: 7, col: 5, player: BLACK },
      { row: 7, col: 6, player: BLACK },
      { row: 7, col: 7, player: BLACK },
      { row: 7, col: 8, player: BLACK },
    ],
    lastMove: { row: 7, col: 8, player: BLACK },
    expectForbidden: true,
    expectWinner: WHITE,
  },
  {
    name: 'black-exact-five-is-win',
    config: { forbiddenEnabled: true },
    moves: [
      { row: 7, col: 3, player: BLACK },
      { row: 7, col: 4, player: BLACK },
      { row: 7, col: 5, player: BLACK },
      { row: 7, col: 6, player: BLACK },
      { row: 7, col: 7, player: BLACK },
    ],
    lastMove: { row: 7, col: 7, player: BLACK },
    expectForbidden: false,
    expectWinner: BLACK,
  },
  {
    name: 'black-double-four-is-forbidden',
    config: { forbiddenEnabled: true },
    moves: [
      { row: 7, col: 5, player: BLACK },
      { row: 7, col: 6, player: BLACK },
      { row: 7, col: 8, player: BLACK },
      { row: 5, col: 7, player: BLACK },
      { row: 6, col: 7, player: BLACK },
      { row: 8, col: 7, player: BLACK },
      { row: 7, col: 7, player: BLACK },
    ],
    lastMove: { row: 7, col: 7, player: BLACK },
    expectForbidden: true,
    expectWinner: WHITE,
  },
  {
    name: 'black-double-three-is-forbidden',
    config: { forbiddenEnabled: true },
    moves: [
      { row: 7, col: 6, player: BLACK },
      { row: 7, col: 8, player: BLACK },
      { row: 6, col: 7, player: BLACK },
      { row: 8, col: 7, player: BLACK },
      { row: 7, col: 7, player: BLACK },
    ],
    lastMove: { row: 7, col: 7, player: BLACK },
    expectForbidden: true,
    expectWinner: WHITE,
  },
  {
    name: 'white-not-restricted-by-forbidden',
    config: { forbiddenEnabled: true },
    moves: [
      { row: 9, col: 3, player: WHITE },
      { row: 9, col: 4, player: WHITE },
      { row: 9, col: 5, player: WHITE },
      { row: 9, col: 6, player: WHITE },
      { row: 9, col: 7, player: WHITE },
      { row: 9, col: 8, player: WHITE },
    ],
    lastMove: { row: 9, col: 8, player: WHITE },
    expectForbidden: false,
    expectWinner: WHITE,
  },
  {
    name: 'black-jump-three-three-is-forbidden',
    config: { forbiddenEnabled: true },
    moves: [
      { row: 7, col: 5, player: BLACK },
      { row: 7, col: 8, player: BLACK },
      { row: 5, col: 7, player: BLACK },
      { row: 8, col: 7, player: BLACK },
      { row: 7, col: 7, player: BLACK },
    ],
    lastMove: { row: 7, col: 7, player: BLACK },
    expectForbidden: true,
    expectWinner: WHITE,
  },
  {
    name: 'black-open-four-plus-blocked-four-is-forbidden',
    config: { forbiddenEnabled: true },
    moves: [
      { row: 7, col: 4, player: BLACK },
      { row: 7, col: 5, player: BLACK },
      { row: 7, col: 6, player: BLACK },
      { row: 5, col: 7, player: BLACK },
      { row: 6, col: 7, player: BLACK },
      { row: 8, col: 7, player: BLACK },
      { row: 4, col: 7, player: WHITE },
      { row: 7, col: 7, player: BLACK },
    ],
    lastMove: { row: 7, col: 7, player: BLACK },
    expectForbidden: true,
    expectWinner: WHITE,
  },
  {
    name: 'black-five-overrides-double-four',
    config: { forbiddenEnabled: true },
    moves: [
      { row: 7, col: 3, player: BLACK },
      { row: 7, col: 4, player: BLACK },
      { row: 7, col: 5, player: BLACK },
      { row: 7, col: 6, player: BLACK },
      { row: 5, col: 7, player: BLACK },
      { row: 6, col: 7, player: BLACK },
      { row: 8, col: 7, player: BLACK },
      { row: 7, col: 7, player: BLACK },
    ],
    lastMove: { row: 7, col: 7, player: BLACK },
    expectForbidden: false,
    expectWinner: BLACK,
  },
  {
    name: 'black-corner-three-three-is-forbidden',
    config: { forbiddenEnabled: true },
    moves: [
      { row: 0, col: 1, player: BLACK },
      { row: 0, col: 3, player: BLACK },
      { row: 1, col: 2, player: BLACK },
      { row: 3, col: 2, player: BLACK },
      { row: 0, col: 2, player: BLACK },
    ],
    lastMove: { row: 0, col: 2, player: BLACK },
    expectForbidden: false,
    expectWinner: null,
  },
  {
    name: 'black-single-three-not-forbidden',
    config: { forbiddenEnabled: true },
    moves: [
      { row: 7, col: 6, player: BLACK },
      { row: 7, col: 8, player: BLACK },
      { row: 7, col: 7, player: BLACK },
    ],
    lastMove: { row: 7, col: 7, player: BLACK },
    expectForbidden: false,
    expectWinner: null,
  },
  {
    name: 'black-overline-seven-is-forbidden',
    config: { forbiddenEnabled: true },
    moves: [
      { row: 7, col: 2, player: BLACK },
      { row: 7, col: 3, player: BLACK },
      { row: 7, col: 4, player: BLACK },
      { row: 7, col: 5, player: BLACK },
      { row: 7, col: 6, player: BLACK },
      { row: 7, col: 7, player: BLACK },
      { row: 7, col: 8, player: BLACK },
    ],
    lastMove: { row: 7, col: 8, player: BLACK },
    expectForbidden: true,
    expectWinner: WHITE,
  },
  {
    name: 'forbidden-disabled-allows-double-three',
    config: { forbiddenEnabled: false },
    moves: [
      { row: 7, col: 6, player: BLACK },
      { row: 7, col: 8, player: BLACK },
      { row: 6, col: 7, player: BLACK },
      { row: 8, col: 7, player: BLACK },
      { row: 7, col: 7, player: BLACK },
    ],
    lastMove: { row: 7, col: 7, player: BLACK },
    expectForbidden: false,
    expectWinner: null,
  },
]

export function runRenjuRegressionCases(): RenjuCaseResult[] {
  return RENJU_REGRESSION_CASES.map((item) => {
    const board = boardFromMoves(item.moves)
    const actualForbidden =
      item.lastMove.player === BLACK ? isForbiddenMove(board, item.lastMove.row, item.lastMove.col, item.config) : false
    const ended = checkWinResult(board, item.lastMove, item.lastMove.player, item.config)
    const actualWinner = ended?.winner ?? null
    const pass = actualForbidden === item.expectForbidden && actualWinner === item.expectWinner
    return {
      name: item.name,
      pass,
      actualForbidden,
      actualWinner,
      expectedForbidden: item.expectForbidden,
      expectedWinner: item.expectWinner,
    }
  })
}
