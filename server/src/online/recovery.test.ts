import assert from 'node:assert/strict'
import test from 'node:test'
import { RecoveryTasks } from './recovery.js'

test('slow connection acquisition serializes replacement jobs and drops stale queued writes', async () => {
  const tasks = new RecoveryTasks(5, 10),
    writes: string[] = []
  let release!: () => void
  const hold = new Promise<void>((resolve) => (release = resolve))
  const first = tasks.submit('presence:test', async () => {
    await hold
    writes.push('old-offline')
  })
  await new Promise((resolve) => setImmediate(resolve))
  const stale = tasks.submit('presence:test', async () => {
    writes.push('stale')
  })
  const current = tasks.submit('presence:test', async () => {
    writes.push('connected')
  })
  release()
  await Promise.all([first, stale, current])
  assert.deepEqual(writes, ['old-offline', 'connected'])
  tasks.dispose()
})

test('dispose while a database call fails does not resurrect retry work', async () => {
  const tasks = new RecoveryTasks(1, 2)
  let release!: () => void,
    calls = 0
  const hold = new Promise<void>((resolve) => (release = resolve))
  const running = tasks.submit('clock:test', async () => {
    calls++
    await hold
    throw new Error('connection pressure')
  })
  await new Promise((resolve) => setImmediate(resolve))
  tasks.dispose()
  release()
  await running
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(calls, 1)
  assert.equal(tasks.has('clock:test'), false)
})
