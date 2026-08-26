import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const files = Object.fromEntries(
  await Promise.all(
    [
      'docs/online-api-ws-contract.md',
      'server/src/index.ts',
      'server/src/online/types.ts',
      'client/src/online/types.ts',
      'server/src/protocol.ts',
    ].map(async (path) => [path, await readFile(new URL(`../${path}`, import.meta.url), 'utf8')]),
  ),
)

const requireMarkers = (path, markers) => {
  for (const marker of markers) {
    assert.ok(files[path].includes(marker), `${path} is missing contract marker: ${marker}`)
  }
}

requireMarkers('docs/online-api-ws-contract.md', [
  'Contract-Version: 1',
  '/api/auth/session',
  '/api/online/lobby',
  '/api/me/matches',
  '/ws',
  '/gomoku-ws',
  'requestId',
  'revision',
  'clientMutationId',
  'capturedHidden',
])
requireMarkers('server/src/index.ts', [
  "app.use('/api/auth'",
  "app.use('/api/me'",
  "pathname === '/ws'",
  "pathname === '/gomoku-ws'",
])
requireMarkers('server/src/protocol.ts', ['requestId?: string', 'gameId?: string', "| 'stop'"])

const sharedOnlineFields = [
  'competitionMode',
  'clockPreset',
  'visibility',
  'revision',
  'role',
  'side',
  'capturedHidden',
  'disconnectDeadline',
  'previousMatchId',
]
for (const path of ['server/src/online/types.ts', 'client/src/online/types.ts']) {
  requireMarkers(path, sharedOnlineFields)
}

process.stdout.write('Online API/WebSocket contract markers are synchronized.\n')
