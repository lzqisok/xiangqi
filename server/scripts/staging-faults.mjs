import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { businessLoad } from './staging-business-load.mjs'
import { integer } from './load-support.mjs'

// Infrastructure adapters are argv arrays, never evaluated shell fragments.
const scenarios = ['database-outage', 'slow-query', 'pool-pressure', 'application-restart']
const hooks = JSON.parse(await readFile(process.env.STAGING_FAULT_HOOKS_FILE, 'utf8'))
for (const name of scenarios)
  for (const phase of ['apply', 'verify', 'recover']) {
    assert.ok(
      Array.isArray(hooks[name]?.[phase]) && hooks[name][phase].length > 0,
      `Missing ${name}.${phase}`,
    )
  }
async function run(argv) {
  await new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { stdio: 'ignore', env: process.env })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Fault adapter timed out'))
    }, 120000)
    child.once('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      code === 0 ? resolve() : reject(new Error('Fault adapter assertion failed'))
    })
  })
}
const grace = integer('FAULT_DISCONNECT_GRACE_MS', 60000, 600000)
const recovery = integer('FAULT_RECOVERY_WAIT_MS', 65000, 600000)
const originalReport = process.env.LOAD_REPORT_FILE
process.env.LOAD_PAIRS = '1'
process.env.LOAD_ROUNDS = '1'
for (const scenario of scenarios) {
  process.env.LOAD_FAULT_SCENARIO = scenario
  if (originalReport) process.env.LOAD_REPORT_FILE = `${originalReport}.${scenario}.json`
  const result = await businessLoad(async () => {
    try {
      await run(hooks[scenario].apply)
      await run(hooks[scenario].verify) // Must assert the actual disruption, not merely injection success.
      await new Promise((r) => setTimeout(r, grace + 1000))
    } finally {
      await run(hooks[scenario].recover)
    }
    // No client interaction: background compensation must finish the match itself.
    await new Promise((r) => setTimeout(r, recovery))
  })
  if (!result.ok) throw new Error(`Blocking fault acceptance failure: ${scenario}`)
}
