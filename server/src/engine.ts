import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export interface EngineInfo {
  depth: number
  score: number
  pv: string[]
  nodes: number
  nps: number
  multipv?: number
}

export interface EngineCandidate {
  move: string
  score: number
  depth: number
  pv: string[]
}

type Difficulty = 'easy' | 'medium' | 'hard' | 'master'
export type EngineVariant = 'xiangqi' | 'jieqi'

export interface EngineSearchLimit {
  searchMode?: 'depth' | 'time'
  searchDepth?: number
  searchTimeMs?: number
}

export interface EngineRuntimeOptions {
  engineThreads?: 'auto' | number
  engineHashMb?: number
}

export interface EngineMoveResult {
  move: string | null
  searchCapped: boolean
}

export interface EngineSearchCompletion {
  line: string
  searchCapped: boolean
}

export const ENGINE_SEARCH_TIMEOUT_MS = 60_000
export const ENGINE_STOP_GRACE_MS = 5_000

export function waitForBestMoveWithStop(
  emitter: EventEmitter,
  requestStop: () => void,
  timeoutMs = ENGINE_SEARCH_TIMEOUT_MS,
  stopGraceMs = ENGINE_STOP_GRACE_MS,
): Promise<EngineSearchCompletion> {
  return new Promise((resolve, reject) => {
    let searchCapped = false
    let stopTimer: ReturnType<typeof setTimeout> | undefined

    const cleanup = () => {
      clearTimeout(timeoutTimer)
      if (stopTimer) clearTimeout(stopTimer)
      emitter.removeListener('line', handler)
    }

    const handler = (line: string) => {
      if (!line.startsWith('bestmove')) return
      cleanup()
      resolve({ line, searchCapped })
    }

    const timeoutTimer = setTimeout(() => {
      searchCapped = true
      stopTimer = setTimeout(() => {
        cleanup()
        reject(new Error('Engine did not return bestmove after stop'))
      }, stopGraceMs)
      requestStop()
    }, timeoutMs)

    emitter.on('line', handler)
  })
}

const DEPTH_MAP: Record<Difficulty, number> = {
  easy: 8,
  medium: 14,
  hard: 20,
  master: 26,
}

export function getDifficultyDepth(difficulty: Difficulty): number {
  return DEPTH_MAP[difficulty]
}

export function buildGoCommand(defaultDepth: number, limit?: EngineSearchLimit): string {
  if (limit?.searchMode === 'time' && typeof limit.searchTimeMs === 'number') {
    return `go movetime ${limit.searchTimeMs}`
  }
  if (limit?.searchMode === 'depth' && typeof limit.searchDepth === 'number') {
    return `go depth ${limit.searchDepth}`
  }
  return `go depth ${defaultDepth}`
}

function toEngineFen(fen: string): string {
  return fen.trim()
}

function getEngineThreads(): number {
  if (typeof os.availableParallelism === 'function') {
    return Math.max(1, Math.min(8, os.availableParallelism()))
  }
  return Math.max(1, Math.min(8, os.cpus().length))
}

export function normalizeEngineRuntimeOptions(options?: EngineRuntimeOptions): Required<EngineRuntimeOptions> {
  const engineThreads = options?.engineThreads === 'auto' || options?.engineThreads === undefined
    ? 'auto'
    : Math.max(1, Math.min(8, Math.round(options.engineThreads)))
  const engineHashMb = typeof options?.engineHashMb === 'number' && Number.isFinite(options.engineHashMb)
    ? Math.max(16, Math.min(512, Math.round(options.engineHashMb)))
    : 128

  return { engineThreads, engineHashMb }
}

export function getEngineDirectory(moduleDirectory = __dirname): string {
  return path.resolve(moduleDirectory, '../../engine')
}

export class PikafishEngine extends EventEmitter {
  private process: ChildProcess | null = null
  private ready = false
  private buffer = ''
  private threads = 1
  private runtimeOptions: Required<EngineRuntimeOptions> = normalizeEngineRuntimeOptions()
  private searching = false
  private commandQueue: Promise<void> = Promise.resolve()

  constructor(private readonly variant: EngineVariant = 'xiangqi') {
    super()
  }

