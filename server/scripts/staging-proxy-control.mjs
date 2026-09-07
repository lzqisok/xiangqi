import { readFile, writeFile, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
if (process.env.ALLOW_STAGING_BUSINESS_LOAD !== '1')
  throw new Error('Isolated staging opt-in required')
const [phase, scenario] = process.argv.slice(2)
const file =
    scenario === 'application-restart'
      ? process.env.FAULT_APP_CONFIG
      : process.env.FAULT_PROXY_CONFIG,
  statsFile =
    scenario === 'application-restart' ? process.env.FAULT_APP_STATS : process.env.FAULT_PROXY_STATS
assert.ok(file && statsFile)
assert.ok(
  ['database-outage', 'slow-query', 'pool-pressure', 'application-restart'].includes(scenario),
)
if (phase === 'apply' || phase === 'recover') {
  const config = { mode: phase === 'recover' ? 'normal' : scenario, generation: randomUUID() }
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(config), { mode: 0o600 })
  await rename(temporary, file)
  const end = Date.now() + 10000
  let applied = false
  while (Date.now() < end) {
    try {
      const state = JSON.parse(await readFile(statsFile, 'utf8'))
      if (state.generation === config.generation) {
        applied = true
        break
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  assert.ok(applied, 'Proxy did not acknowledge the mode change')
} else if (phase === 'verify') {
  const config = JSON.parse(await readFile(file, 'utf8'))
  const end = Date.now() + 90000
  let affected = false
  while (Date.now() < end) {
    try {
      const state = JSON.parse(await readFile(statsFile, 'utf8'))
      if (state.generation === config.generation && state.mode === scenario && state.affected > 0) {
        affected = true
        break
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  assert.ok(affected, 'No actual MySQL traffic was affected by the fault')
} else throw new Error('Expected apply, verify or recover')
