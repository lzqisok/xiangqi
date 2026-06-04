import assert from 'node:assert/strict'
import test from 'node:test'
import { buildBoardExportMetadata } from './boardImage'

test('buildBoardExportMetadata includes scenario, side to move, and FEN', () => {
  const metadata = buildBoardExportMetadata({
    fen: '4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1',
    currentTurn: 'red',
    scenarioName: '单车例胜',
    gameMode: 'endgame',
  })

  assert.equal(metadata.title, '单车例胜')
  assert.deepEqual(metadata.lines, [
    '残局模式 · 红方走棋',
    'FEN: 4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1',
  ])
  assert.equal(metadata.filename, 'xiangqi-单车例胜.png')
})

test('buildBoardExportMetadata falls back to mode title when scenario is missing', () => {
  const metadata = buildBoardExportMetadata({
    fen: 'fen',
    currentTurn: 'black',
    scenarioName: null,
    gameMode: 'human-vs-human',
  })

  assert.equal(metadata.title, '中国象棋')
  assert.equal(metadata.lines[0], '双人对弈 · 黑方走棋')
  assert.equal(metadata.filename, 'xiangqi-board.png')
})
