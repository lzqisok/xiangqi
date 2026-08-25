import type { RequestHandler } from 'express'

type Labels = Record<string, string | number | boolean | undefined>

function metricKey(name: string, labels: Labels): string {
  const suffix = Object.entries(labels)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${JSON.stringify(String(value))}`)
    .join(',')
  return suffix ? `${name}{${suffix}}` : name
}

function prometheusKey(key: string, suffix = ''): string {
  const labelAt = key.indexOf('{')
  if (labelAt < 0) return `${key}${suffix}`
  return `${key.slice(0, labelAt)}${suffix}${key.slice(labelAt)}`
}

function normalizedRoute(path: string): string {
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/\/[^/]{16,}(?=\/|$)/g, '/:id')
    .slice(0, 120)
}

export class MetricsRegistry {
  private readonly counters = new Map<string, number>()
  private readonly gauges = new Map<string, number>()
  private readonly durations = new Map<string, { count: number; sum: number; maximum: number }>()

  increment(name: string, labels: Labels = {}, amount = 1): void {
    const key = metricKey(name, labels)
    this.counters.set(key, (this.counters.get(key) || 0) + amount)
  }

  gauge(name: string, value: number, labels: Labels = {}): void {
    this.gauges.set(metricKey(name, labels), value)
  }

  observe(name: string, milliseconds: number, labels: Labels = {}): void {
    const key = metricKey(name, labels)
    const current = this.durations.get(key) || { count: 0, sum: 0, maximum: 0 }
    current.count += 1
    current.sum += milliseconds
    current.maximum = Math.max(current.maximum, milliseconds)
    this.durations.set(key, current)
  }

  counterTotal(name: string): number {
    let total = 0
    for (const [key, value] of this.counters) {
      if (key === name || key.startsWith(`${name}{`)) total += value
    }
    return total
  }

  snapshot(): Record<string, number> {
    const result: Record<string, number> = {}
    for (const [key, value] of this.counters) result[`${key}.total`] = value
    for (const [key, value] of this.gauges) result[key] = value
    for (const [key, value] of this.durations) {
      result[`${key}.count`] = value.count
      result[`${key}.sum_ms`] = Math.round(value.sum)
      result[`${key}.max_ms`] = Math.round(value.maximum)
    }
    return result
  }

  prometheus(): string {
    const lines: Array<[string, number]> = []
    for (const [key, value] of this.counters) lines.push([prometheusKey(key, '_total'), value])
    for (const [key, value] of this.gauges) lines.push([key, value])
    for (const [key, value] of this.durations) {
      lines.push([prometheusKey(key, '_count'), value.count])
      lines.push([prometheusKey(key, '_sum_ms'), Math.round(value.sum)])
      lines.push([prometheusKey(key, '_max_ms'), Math.round(value.maximum)])
    }
    return `${lines
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key} ${value}`)
      .join('\n')}\n`
  }
}

export const metrics = new MetricsRegistry()

type LogFields = Record<string, string | number | boolean | null | undefined>

const FORBIDDEN_LOG_KEY =
  /password|token|cookie|authorization|email|content|payload|state|fen|moves/i

export function structuredLog(
  level: 'info' | 'warn' | 'error',
  event: string,
  fields: LogFields = {},
): void {
  const safe: LogFields = {}
  for (const [key, value] of Object.entries(fields)) {
    if (!FORBIDDEN_LOG_KEY.test(key) && value !== undefined) safe[key] = value
  }
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...safe,
  })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export function createHttpObservability(successSampleRate = 1): RequestHandler {
  return (request, response, next) => {
    const startedAt = performance.now()
    const route = normalizedRoute(request.originalUrl.split('?', 1)[0] || request.path)
    response.once('finish', () => {
      const durationMs = performance.now() - startedAt
      const labels = {
        method: request.method,
        route,
        status: response.statusCode,
      }
      metrics.increment('xiangqi_http_requests', labels)
      metrics.observe('xiangqi_http_duration', durationMs, {
        method: request.method,
        route,
      })
      if (response.statusCode >= 500) metrics.increment('xiangqi_http_5xx', { route })
      if (response.statusCode === 429) metrics.increment('xiangqi_http_rate_limited', { route })
      if (response.statusCode >= 400 || Math.random() < successSampleRate) {
        structuredLog(response.statusCode >= 500 ? 'error' : 'info', 'http_request', {
          requestId: response.locals.requestId,
          method: request.method,
          route,
          status: response.statusCode,
          durationMs: Math.round(durationMs),
        })
      }
    })
    next()
  }
}

export function engineHealthSnapshot() {
  const snapshot = metrics.snapshot()
  return {
    activeProcesses: snapshot.xiangqi_engine_processes || 0,
    activeTasks: snapshot.xiangqi_engine_tasks || 0,
    rejectedTasks: metrics.counterTotal('xiangqi_engine_rejected'),
    timeouts: metrics.counterTotal('xiangqi_engine_timeouts'),
    exits: metrics.counterTotal('xiangqi_engine_exits'),
  }
}

export function recordProcessMetrics(): void {
  const memory = process.memoryUsage()
  const cpu = process.cpuUsage()
  metrics.gauge('xiangqi_process_memory_bytes', memory.rss, { kind: 'rss' })
  metrics.gauge('xiangqi_process_memory_bytes', memory.heapUsed, { kind: 'heap_used' })
  metrics.gauge('xiangqi_process_cpu_seconds', cpu.user / 1_000_000, { kind: 'user' })
  metrics.gauge('xiangqi_process_cpu_seconds', cpu.system / 1_000_000, { kind: 'system' })
  metrics.gauge('xiangqi_process_uptime_seconds', process.uptime())
}
