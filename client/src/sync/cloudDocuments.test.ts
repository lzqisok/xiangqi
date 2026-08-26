import assert from 'node:assert/strict'
import test from 'node:test'

function storage() {
  const values = new Map<string, string>()
  return {
    values,
    api: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() {
        return values.size
      },
    } satisfies Storage,
  }
}

test('cloud sync isolates account caches and drops a previous account delayed response', async (t) => {
  const previousFetch = globalThis.fetch
  const previousWindow = globalThis.window
  const previousStorage = globalThis.localStorage
  const local = storage()
  const events = new EventTarget()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: Object.assign(events, { localStorage: local.api }),
  })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local.api })
  t.after(() => {
    globalThis.fetch = previousFetch
    Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow })
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: previousStorage,
    })
  })

  const sync = await import('./cloudDocuments')
  const first = '123e4567-e89b-42d3-a456-426614174001'
  const second = '123e4567-e89b-42d3-a456-426614174002'
  let release!: (response: Response) => void
  let markStarted!: () => void
  const started = new Promise<void>((resolve) => (markStarted = resolve))
  globalThis.fetch = () => {
    markStarted()
    return new Promise<Response>((resolve) => (release = resolve))
  }
  sync.configureCloudDocumentScope(first)
  sync.queueCloudUpsert('studies', 'study-a', { id: 'study-a' })
  await started
  sync.configureCloudDocumentScope(second)
  release(
    new Response(
      JSON.stringify({
        document: {
          id: '123e4567-e89b-42d3-a456-426614174010',
          ownerUserId: first,
          schemaVersion: 1,
          revision: 0,
          clientMutationId: 'completed',
          createdAt: 1,
          updatedAt: 1,
          payload: { id: 'study-a' },
        },
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    ),
  )
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(sync.scopedStorageKey('studies').includes(second), true)
  assert.equal(
    local.values.has(`xiangqi:user:${first}:sync-meta:studies`),
    false,
    'the delayed response must not repopulate the previous account cache',
  )
  sync.configureCloudDocumentScope(null)
})

test('cloud conflicts retain the local snapshot and retry from the server revision', async (t) => {
  const previousFetch = globalThis.fetch
  const previousWindow = globalThis.window
  const previousStorage = globalThis.localStorage
  const local = storage()
  const events = new EventTarget()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: Object.assign(events, { localStorage: local.api }),
  })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local.api })
  t.after(() => {
    globalThis.fetch = previousFetch
    Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow })
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: previousStorage,
    })
  })
  const sync = await import('./cloudDocuments')
  const userId = '123e4567-e89b-42d3-a456-426614174003'
  const documentId = '123e4567-e89b-42d3-a456-426614174020'
  sync.configureCloudDocumentScope(userId)
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        documents: [
          {
            id: documentId,
            ownerUserId: userId,
            schemaVersion: 1,
            revision: 2,
            clientMutationId: 'seed',
            createdAt: 1,
            updatedAt: 1,
            payload: { id: 'study-conflict', name: 'cloud' },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  await sync.pullCloudDocuments<{ id: string; name: string }>('studies', (item) => item.id)

  const conflict = new Promise<void>((resolve) => {
    globalThis.window.addEventListener('xiangqi-cloud-sync-status', (event) => {
      if ((event as CustomEvent<{ kind: string }>).detail.kind === 'conflict') resolve()
    })
  })
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'revision_conflict', currentRevision: 3 }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    })
  sync.queueCloudUpsert('studies', 'study-conflict', { id: 'study-conflict', name: 'local' })
  await conflict
  const pendingKey = `xiangqi:user:${userId}:sync-pending:studies`
  assert.equal(JSON.parse(local.values.get(pendingKey)!)['study-conflict'].payload.name, 'local')

  let expectedRevision: number | undefined
  globalThis.fetch = async (_input, init) => {
    expectedRevision = JSON.parse(String(init?.body)).expectedRevision
    return new Response(
      JSON.stringify({
        document: {
          id: documentId,
          ownerUserId: userId,
          schemaVersion: 1,
          revision: 4,
          clientMutationId: 'resolved',
          createdAt: 1,
          updatedAt: 2,
          payload: { id: 'study-conflict', name: 'local' },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }
  sync.resolveCloudConflict('studies', 'study-conflict', 'keep-local')
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(expectedRevision, 3)
  assert.deepEqual(JSON.parse(local.values.get(pendingKey)!), {})
  sync.configureCloudDocumentScope(null)
})

test('offline writes retry after account restoration and deletion conflicts remain deletions', async (t) => {
  const previousFetch = globalThis.fetch
  const previousWindow = globalThis.window
  const previousStorage = globalThis.localStorage
  const local = storage()
  const events = new EventTarget()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: Object.assign(events, { localStorage: local.api }),
  })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local.api })
  t.after(() => {
    globalThis.fetch = previousFetch
    Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow })
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: previousStorage,
    })
  })
  const sync = await import('./cloudDocuments')
  const userId = '123e4567-e89b-42d3-a456-426614174004'
  const documentId = '123e4567-e89b-42d3-a456-426614174030'
  const pendingKey = `xiangqi:user:${userId}:sync-pending:studies`
  sync.configureCloudDocumentScope(userId)

  const offline = new Promise<void>((resolve) => {
    globalThis.window.addEventListener('xiangqi-cloud-sync-status', (event) => {
      if ((event as CustomEvent<{ kind: string }>).detail.kind === 'offline') resolve()
    })
  })
  globalThis.fetch = async () => {
    throw new TypeError('offline')
  }
  sync.queueCloudUpsert('studies', 'study-offline', { id: 'study-offline', name: 'pending' })
  await offline
  assert.equal(JSON.parse(local.values.get(pendingKey)!)['study-offline'].payload.name, 'pending')

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        document: {
          id: documentId,
          ownerUserId: userId,
          schemaVersion: 1,
          revision: 0,
          clientMutationId: 'offline-retried',
          createdAt: 1,
          updatedAt: 1,
          payload: { id: 'study-offline', name: 'pending' },
        },
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    )
  sync.configureCloudDocumentScope(null)
  sync.configureCloudDocumentScope(userId)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(JSON.parse(local.values.get(pendingKey)!), {})

  const conflict = new Promise<void>((resolve) => {
    globalThis.window.addEventListener('xiangqi-cloud-sync-status', (event) => {
      if ((event as CustomEvent<{ kind: string }>).detail.kind === 'conflict') resolve()
    })
  })
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'revision_conflict', currentRevision: 1 }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    })
  sync.queueCloudDelete('studies', 'study-offline')
  await conflict
  assert.equal(JSON.parse(local.values.get(pendingKey)!)['study-offline'].operation, 'delete')

  let deletedRevision: string | null = null
  globalThis.fetch = async (input) => {
    deletedRevision = new URL(String(input), 'http://localhost').searchParams.get('revision')
    return new Response(undefined, { status: 204 })
  }
  sync.resolveCloudConflict('studies', 'study-offline', 'keep-local')
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(deletedRevision, '1')
  assert.deepEqual(JSON.parse(local.values.get(pendingKey)!), {})
  sync.configureCloudDocumentScope(null)
})
