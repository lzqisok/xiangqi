// Isolated loopback MySQL fault proxy. Point only the staging app's DATABASE_URL here.
import net from 'node:net'
import { readFile, writeFile } from 'node:fs/promises'
import { integer } from './load-support.mjs'
if (process.env.ALLOW_STAGING_BUSINESS_LOAD !== '1')
  throw new Error('Isolated staging opt-in required')
const configFile = process.env.FAULT_PROXY_CONFIG,
  statsFile = process.env.FAULT_PROXY_STATS
if (!configFile || !statsFile) throw new Error('FAULT_PROXY_CONFIG and FAULT_PROXY_STATS required')
const port = integer('FAULT_PROXY_PORT', 13306, 65535)
const upstreamPort = integer('FAULT_MYSQL_PORT', 3306, 65535)
if (port === upstreamPort) throw new Error('Proxy and upstream ports must differ')
const pairs = new Set()
let mode = 'normal',
  affected = 0,
  generation = '',
  stopped = false
const timers = new Set()
function later(action, ms) {
  const timer = setTimeout(() => {
    timers.delete(timer)
    action()
  }, ms)
  timers.add(timer)
}
const server = net.createServer((client) => {
  const pair = { client, upstream: null }
  pairs.add(pair)
  const close = () => {
    pairs.delete(pair)
    client.destroy()
    pair.upstream?.destroy()
  }
  client.on('error', close)
  client.on('close', close)
  if (mode === 'database-outage') {
    affected++
    close()
    return
  }
  if (mode === 'pool-pressure') {
    // Withhold the MySQL greeting: app-side connection acquisition slots are occupied.
    affected++
    later(close, 30000)
    return
  }
  const upstream = net.connect({ host: '127.0.0.1', port: upstreamPort })
  pair.upstream = upstream
  upstream.on('error', close)
  upstream.on('close', close)
  function forward(source, target) {
    source.on('data', (data) => {
      source.pause()
      const deliver = () => {
        if (target.destroyed) return
        target.write(data, () => source.resume())
      }
      if (mode === 'slow-query') {
        affected++
        later(deliver, 5000)
      } else deliver()
    })
  }
  forward(client, upstream)
  forward(upstream, client)
})
async function tick() {
  if (stopped) return
  try {
    const config = JSON.parse(await readFile(configFile, 'utf8'))
    if (!['normal', 'database-outage', 'slow-query', 'pool-pressure'].includes(config.mode))
      throw new Error('Invalid proxy mode')
    if (config.generation !== generation) {
      generation = config.generation
      mode = config.mode
      affected = 0
      if (mode !== 'slow-query')
        for (const pair of pairs) {
          pair.client.destroy()
          pair.upstream?.destroy()
        }
    }
    if (mode === 'database-outage')
      for (const pair of pairs) {
        affected++
        pair.client.destroy()
        pair.upstream?.destroy()
      }
    await writeFile(
      statsFile,
      JSON.stringify({ mode, generation, affected, connections: pairs.size }),
      { mode: 0o600 },
    )
  } catch {
    console.error('Fault proxy configuration/telemetry failure')
    process.exitCode = 1
    shutdown()
    return
  }
  later(() => void tick(), 100)
}
function shutdown() {
  stopped = true
  timers.forEach(clearTimeout)
  pairs.forEach((p) => {
    p.client.destroy()
    p.upstream?.destroy()
  })
  server.close()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
server.on('error', () => {
  process.exitCode = 1
  shutdown()
})
server.listen(port, '127.0.0.1', () => void tick())
