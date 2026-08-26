import assert from 'node:assert/strict'
import test from 'node:test'
import { WebSocket } from 'ws'
import { GameLeaseManager } from './leases.js'

function socket(messages: string[]): WebSocket {
  return {
    readyState: WebSocket.OPEN,
    send: (message: string) => messages.push(message),
  } as unknown as WebSocket
}

test('game leases allow one writer and notify it when another tab takes over', () => {
  const leases = new GameLeaseManager()
  const firstMessages: string[] = []
  const first = socket(firstMessages)
  const second = socket([])
  const firstClaim = leases.claim('game-1', first)
  assert.equal(firstClaim.status, 'granted')
  assert.equal(leases.validates('game-1', firstClaim.leaseToken), true)
  assert.equal(leases.claim('game-1', second).status, 'readonly')

  const takeover = leases.claim('game-1', second, true)
  assert.equal(takeover.status, 'granted')
  assert.equal(leases.validates('game-1', firstClaim.leaseToken), false)
  assert.deepEqual(JSON.parse(firstMessages[0]), { type: 'game-lease-lost', gameId: 'game-1' })

  leases.releaseSocket(second)
  assert.equal(leases.hasLease('game-1'), false)
})

test('game leases isolate identical document ids across account scopes', () => {
  const leases = new GameLeaseManager()
  const first = socket([])
  const second = socket([])

  const firstLease = leases.claim('game-1', first, false, 'user:first')
  const secondLease = leases.claim('game-1', second, false, 'user:second')

  assert.equal(firstLease.status, 'granted')
  assert.equal(secondLease.status, 'granted')
  assert.equal(leases.validates('game-1', firstLease.leaseToken, 'user:first'), true)
  assert.equal(leases.validates('game-1', firstLease.leaseToken, 'user:second'), false)
})
