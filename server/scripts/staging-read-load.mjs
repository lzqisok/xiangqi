const origin = process.env.STAGING_ORIGIN
const cookie = process.env.STAGING_SESSION_COOKIE
if (!origin || !cookie) throw new Error('STAGING_ORIGIN and STAGING_SESSION_COOKIE are required')
const base = new URL(origin)
if (base.protocol !== 'https:' && process.env.ALLOW_HTTP_STAGING !== '1') {
  throw new Error('staging load check requires HTTPS')
}
const concurrency = Math.min(50, Math.max(1, Number(process.env.LOAD_CONCURRENCY || 10)))
const rounds = Math.min(100, Math.max(1, Number(process.env.LOAD_ROUNDS || 10)))
const paths = ['/api/auth/session', '/api/online/lobby', '/api/me/matches?limit=20']
const startedAt = performance.now()
const statuses = new Map()

await Promise.all(
  Array.from({ length: concurrency }, async (_, worker) => {
    for (let round = 0; round < rounds; round++) {
      const path = paths[(worker + round) % paths.length]
      const response = await fetch(new URL(path, base), {
        headers: { Cookie: cookie, Origin: base.origin },
      })
      statuses.set(response.status, (statuses.get(response.status) || 0) + 1)
      await response.arrayBuffer()
      if (response.status >= 500) throw new Error(`${path} returned ${response.status}`)
    }
  }),
)

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    requests: concurrency * rounds,
    durationMs: Math.round(performance.now() - startedAt),
    statuses: Object.fromEntries(statuses),
  })}\n`,
)
