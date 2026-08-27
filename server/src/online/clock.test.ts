import assert from 'node:assert/strict'
import test from 'node:test'
import {
  advanceOnlineClock,
  createOnlineClock,
  projectOnlineClock,
  readOnlineClock,
  retargetOnlineClock,
  stopOnlineClock,
} from './clock.js'

test('authoritative clock starts only for configured presets and applies increment after a move', () => {
  const startedAt = new Date('2026-01-01T00:00:00.000Z')
  assert.equal(createOnlineClock('none', startedAt), undefined)
  const clock = createOnlineClock('15m-10s', startedAt)!
  const moved = advanceOnlineClock(clock, 'red', new Date(startedAt.getTime() + 4_000))

  assert.equal(moved.timedOut, null)
  assert.equal(moved.clock.redRemainingMs, 906_000)
  assert.equal(moved.clock.activeSide, 'black')
  assert.equal(moved.clock.deadlineAt, '2026-01-01T00:15:04.000Z')
})

test('deadline wins over a late move and freezes the authoritative clock', () => {
  const startedAt = new Date('2026-01-01T00:00:00.000Z')
  const clock = createOnlineClock('10m', startedAt)!
  const result = advanceOnlineClock(clock, 'red', new Date('2026-01-01T00:10:00.001Z'))

  assert.equal(result.timedOut, 'red')
  assert.equal(result.clock.redRemainingMs, 0)
  assert.equal(result.clock.activeSide, null)
  assert.equal(result.clock.deadlineAt, null)
})

test('projection, stop, persistence validation and undo retargeting preserve bounded time', () => {
  const startedAt = new Date('2026-01-01T00:00:00.000Z')
  const clock = createOnlineClock('30m', startedAt)!
  const projected = projectOnlineClock(clock, new Date('2026-01-01T00:00:03.000Z'))
  assert.equal(projected.redRemainingMs, 1_797_000)

  const retargeted = retargetOnlineClock(clock, 'black', new Date('2026-01-01T00:00:03.000Z'))
  assert.equal(retargeted.redRemainingMs, 1_797_000)
  assert.equal(retargeted.deadlineAt, '2026-01-01T00:30:03.000Z')
  assert.deepEqual(readOnlineClock(retargeted), retargeted)

  const stopped = stopOnlineClock(clock, new Date('2026-01-01T00:00:05.000Z'))
  assert.equal(stopped.redRemainingMs, 1_795_000)
  assert.equal(stopped.activeSide, null)
  assert.throws(() => readOnlineClock({ ...clock, deadlineAt: 'invalid' }), /棋钟状态/)
})
