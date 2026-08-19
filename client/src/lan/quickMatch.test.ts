import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseQuickMatch,
  quickMatchKey,
  quickMatchRoomUrl,
  removeQuickMatchMarker,
  shouldRequeueQuickMatch,
} from './quickMatch'

test('quick match URL helpers preserve the ruleset needed for automatic requeue', () => {
  assert.deepEqual(parseQuickMatch('?lan=1&quick=jieqi'), {
    key: 'jieqi',
    variant: 'jieqi',
  })
  assert.deepEqual(parseQuickMatch('?quick=gomoku-renju'), {
    key: 'gomoku-renju',
    variant: 'gomoku',
    gomokuRule: 'renju',
  })
  assert.equal(parseQuickMatch('?quick=unknown'), null)
  assert.equal(quickMatchKey('gomoku', 'freestyle'), 'gomoku-freestyle')

  const target = new URL(
    quickMatchRoomUrl('http://localhost:5173/?lan=1', 'room-id', 'gomoku-renju'),
  )
  assert.equal(target.searchParams.get('room'), 'room-id')
  assert.equal(target.searchParams.get('quick'), 'gomoku-renju')
  assert.equal(target.searchParams.get('gomoku'), '1')
  assert.equal(new URL(removeQuickMatchMarker(target.toString())).searchParams.has('quick'), false)
  assert.equal(
    shouldRequeueQuickMatch(parseQuickMatch('?quick=xiangqi'), { error: '对局不存在' }),
    true,
  )
  assert.equal(
    shouldRequeueQuickMatch(parseQuickMatch('?quick=xiangqi'), {
      snapshot: { matchmaking: true, phase: 'waiting', role: 'spectator' },
    }),
    true,
  )
  assert.equal(shouldRequeueQuickMatch(null, { error: '对局不存在' }), false)
})
