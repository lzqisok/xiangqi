import { writeFile } from 'node:fs/promises'

export function integer(name, fallback, max) {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${name}`)
  return value
}
export function stagingBase() {
  const base = new URL(process.env.STAGING_ORIGIN)
  if (
    base.protocol !== 'https:' &&
    !(base.protocol === 'http:' && process.env.ALLOW_HTTP_STAGING === '1')
  )
    throw new Error('HTTPS required')
  return base
}
export function readValid(path, body) {
  if (path === '/api/auth/session')
    return body?.authenticated === true && typeof body.user?.id === 'string'
  return Array.isArray(body?.matches)
}
export class LoadReport {
  samples = new Map()
  started = performance.now()
  record(operation, duration, status, ok) {
    const samples = this.samples.get(operation) ?? []
    samples.push({ duration, status, ok })
    this.samples.set(operation, samples)
  }
  async measure(operation, action) {
    const start = performance.now()
    try {
      const result = await action()
      this.record(operation, performance.now() - start, 200, true)
      return result
    } catch (error) {
      this.record(operation, performance.now() - start, error.status ?? 0, false)
      throw error
    }
  }
  async finish(parameters, failed = false) {
    const operations = Object.fromEntries(
      [...this.samples].map(([name, samples]) => {
        const times = samples.map((s) => s.duration).sort((a, b) => a - b)
        const percentile = (p) => times[Math.max(0, Math.ceil(times.length * p) - 1)]
        return [
          name,
          {
            requests: samples.length,
            p50Ms: percentile(0.5),
            p95Ms: percentile(0.95),
            p99Ms: percentile(0.99),
            errorRate: samples.filter((s) => !s.ok).length / samples.length,
            rateLimitRatio: samples.filter((s) => s.status === 429).length / samples.length,
          },
        ]
      }),
    )
    const p95TargetMs = integer('LOAD_P95_TARGET_MS', 1000, 60000)
    const ok =
      !failed &&
      Object.keys(operations).length > 0 &&
      Object.values(operations).every((o) => o.errorRate === 0 && o.p95Ms <= p95TargetMs)
    const report = {
      ok,
      parameters: { ...parameters, p95TargetMs, maxErrorRate: 0 },
      durationMs: performance.now() - this.started,
      operations,
    }
    if (process.env.LOAD_REPORT_FILE)
      await writeFile(process.env.LOAD_REPORT_FILE, JSON.stringify(report, null, 2) + '\n', {
        mode: 0o600,
      })
    console.log(JSON.stringify(report))
    if (!ok) process.exitCode = 1
    return report
  }
}
export async function request(
  base,
  report,
  path,
  { cookie, csrf, body, expected = [200], method = 'GET' } = {},
) {
  return report.measure(
    `${method} ${path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, ':id')}`,
    async () => {
      const response = await fetch(new URL(path, base), {
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
        headers: {
          Origin: base.origin,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      if (!expected.includes(response.status)) {
        const error = new Error(`Unexpected HTTP status for ${path}`)
        error.status = response.status
        throw error
      }
      const data = response.status === 204 ? null : await response.json()
      return { data, response }
    },
  )
}
