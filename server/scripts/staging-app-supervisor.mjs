// Restart fault adapter: this supervisor controls only the child it starts itself.
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
if (process.env.ALLOW_STAGING_BUSINESS_LOAD !== '1')
  throw new Error('Isolated staging opt-in required')
const configFile = process.env.FAULT_APP_CONFIG,
  statsFile = process.env.FAULT_APP_STATS
if (!configFile || !statsFile || !process.env.FAULT_APP_COMMAND_FILE)
  throw new Error('App config, stats and command files required')
const argv = JSON.parse(await readFile(process.env.FAULT_APP_COMMAND_FILE, 'utf8'))
if (!Array.isArray(argv) || !argv.length || !argv.every((v) => typeof v === 'string'))
  throw new Error('Expected executable argv array')
let child,
  exited = Promise.resolve(),
  stopping = false,
  timer
async function stopChild() {
  if (!child) return
  const target = child
  target.kill('SIGTERM')
  const kill = setTimeout(() => target.kill('SIGKILL'), 10000)
  await exited
  clearTimeout(kill)
  child = undefined
}
async function tick() {
  if (stopping) return
  try {
    const config = JSON.parse(await readFile(configFile, 'utf8'))
    if (!['normal', 'application-restart'].includes(config.mode))
      throw new Error('Invalid app mode')
    if (config.mode === 'application-restart') await stopChild()
    else if (!child) {
      child = spawn(argv[0], argv.slice(1), {
        cwd: process.env.FAULT_APP_CWD || process.cwd(),
        env: process.env,
        stdio: 'inherit',
      })
      const target = child
      exited = new Promise((resolve) => {
        target.once('exit', () => {
          if (child === target) child = undefined
          resolve()
        })
        target.once('error', () => {
          if (child === target) child = undefined
          resolve()
        })
      })
    }
    await writeFile(
      statsFile,
      JSON.stringify({
        mode: config.mode,
        generation: config.generation,
        pid: child?.pid ?? null,
        affected: config.mode === 'application-restart' && !child ? 1 : 0,
      }),
      { mode: 0o600 },
    )
  } catch {
    console.error('App fault supervisor failed')
    process.exitCode = 1
    await shutdown()
    return
  }
  if (!stopping) timer = setTimeout(() => void tick(), 100)
}
async function shutdown() {
  stopping = true
  clearTimeout(timer)
  await stopChild()
}
process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())
await tick()
