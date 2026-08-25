import { metrics } from './observability.js'

export class ResourceLimitError extends Error {
  constructor(
    readonly code: string,
    readonly retryAfterSeconds = 5,
  ) {
    super(code)
    this.name = 'ResourceLimitError'
  }
}

export class ConnectionQuota {
  private readonly ipCounts = new Map<string, number>()
  private readonly userCounts = new Map<string, number>()

  constructor(
    private readonly maxPerIp: number,
    private readonly maxPerUser: number,
  ) {}

  reserve(ip: string, userId?: string): () => void {
    if ((this.ipCounts.get(ip) || 0) >= this.maxPerIp) {
      metrics.increment('xiangqi_ws_rejected', { reason: 'ip_quota' })
      throw new ResourceLimitError('ws_ip_quota_exceeded', 30)
    }
    if (userId && (this.userCounts.get(userId) || 0) >= this.maxPerUser) {
      metrics.increment('xiangqi_ws_rejected', { reason: 'user_quota' })
      throw new ResourceLimitError('ws_user_quota_exceeded', 30)
    }
    this.ipCounts.set(ip, (this.ipCounts.get(ip) || 0) + 1)
    if (userId) this.userCounts.set(userId, (this.userCounts.get(userId) || 0) + 1)
    this.updateMetrics()
    let released = false
    return () => {
      if (released) return
      released = true
      this.decrement(this.ipCounts, ip)
      if (userId) this.decrement(this.userCounts, userId)
      this.updateMetrics()
    }
  }

  private decrement(map: Map<string, number>, key: string) {
    const next = (map.get(key) || 1) - 1
    if (next <= 0) map.delete(key)
    else map.set(key, next)
  }

  private updateMetrics() {
    metrics.gauge(
      'xiangqi_ws_connections',
      [...this.ipCounts.values()].reduce((sum, value) => sum + value, 0),
    )
  }
}

export class EngineResourceGovernor {
  private processes = 0
  private tasks = 0
  private readonly tasksByOwner = new Map<string, number>()

  constructor(
    private readonly maxProcesses: number,
    private readonly maxTasks: number,
    private readonly maxTasksPerOwner = 2,
  ) {}

  reserveProcess(kind: 'pikafish' | 'jieqi' | 'rapfi'): () => void {
    if (this.processes >= this.maxProcesses) {
      metrics.increment('xiangqi_engine_rejected', { kind, reason: 'process_quota' })
      throw new ResourceLimitError('engine_process_quota_exceeded', 10)
    }
    this.processes += 1
    metrics.gauge('xiangqi_engine_processes', this.processes)
    let released = false
    return () => {
      if (released) return
      released = true
      this.processes = Math.max(0, this.processes - 1)
      metrics.gauge('xiangqi_engine_processes', this.processes)
    }
  }

  reserveTask(owner: string, kind: 'interactive' | 'finite'): () => void {
    if (
      this.tasks >= this.maxTasks ||
      (this.tasksByOwner.get(owner) || 0) >= this.maxTasksPerOwner
    ) {
      metrics.increment('xiangqi_engine_rejected', { kind, reason: 'task_quota' })
      throw new ResourceLimitError('engine_task_quota_exceeded', 5)
    }
    this.tasks += 1
    this.tasksByOwner.set(owner, (this.tasksByOwner.get(owner) || 0) + 1)
    metrics.gauge('xiangqi_engine_tasks', this.tasks)
    let released = false
    return () => {
      if (released) return
      released = true
      this.tasks = Math.max(0, this.tasks - 1)
      const next = (this.tasksByOwner.get(owner) || 1) - 1
      if (next <= 0) this.tasksByOwner.delete(owner)
      else this.tasksByOwner.set(owner, next)
      metrics.gauge('xiangqi_engine_tasks', this.tasks)
    }
  }

  snapshot() {
    return { processes: this.processes, tasks: this.tasks }
  }
}
