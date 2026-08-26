import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearImportedLegacyData,
  loadLegacyImportJob,
  runLegacyImport,
  scanLegacyLocalData,
} from './localImport'
import { configureCloudDocumentScope } from './cloudDocuments'

function storage(entries: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(entries))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size
    },
  }
}

test('legacy scan reports categories without exposing or importing capability secrets', () => {
  const local = storage({
    'xiangqi.study-positions.v1': JSON.stringify([{ id: 'study-1' }]),
    'xiangqi.favorite-endgames.v1': JSON.stringify(['builtin-1', 'builtin-2']),
    'xiangqi.jieqi-seat-records.v1': JSON.stringify([{ recordId: 'private-1' }]),
    'xiangqi-lan-token:room-1': 'secret-seat-token',
    'xiangqi-lan-invite:room-1': 'secret-invite-token',
  })
  const result = scanLegacyLocalData(local)
  assert.equal(result.excludedCapabilityCount, 2)
  assert.equal(result.categories.find((item) => item.resource === 'studies')?.count, 1)
  assert.equal(result.categories.find((item) => item.resource === 'favorite-endgames')?.count, 2)
  assert.deepEqual(
    result.categories.find((item) => item.resource === 'jieqi-seat-records'),
    {
      resource: 'jieqi-seat-records',
      label: '揭棋席位私有备份',
      key: 'xiangqi.jieqi-seat-records.v1',
      count: 1,
      bytes: new Blob([JSON.stringify([{ recordId: 'private-1' }])]).size,
      selectable: false,
      reason: 'sensitive',
    },
  )
  assert.equal(JSON.stringify(result).includes('secret-seat-token'), false)
})

test('legacy scan handles empty storage and summarizes every supported legacy category', () => {
  assert.deepEqual(scanLegacyLocalData(storage()), {
    categories: [],
    excludedCapabilityCount: 0,
  })
  const local = storage({
    'xiangqi.study-positions.v1': '[]',
    'xiangqi.training-tasks.v1': '[]',
    'xiangqi.custom-endgames.v1': '[]',
    'xiangqi.favorite-endgames.v1': '[]',
    'xiangqi.jieqi-seat-records.v1': '[]',
    'gomoku-game-history-v1': '[]',
    xiangqi_recent_fens: '[]',
    xiangqi_engine_settings: '{}',
  })
  assert.equal(scanLegacyLocalData(local).categories.length, 8)
})

test('legacy scan isolates damaged data and cleanup only removes confirmed resource keys', () => {
  const local = storage({
    'xiangqi.study-positions.v1': '{broken',
    'xiangqi.training-tasks.v1': JSON.stringify([{ id: 'training-1' }]),
    'xiangqi-lan-token:room-1': 'keep-secret',
  })
  const result = scanLegacyLocalData(local)
  assert.equal(result.categories.find((item) => item.resource === 'studies')?.reason, 'damaged')
  clearImportedLegacyData(['training-tasks'], local)
  assert.equal(local.getItem('xiangqi.training-tasks.v1'), null)
  assert.equal(local.getItem('xiangqi.study-positions.v1'), '{broken')
  assert.equal(local.getItem('xiangqi-lan-token:room-1'), 'keep-secret')
})

test('legacy import keeps one stable import id across partial failure and retry', async (t) => {
  const previousFetch = globalThis.fetch
  const local = storage({
    'xiangqi.study-positions.v1': JSON.stringify([{ id: 'study-1' }]),
    'xiangqi.training-tasks.v1': JSON.stringify([{ id: 'training-1' }]),
  })
  const userId = '123e4567-e89b-42d3-a456-426614174050'
  configureCloudDocumentScope(userId)
  t.after(() => {
    globalThis.fetch = previousFetch
    configureCloudDocumentScope(null)
  })
  const mutationIds: string[] = []
  let failTraining = true
  globalThis.fetch = async (input, init) => {
    mutationIds.push(new Headers(init?.headers).get('X-Client-Mutation-Id') || '')
    if (failTraining && String(input).includes('training-tasks')) {
      return new Response(JSON.stringify({ error: 'invalid_import' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ documents: [{}] }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const first = await runLegacyImport(userId, ['studies', 'training-tasks'], local)
  assert.equal(first.status, 'partial')
  assert.equal(first.resources.studies, 'complete')
  assert.equal(first.resources['training-tasks'], 'failed')
  failTraining = false
  const retried = await runLegacyImport(userId, ['studies', 'training-tasks'], local)
  assert.equal(retried.status, 'complete')
  assert.equal(retried.importId, first.importId)
  assert.equal(mutationIds[1], mutationIds[2])
  assert.equal(loadLegacyImportJob(userId, local)?.status, 'complete')
})

test('legacy import progress is isolated when two accounts use the same device data', async (t) => {
  const previousFetch = globalThis.fetch
  const local = storage({ 'xiangqi.study-positions.v1': JSON.stringify([{ id: 'study-1' }]) })
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ documents: [{}] }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    })
  t.after(() => {
    globalThis.fetch = previousFetch
    configureCloudDocumentScope(null)
  })
  const first = '123e4567-e89b-42d3-a456-426614174051'
  const second = '123e4567-e89b-42d3-a456-426614174052'
  configureCloudDocumentScope(first)
  const firstJob = await runLegacyImport(first, ['studies'], local)
  configureCloudDocumentScope(second)
  const secondJob = await runLegacyImport(second, ['studies'], local)
  assert.notEqual(firstJob.importId, secondJob.importId)
  assert.equal(loadLegacyImportJob(first, local)?.status, 'complete')
  assert.equal(loadLegacyImportJob(second, local)?.status, 'complete')
})

test('legacy import completes when every importable category is selected', async (t) => {
  const previousFetch = globalThis.fetch
  const local = storage({
    'xiangqi.study-positions.v1': JSON.stringify([{ id: 'study-1' }]),
    'xiangqi.training-tasks.v1': JSON.stringify([{ id: 'training-1' }]),
    'xiangqi.custom-endgames.v1': JSON.stringify([{ id: 'endgame-1' }]),
    'xiangqi.favorite-endgames.v1': JSON.stringify(['builtin-1']),
    'gomoku-game-history-v1': JSON.stringify([{ id: 'gomoku-1' }]),
    xiangqi_recent_fens: JSON.stringify([{ fen: 'valid-placeholder' }]),
    xiangqi_engine_settings: JSON.stringify({ candidateCount: 3, engineThreads: 8 }),
  })
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ documents: [{}] }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    })
  t.after(() => {
    globalThis.fetch = previousFetch
    configureCloudDocumentScope(null)
  })
  const userId = '123e4567-e89b-42d3-a456-426614174053'
  configureCloudDocumentScope(userId)
  const selected = [
    'studies',
    'training-tasks',
    'custom-endgames',
    'favorite-endgames',
    'gomoku-history',
    'recent-fens',
    'account-settings',
  ] as const
  const result = await runLegacyImport(userId, [...selected], local)
  assert.equal(result.status, 'complete')
  assert.deepEqual(
    Object.values(result.resources),
    selected.map(() => 'complete'),
  )
})
