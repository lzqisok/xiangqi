import assert from 'node:assert/strict'
import test from 'node:test'
import { MetricsRegistry } from './observability.js'

test('metrics aggregate bounded labels and duration summaries without payloads', () => {
  const registry = new MetricsRegistry()
  registry.increment('requests', { route: '/api/matches/:id', status: 200 })
  registry.increment('requests', { status: 200, route: '/api/matches/:id' })
  registry.gauge('connections', 3)
  registry.observe('duration', 10, { scene: 'match' })
  registry.observe('duration', 30, { scene: 'match' })
  const snapshot = registry.snapshot()
  assert.equal(snapshot['requests{route="/api/matches/:id",status="200"}.total'], 2)
  assert.equal(snapshot.connections, 3)
  assert.equal(snapshot['duration{scene="match"}.count'], 2)
  assert.equal(snapshot['duration{scene="match"}.sum_ms'], 40)
  assert.equal(snapshot['duration{scene="match"}.max_ms'], 30)
  assert.match(
    registry.prometheus(),
    /^requests_total\{route="\/api\/matches\/:id",status="200"\} 2$/m,
  )
  assert.match(registry.prometheus(), /^duration_sum_ms\{scene="match"\} 40$/m)
  assert.equal(registry.counterTotal('requests'), 2)
})
