import { integer, stagingBase, LoadReport, readValid } from './load-support.mjs'
const base = stagingBase()
const cookie = process.env.STAGING_SESSION_COOKIE
if (!cookie) throw new Error('STAGING_SESSION_COOKIE required')
const concurrency = integer('LOAD_CONCURRENCY', 10, 50)
const rounds = integer('LOAD_ROUNDS', 10, 1000)
const paths = ['/api/auth/session', '/api/online/lobby', '/api/me/matches?limit=20']
const report = new LoadReport()
await Promise.all(
  Array.from({ length: concurrency }, async (_, worker) => {
    for (let round = 0; round < rounds; round++) {
      const path = paths[(worker + round) % paths.length]
      const start = performance.now()
      let status = 0,
        ok = false
      try {
        const response = await fetch(new URL(path, base), {
          redirect: 'manual',
          signal: AbortSignal.timeout(10000),
          headers: { Cookie: cookie, Origin: base.origin },
        })
        status = response.status
        ok = status === 200 && readValid(path, await response.json())
      } catch {
        /* Recorded as a failed sample, including transport and JSON errors. */
      }
      report.record(path, performance.now() - start, status, ok)
    }
  }),
)
await report.finish({ kind: 'read', concurrency, rounds })
