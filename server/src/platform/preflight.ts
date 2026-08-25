import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAuthTokenDelivery } from '../auth/delivery.js'
import { loadDatabaseConfig } from '../db/config.js'
import { loadPlatformConfig } from './config.js'

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))

async function requireReadable(relativePath: string, executable = false): Promise<void> {
  const target = path.join(repositoryRoot, relativePath)
  await access(
    target,
    constants.R_OK | (executable && process.platform !== 'win32' ? constants.X_OK : 0),
  )
}

const platform = loadPlatformConfig()
const database = loadDatabaseConfig()
if (database.enabled) createAuthTokenDelivery(process.env, platform.production)
if (!platform.production) throw new Error('platform:preflight must run with NODE_ENV=production')
if (platform.publicOnlineEnabled && !database.enabled) {
  throw new Error('PUBLIC_ONLINE_ENABLED requires ONLINE_DATABASE_ENABLED')
}
const pinnedNode = (await readFile(path.join(repositoryRoot, '.nvmrc'), 'utf8')).trim()
if (process.version !== `v${pinnedNode}`) {
  throw new Error(`Node ${pinnedNode} is required; current runtime is ${process.version}`)
}
await Promise.all([
  requireReadable('engine/pikafish', true),
  requireReadable('engine/pikafish-jieqi', true),
  requireReadable('engine/rapfi', true),
  requireReadable('engine/pikafish.nnue'),
  requireReadable('engine/config.toml'),
])
process.stdout.write(
  `${JSON.stringify({
    ok: true,
    deployment: platform.versions.deployment,
    node: platform.versions.node,
    publicOnline: platform.publicOnlineEnabled,
    databaseSchemaRequired: 4,
  })}\n`,
)
