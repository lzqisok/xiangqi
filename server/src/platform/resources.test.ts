import assert from 'node:assert/strict'
import test from 'node:test'
import { ConnectionQuota, EngineResourceGovernor, ResourceLimitError } from './resources.js'

test('connection quotas apply independently to trusted client IP and account', () => {
  const quota = new ConnectionQuota(2, 1)
  const release = quota.reserve('203.0.113.1', 'user-a')
  assert.throws(() => quota.reserve('203.0.113.2', 'user-a'), ResourceLimitError)
  const second = quota.reserve('203.0.113.1', 'user-b')
  assert.throws(() => quota.reserve('203.0.113.1', 'user-c'), ResourceLimitError)
  release()
  second()
  quota.reserve('203.0.113.1', 'user-a')()
})

test('engine governor bounds total processes, total tasks, and tasks per owner', () => {
  const governor = new EngineResourceGovernor(1, 2, 1)
  const process = governor.reserveProcess('pikafish')
  assert.throws(() => governor.reserveProcess('rapfi'), ResourceLimitError)
  const task = governor.reserveTask('socket-a', 'finite')
  assert.throws(() => governor.reserveTask('socket-a', 'interactive'), ResourceLimitError)
  process()
  task()
  assert.deepEqual(governor.snapshot(), { processes: 0, tasks: 0 })
})
