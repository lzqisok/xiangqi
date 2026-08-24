import assert from 'node:assert/strict'
import test from 'node:test'
import { INITIAL_FEN } from '../engine/board.js'
import { buildMoveRecordsFromUci } from '../share/replayLink.js'
import type { GameDocument } from '../types.js'
import { createVariationTree } from '../variations/tree.js'
import { exportIccsPgn, importIccsPgn } from './iccsPgn.js'

function game(moves = ['h2e2', 'h7e7', 'b0c2']): GameDocument {
  const records = buildMoveRecordsFromUci(INITIAL_FEN, moves)
  return {
    id: '00000000-0000-4000-8000-000000000001',
    schemaVersion: 2,
    revision: 0,
    name: 'ICCS “往返”测试',
    mode: 'human-vs-human',
    config: {
      difficulty: 'medium',
      playerSide: 'red',
      aiRedDifficulty: 'medium',
      aiBlackDifficulty: 'medium',
    },
    state: {
      initialFen: INITIAL_FEN,
      historyRecords: records,
      currentMoveIndex: records.length - 1,
      variationTree: createVariationTree(INITIAL_FEN, records),
      gameStatus: 'playing',
    },
    createdAt: 1,
    updatedAt: 2,
  }
}

test('ICCS PGN round-trips a linear ordinary game with explicit format and FEN', () => {
  const source = game()
  const pgn = exportIccsPgn(source)
  const imported = importIccsPgn(pgn)

  assert.match(pgn, /^\[Game "Chinese Chess"\]/)
  assert.match(pgn, /\[Format "ICCS"\]/)
  assert.match(pgn, /1\. H2-E2 H7-E7 2\. B0-C2 \*/)
  assert.equal(imported.name, source.name)
  assert.equal(imported.state.initialFen, INITIAL_FEN)
  assert.deepEqual(
    imported.state.historyRecords.map(
      (record) =>
        `${String.fromCharCode(97 + record.move.from.col)}${9 - record.move.from.row}${String.fromCharCode(97 + record.move.to.col)}${9 - record.move.to.row}`,
    ),
    ['h2e2', 'h7e7', 'b0c2'],
  )
})

test('ICCS PGN preserves a custom black-to-move FEN and move numbering', () => {
  const initialFen = INITIAL_FEN.replace(' w ', ' b ')
  const records = buildMoveRecordsFromUci(initialFen, ['h7e7', 'h2e2'])
  const source = game([])
  source.state = {
    initialFen,
    historyRecords: records,
    currentMoveIndex: records.length - 1,
    variationTree: createVariationTree(initialFen, records),
    gameStatus: 'playing',
  }

  const pgn = exportIccsPgn(source)
  const imported = importIccsPgn(pgn)

  assert.match(pgn, /1\. \.\.\. H7-E7 2\. H2-E2 \*/)
  assert.equal(imported.state.initialFen, initialFen)
  assert.equal(imported.state.historyRecords.length, 2)
})

test('ICCS PGN import accepts comments but rejects branches, illegal moves, and result mismatch', () => {
  const valid = `[Game "Chinese Chess"]\n[Format "ICCS"]\n[Result "1-0"]\n\n1. H2-E2 {中炮} H7-E7 1-0`
  assert.equal(importIccsPgn(valid).state.gameStatus, 'red-wins')
  assert.throws(() => importIccsPgn(valid.replace('{中炮}', '( H2-H3 )')), /不支持变例/)
  assert.throws(() => importIccsPgn(valid.replace('H2-E2', 'H2-G3')), /Illegal move/)
  assert.throws(() => importIccsPgn(valid.replace('[Result "1-0"]', '[Result "0-1"]')), /不一致/)
})

test('Jieqi never enters ordinary ICCS PGN export', () => {
  const source = game([])
  source.mode = 'jieqi'
  assert.throws(() => exportIccsPgn(source), /揭棋不能导出/)
})
