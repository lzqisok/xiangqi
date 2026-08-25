import assert from 'node:assert/strict'
import test from 'node:test'
import { createOnlineRefereeState, onlinePublicState, readOnlineRefereeState } from './state.js'

test('online referee state canonicalizes legal moves and keeps the public cache allowlisted', () => {
  const state = readOnlineRefereeState(
    {
      schemaVersion: 1,
      name: '  公网测试棋局  ',
      moves: [{ uci: 'a3a4', color: 'red', notation: 'INJECTED', captured: 'k' }],
    },
    'xiangqi',
  )
  assert.equal(state.name, '公网测试棋局')
  assert.equal(state.moves.length, 1)
  assert.notEqual(state.moves[0].notation, 'INJECTED')
  assert.deepEqual(onlinePublicState(state), {
    schemaVersion: 1,
    name: '公网测试棋局',
    moveCount: 1,
  })
})

test('online referee state rejects illegal replays and variant-crossing secret fields', () => {
  assert.throws(
    () =>
      readOnlineRefereeState(
        { schemaVersion: 1, name: '非法棋局', moves: [{ uci: 'a3a9', color: 'red' }] },
        'xiangqi',
      ),
    /非法着法/,
  )
  assert.throws(
    () =>
      readOnlineRefereeState(
        { schemaVersion: 1, name: '五子棋局', initialLayout: 'secret', moves: [] },
        'gomoku',
        'freestyle',
      ),
    /不得包含揭棋布局/,
  )
  assert.match(createOnlineRefereeState('jieqi', '揭棋测试').initialLayout || '', /^[rabncp]{30}$/)
})
