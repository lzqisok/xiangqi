import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildRapfiBoardCommand,
  parseRapfiMove,
  RAPFI_THREAD_LIMITS,
  RAPFI_TIME_LIMITS,
  type GomokuDifficulty,
  type GomokuMove,
  type GomokuPlayer,
} from './protocol.js'

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
export const RAPFI_STOP_GRACE_MS = 3_000

export interface RapfiSearchRequest {
  moves: GomokuMove[]
  aiPlayer: GomokuPlayer
  difficulty: GomokuDifficulty
  forbiddenEnabled: boolean
}

function defaultEngineDirectory(): string {
  return path.resolve(moduleDirectory, '../../../engine')
}

function findRapfiBinary(engineDirectory: string): string | null {
  const candidates = [
    process.env.RAPFI_PATH,
    path.join(engineDirectory, 'rapfi'),
    path.join(engineDirectory, 'rapfi.exe'),
  ].filter((candidate): candidate is string => Boolean(candidate))
  return candidates.find(candidate => fs.existsSync(candidate)) || null
}

function availableThreadCount(): number {
  const available = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length
  return Math.max(1, available)
}

export function getRapfiThreadCount(difficulty: GomokuDifficulty, available = availableThreadCount()): number {
  return Math.max(1, Math.min(RAPFI_THREAD_LIMITS[difficulty], available))
}

export class RapfiEngine extends EventEmitter {
  private process: ChildProcess | null = null
  private buffer = ''
  private ready = false
  private initPromise: Promise<boolean> | null = null
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly engineDirectory = defaultEngineDirectory()) {
    super()
  }

  get available(): boolean {
    return this.ready && Boolean(this.process)
  }

  async init(): Promise<boolean> {
    if (this.available) return true
    if (this.initPromise) return this.initPromise

    const promise = this.start()
    this.initPromise = promise
    try {
      return await promise
    } finally {
      if (this.initPromise === promise) this.initPromise = null
    }
  }

  private async start(): Promise<boolean> {
    this.destroy()

    const binary = findRapfiBinary(this.engineDirectory)
    if (!binary) {
      console.warn(`Rapfi engine binary not found. Expected ${path.join(this.engineDirectory, 'rapfi')}`)
      return false
    }

    try {
      const child = spawn(binary, [], {
        cwd: path.dirname(binary),
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      this.process = child
      this.buffer = ''

      child.stdout?.on('data', (data: Buffer) => {
        this.buffer += data.toString()
        const lines = this.buffer.split(/\r?\n/)
        this.buffer = lines.pop() || ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed) this.emit('line', trimmed)
        }
      })
      child.stderr?.on('data', (data: Buffer) => {
        const message = data.toString().trim()
        if (message) console.error('[rapfi stderr]', message)
      })
      child.on('error', error => {
        if (this.process === child) {
          this.ready = false
          this.emit('engine-error', error)
        }
      })
      child.on('exit', code => {
        if (this.process !== child) return
        this.process = null
        this.ready = false
        this.emit('engine-exit', code)
      })

      const started = this.waitForLine(line => line === 'OK', 20_000)
      this.send('START 15')
      await started
      this.send(`INFO thread_num ${getRapfiThreadCount('medium')}`)
      this.send(`INFO max_memory ${256 * 1024 * 1024}`)
      this.ready = true
      console.log('Rapfi engine initialized successfully:', binary)
      return true
    } catch (error) {
      console.error('Failed to start Rapfi:', error)
      this.destroy()
      return false
    }
  }

  async getBestMove(request: RapfiSearchRequest): Promise<{ row: number; col: number }> {
    let result: { row: number; col: number } | null = null
    const run = this.queue.then(async () => {
      result = await this.getBestMoveLocked(request)
    })
    this.queue = run.catch(() => {})
    await run
    if (!result) throw new Error('Rapfi returned no move')
    return result
  }

  interrupt(): void {
    if (!this.process) return
    try { this.send('STOP') } catch { /* process already closed */ }
  }

  destroy(): void {
    const child = this.process
    this.process = null
    this.ready = false
    this.buffer = ''
    if (!child) return
    this.emit('engine-exit', null)
    try { child.stdin?.write('END\n') } catch { /* process already closed */ }
    child.kill()
  }

  private async getBestMoveLocked(request: RapfiSearchRequest): Promise<{ row: number; col: number }> {
    if (!this.available && !await this.init()) throw new Error('Rapfi engine is unavailable')

    const timeLimit = RAPFI_TIME_LIMITS[request.difficulty]
    this.send(`INFO rule ${request.forbiddenEnabled ? 4 : 0}`)
    this.send(`INFO thread_num ${getRapfiThreadCount(request.difficulty)}`)
    this.send(`INFO timeout_turn ${timeLimit}`)
    this.send(`INFO timeout_match ${timeLimit}`)
    this.send(`INFO time_left ${timeLimit}`)

    const response = this.waitForLine(line => Boolean(parseRapfiMove(line)), timeLimit + RAPFI_STOP_GRACE_MS)
    for (const line of buildRapfiBoardCommand(request.moves, request.aiPlayer)) this.send(line)
    let output: string
    try {
      output = await response
    } catch (error) {
      this.destroy()
      throw error
    }
    const move = parseRapfiMove(output)
    if (!move) throw new Error('Rapfi returned an invalid move')
    if (request.moves.some(previous => previous.row === move.row && previous.col === move.col)) {
      throw new Error('Rapfi returned an occupied point')
    }
    return move
  }

  private send(command: string): void {
    if (!this.process?.stdin?.writable) throw new Error('Rapfi process is not writable')
    this.process.stdin.write(`${command}\n`)
  }

  private waitForLine(predicate: (line: string) => boolean, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        this.removeListener('line', onLine)
        this.removeListener('engine-exit', onExit)
        this.removeListener('engine-error', onError)
      }
      const onLine = (line: string) => {
        if (!predicate(line)) return
        cleanup()
        resolve(line)
      }
      const onExit = () => {
        cleanup()
        reject(new Error('Rapfi process exited'))
      }
      const onError = (error: Error) => {
        cleanup()
        reject(error)
      }
      const timer = setTimeout(() => {
        cleanup()
        this.interrupt()
        reject(new Error('Rapfi response timed out'))
      }, timeoutMs)
      this.on('line', onLine)
      this.once('engine-exit', onExit)
      this.once('engine-error', onError)
    })
  }
}
