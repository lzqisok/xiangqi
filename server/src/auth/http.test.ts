import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { IncomingMessage } from 'node:http'
import type { WebSocket } from 'ws'
import { AuthConnectionRegistry } from './service.js'
import { originAllowed } from './http.js'

function request(origin: string | undefined, host = 'chess.example.com'): IncomingMessage {
  return { headers: { origin, host } } as IncomingMessage
}

test('public HTTP and WebSocket origins require configured or secure same-origin values', () => {
  const production = { production: true, exposeDevelopmentTokens: false }
  assert.equal(originAllowed(request('https://chess.example.com'), production), true)
  assert.equal(originAllowed(request('http://chess.example.com'), production), false)
  assert.equal(originAllowed(request('https://evil.example.com'), production), false)
  assert.equal(originAllowed(request(undefined), production), false)
  assert.equal(
    originAllowed(request('https://preview.example.com'), {
      ...production,
      allowedOrigins: ['https://preview.example.com'],
    }),
    true,
  )
})

test('revoking a session closes every WebSocket bound to that session', () => {
  class Socket extends EventEmitter {
    closures: Array<[number, string]> = []
    close(code: number, reason: string) {
      this.closures.push([code, reason])
      this.emit('close')
    }
  }
  const registry = new AuthConnectionRegistry()
  const first = new Socket()
  const second = new Socket()
  registry.bind('session-a', first as unknown as WebSocket)
  registry.bind('session-a', second as unknown as WebSocket)
  registry.closeSession('session-a', 'Session revoked')
  assert.deepEqual(first.closures, [[1008, 'Session revoked']])
  assert.deepEqual(second.closures, [[1008, 'Session revoked']])
})
