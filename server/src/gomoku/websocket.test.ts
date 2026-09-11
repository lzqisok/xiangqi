import assert from 'node:assert/strict'
import test from 'node:test'
import { RapfiRequestGate } from './websocket.js'

test('Rapfi request gate rejects concurrent searches in the same generation', () => {
  const gate = new RapfiRequestGate()
  const first = gate.begin()

  assert.equal(first, 0)
  assert.equal(gate.begin(), null)

  gate.finish(first!)
  assert.equal(gate.begin(), 0)
})

test('Rapfi request gate accepts one replacement search after cancellation', () => {
  const gate = new RapfiRequestGate()
  const cancelled = gate.begin()
  gate.cancel()
  const replacement = gate.begin()

  assert.equal(cancelled, 0)
  assert.equal(replacement, 1)

  gate.finish(cancelled!)
  assert.equal(gate.begin(), null, 'finishing the cancelled search must not clear the replacement')
  gate.finish(replacement!)
  assert.equal(gate.begin(), 1)
})

test('Rapfi socket denies active rated accounts and suppresses in-flight engine output', async () => {
  const { WebSocketServer, WebSocket } = await import('ws')
  const { EventEmitter } = await import('node:events')
  const { registerRapfiWebSocketServer } = await import('./websocket.js')
  let blocked = true,
    searches = 0
  let finish: ((value: { row: number; col: number }) => void) | undefined
  class FakeEngine extends EventEmitter {
    available = true
    init = async () => true
    interrupt() {}
    destroy() {}
    quit() {}
    getBestMove() {
      searches++
      return new Promise((resolve) => {
        finish = resolve
      })
    }
  }
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  registerRapfiWebSocketServer(wss, {
    liveEngines: new Set(),
    createEngine: () => new FakeEngine() as unknown as import('./rapfiEngine.js').RapfiEngine,
    canUseEngine: async () => !blocked,
  })
  await new Promise<void>((resolve) => wss.once('listening', resolve))
  const port = (wss.address() as import('node:net').AddressInfo).port
  const socket = new WebSocket(`ws://127.0.0.1:${port}`)
  const messages: Array<{ type: string; code?: string }> = []
  socket.on('message', (data) => messages.push(JSON.parse(data.toString())))
  await new Promise<void>((resolve) => socket.once('open', resolve))
  const waitFor = async (condition: () => boolean) => {
    const end = Date.now() + 2000
    while (!condition() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 10))
    assert.ok(condition())
  }
  try {
    socket.send(JSON.stringify({ type: 'init' }))
    await waitFor(() => messages.length === 1)
    assert.equal(messages[0].code, 'online_match_analysis_forbidden')
    assert.equal(searches, 0)
    blocked = false
    socket.send(
      JSON.stringify({
        type: 'move',
        requestId: 'pending',
        moves: [],
        aiPlayer: 1,
        difficulty: 'medium',
        forbiddenEnabled: false,
      }),
    )
    await waitFor(() => searches === 1)
    blocked = true
    finish!({ row: 7, col: 7 })
    await waitFor(() => messages.length === 2)
    assert.equal(messages[1].code, 'online_match_analysis_forbidden')
    assert.equal(
      messages.some((m) => m.type === 'bestmove'),
      false,
    )
  } finally {
    socket.terminate()
    for (const client of wss.clients) client.terminate()
    await new Promise<void>((resolve) => wss.close(() => resolve()))
  }
})
