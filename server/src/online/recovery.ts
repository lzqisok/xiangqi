import { metrics, structuredLog } from '../platform/observability.js'

/** Single-flight jobs; replacing a job serializes it behind its predecessor. */
export class RecoveryTasks {
  private jobs = new Map<
    string,
    { run: () => Promise<void>; attempt: number; timer?: ReturnType<typeof setTimeout> }
  >()
  private running = new Map<string, Promise<void>>()
  private disposed = false

  constructor(
    private readonly retryMs = 1_000,
    private readonly maxRetryMs = 30_000,
  ) {}

  async submit(key: string, run: () => Promise<void>): Promise<void> {
    if (this.disposed) return
    this.cancel(key)
    const job = { run, attempt: 0 }
    this.jobs.set(key, job)
    await this.execute(key, job)
  }

  has(key: string) {
    return this.jobs.has(key)
  }

  cancel(key: string) {
    clearTimeout(this.jobs.get(key)?.timer)
    this.jobs.delete(key)
  }

  private async execute(
    key: string,
    job: { run: () => Promise<void>; attempt: number; timer?: ReturnType<typeof setTimeout> },
  ) {
    const previous = this.running.get(key)
    const execution = (async () => {
      await previous
      if (this.disposed || this.jobs.get(key) !== job) return
      try {
        await job.run()
        if (this.jobs.get(key) === job) this.jobs.delete(key)
      } catch {
        if (this.disposed || this.jobs.get(key) !== job) return
        const delayMs = Math.min(this.maxRetryMs, this.retryMs * 2 ** Math.min(job.attempt++, 16))
        const operation = key.split(':', 1)[0]
        metrics.increment('xiangqi_online_recovery_failures', { operation })
        structuredLog('warn', 'online_recovery_retry', {
          operation,
          matchId: key.split(':')[1],
          attempt: job.attempt,
          delayMs,
        })
        job.timer = setTimeout(() => void this.execute(key, job), delayMs)
        job.timer.unref()
      }
    })()
    this.running.set(key, execution)
    await execution
    if (this.running.get(key) === execution) this.running.delete(key)
  }

  dispose() {
    this.disposed = true
    for (const key of this.jobs.keys()) this.cancel(key)
  }
}