  async init(options?: EngineRuntimeOptions): Promise<boolean> {
    this.terminateProcess()
    this.buffer = ''
    const engineDir = getEngineDirectory()
    const binaryName = this.variant === 'jieqi' ? 'pikafish-jieqi' : 'pikafish'
    const candidates = [path.join(engineDir, binaryName), path.join(engineDir, `${binaryName}.exe`)]

    let enginePath = ''
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        enginePath = p
        break
      }
    }

    if (!enginePath) {
      console.error(`${this.variant === 'jieqi' ? 'Pikafish Jieqi' : 'Pikafish'} engine binary not found in engine/ directory`)
      console.error('Looked in:', engineDir)
      console.error('Please download from https://github.com/official-pikafish/Pikafish/releases')
      return false
    }

    const nnuePath = path.join(engineDir, 'pikafish.nnue')
    if (!fs.existsSync(nnuePath)) {
      console.error('NNUE file not found:', nnuePath)
      return false
    }

    console.log(`Starting ${this.variant} engine:`, enginePath)
    console.log('Engine dir:', engineDir)

    try {
      this.runtimeOptions = normalizeEngineRuntimeOptions(options || this.runtimeOptions)
      this.threads = this.resolveThreadCount(this.runtimeOptions.engineThreads)
      const child = spawn(enginePath, [], {
        cwd: engineDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      this.process = child

      child.stdout!.on('data', (data: Buffer) => {
        this.buffer += data.toString()
        const lines = this.buffer.split('\n')
        this.buffer = lines.pop() || ''
        for (const line of lines) {
          this.handleLine(line.trim())
        }
      })

      child.stderr!.on('data', (data: Buffer) => {
        console.error('[pikafish stderr]', data.toString())
      })

      child.on('exit', (code) => {
        if (this.process !== child) return
        this.process = null
        console.log(`Pikafish process exited with code ${code}`)
        this.ready = false
        this.searching = false
        this.emit('exit', code)
      })

      this.send('uci')
      await this.waitFor('uciok', 10000)
      this.send(`setoption name Threads value ${this.threads}`)
      this.send(`setoption name Hash value ${this.runtimeOptions.engineHashMb}`)
      this.send(`setoption name EvalFile value ${nnuePath}`)
      this.send('isready')
      await this.waitFor('readyok', 10000)
      this.ready = true
      console.log('Pikafish engine initialized successfully')
      return true
    } catch (err) {
      console.error('Failed to start Pikafish:', err)
      return false
    }
  }

  async getBestMove(fen: string, moves: string[], difficulty: Difficulty, limit?: EngineSearchLimit): Promise<EngineMoveResult> {
    return this.enqueue(() => this.getBestMoveLocked(fen, moves, difficulty, limit))
  }

  async applyRuntimeOptions(options?: EngineRuntimeOptions): Promise<void> {
    return this.enqueue(() => this.applyRuntimeOptionsLocked(options))
  }

  async getCandidates(fen: string, moves: string[], difficulty: Difficulty, count: number, limit?: EngineSearchLimit): Promise<EngineCandidate[]> {
    return this.enqueue(() => this.getCandidatesLocked(fen, moves, difficulty, count, limit))
  }

  private resolveThreadCount(value: Required<EngineRuntimeOptions>['engineThreads']): number {
    return value === 'auto' ? getEngineThreads() : value
  }

  private async applyRuntimeOptionsLocked(options?: EngineRuntimeOptions): Promise<void> {
    const next = normalizeEngineRuntimeOptions(options)
    this.runtimeOptions = next
    this.threads = this.resolveThreadCount(next.engineThreads)

    if (!this.ready || !this.process) {
      return
    }

    await this.stopSearchIfNeeded()
    this.send(`setoption name Threads value ${this.threads}`)
    this.send(`setoption name Hash value ${next.engineHashMb}`)
    this.send('isready')
    await this.waitFor('readyok', 10000)
  }

  private async getBestMoveLocked(fen: string, moves: string[], difficulty: Difficulty, limit?: EngineSearchLimit): Promise<EngineMoveResult> {
    if (!this.ready || !this.process) {
      console.error('Engine not ready, attempting reinit...')
      const ok = await this.init(this.runtimeOptions)
      if (!ok) return { move: null, searchCapped: false }
    }

    try {
      await this.stopSearchIfNeeded()
      const depth = getDifficultyDepth(difficulty)
      this.send('isready')
      await this.waitFor('readyok', 5000)

      let posCmd = `position fen ${toEngineFen(fen)}`
      if (moves.length > 0) {
        posCmd += ` moves ${moves.join(' ')}`
      }
      this.send(posCmd)

      this.searching = true
      this.send(buildGoCommand(depth, limit))

      const result = await waitForBestMoveWithStop(this, () => this.send('stop'))
      this.searching = false
      if (result.line) {
        const parts = result.line.split(' ')
        const idx = parts.indexOf('bestmove')
        if (idx >= 0 && parts[idx + 1]) {
          return { move: parts[idx + 1], searchCapped: result.searchCapped }
        }
      }
    } catch (err) {
      console.error('getBestMove error:', err)
      this.terminateProcess()
      throw err
    }
    return { move: null, searchCapped: false }
  }

  async analyze(fen: string, moves: string[], limit?: EngineSearchLimit): Promise<void> {
    return this.enqueue(() => this.analyzeLocked(fen, moves, limit))
  }

  private async getCandidatesLocked(fen: string, moves: string[], difficulty: Difficulty, count: number, limit?: EngineSearchLimit): Promise<EngineCandidate[]> {
    if (!this.ready || !this.process) {
      const ok = await this.init(this.runtimeOptions)
      if (!ok) return []
    }

    let infoHandler: ((info: EngineInfo) => void) | null = null
    try {
      await this.stopSearchIfNeeded()
      const depth = Math.min(16, getDifficultyDepth(difficulty))
      const candidateCount = Math.max(1, Math.min(5, count))
      const candidates = new Map<number, EngineCandidate>()
      infoHandler = (info: EngineInfo) => {
        const multipv = info.multipv || 1
        const move = info.pv[0]
        if (!move) return
        const prev = candidates.get(multipv)
        if (!prev || info.depth >= prev.depth) {
          candidates.set(multipv, { move, score: info.score, depth: info.depth, pv: info.pv })
        }
      }

      this.on('info', infoHandler)
      this.send(`setoption name MultiPV value ${candidateCount}`)
      this.send('isready')
      await this.waitFor('readyok', 5000)

      let posCmd = `position fen ${toEngineFen(fen)}`
      if (moves.length > 0) {
        posCmd += ` moves ${moves.join(' ')}`
      }
      this.send(posCmd)
      this.searching = true
      this.send(buildGoCommand(depth, limit))
      await waitForBestMoveWithStop(this, () => this.send('stop'))
      this.searching = false

      return Array.from(candidates.entries())
        .sort(([a], [b]) => a - b)
        .map(([, candidate]) => candidate)
        .slice(0, candidateCount)
    } catch (err) {
      console.error('getCandidates error:', err)
      this.terminateProcess()
      throw err
    } finally {
      if (infoHandler) {
        this.removeListener('info', infoHandler)
      }
      this.send('setoption name MultiPV value 1')
    }
  }

  private async analyzeLocked(fen: string, moves: string[], limit?: EngineSearchLimit): Promise<void> {
    if (!this.ready || !this.process) return

    await this.stopSearchIfNeeded()
    let posCmd = `position fen ${toEngineFen(fen)}`
    if (moves.length > 0) {
      posCmd += ` moves ${moves.join(' ')}`
    }
    this.send(posCmd)
    this.searching = true
    if (limit?.searchMode) {
      this.send(buildGoCommand(DEPTH_MAP.master, limit))
    } else {
      this.send('go infinite')
    }
  }

  stopAnalysis() {
    void this.enqueue(() => this.stopSearchIfNeeded())
  }

  interruptSearch() {
    if (!this.ready || !this.process || !this.searching) return
    this.send('stop')
  }

  private send(cmd: string) {
    if (this.process?.stdin?.writable) {
      this.process.stdin.write(cmd + '\n')
    }
  }

  private handleLine(line: string) {
    if (!line) return

    if (line.startsWith('info') && line.includes('score')) {
      const info = this.parseInfo(line)
      if (info) {
        this.emit('info', info)
      }
    }

    if (line.startsWith('bestmove')) {
      this.searching = false
      this.emit('line', line)
    } else if (line === 'uciok' || line === 'readyok') {
      this.emit('line', line)
    }
  }

  private parseInfo(line: string): EngineInfo | null {
    const parts = line.split(' ')
    let depth = 0, score = 0, nodes = 0, nps = 0, multipv = 1
    const pv: string[] = []
    let isMate = false

    for (let i = 0; i < parts.length; i++) {
      switch (parts[i]) {
        case 'depth': depth = parseInt(parts[++i]) || 0; break
        case 'score':
          if (parts[i + 1] === 'cp') {
            score = parseInt(parts[i + 2]) || 0
            i += 2
          } else if (parts[i + 1] === 'mate') {
            const mateIn = parseInt(parts[i + 2]) || 0
            score = mateIn > 0 ? 30000 : -30000
            isMate = true
            i += 2
          }
          break
        case 'nodes': nodes = parseInt(parts[++i]) || 0; break
        case 'nps': nps = parseInt(parts[++i]) || 0; break
        case 'multipv': multipv = parseInt(parts[++i]) || 1; break
        case 'pv':
          for (let j = i + 1; j < parts.length; j++) {
            if (parts[j].match(/^[a-i][0-9][a-i][0-9]$/)) {
              pv.push(parts[j])
            } else {
              break
            }
          }
          break
      }
    }

    if (depth === 0) return null
    return { depth, score, pv, nodes, nps, multipv }
  }

  private waitFor(keyword: string, timeout = 10000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener('line', handler)
        reject(new Error(`Timeout waiting for ${keyword}`))
      }, timeout)

      const handler = (line: string) => {
        if (line.startsWith(keyword) || line === keyword) {
          clearTimeout(timer)
          this.removeListener('line', handler)
          resolve(line)
        }
      }

      this.on('line', handler)
    })
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.commandQueue.then(task, task)
    this.commandQueue = run.then(() => undefined, () => undefined)
    return run
  }

  private async stopSearchIfNeeded(): Promise<void> {
    if (!this.ready || !this.process || !this.searching) return
    this.send('stop')
    try {
      await this.waitFor('bestmove', 5000)
    } catch {
      this.ready = false
    } finally {
      this.searching = false
    }
  }

  private terminateProcess() {
    const child = this.process
    this.process = null
    this.ready = false
    this.searching = false
    this.buffer = ''
    if (!child) return

    child.stdout?.removeAllListeners()
    child.stderr?.removeAllListeners()
    child.removeAllListeners()
    if (!child.killed) child.kill()
  }

  destroy() {
    this.terminateProcess()
  }
}
