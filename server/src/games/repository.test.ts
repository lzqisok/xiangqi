import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  GameRevisionConflictError,
  InvalidGameDataError,
  JsonGameRepository,
} from './repository.js'
import { StoredGameState } from './types.js'

const INITIAL_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'
const JIEQI_INITIAL_FEN =
  'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P5N2B2r2a2c2p5n2b2 0 1'
const JIEQI_HIDDEN_LAYOUT = 'rraabbnnccppppprraabbnnccppppp'

function initialState(): StoredGameState {
  return {
    f: INITIAL_FEN,
    t: { r: 'root', c: 'root', n: { root: { p: null, c: [] } } },
    s: 'playing',
  }
}

function initialJieqiState(): StoredGameState {
  return {
    f: JIEQI_INITIAL_FEN,
    j: JIEQI_HIDDEN_LAYOUT,
    t: { r: 'root', c: 'root', n: { root: { p: null, c: [] } } },
    s: 'playing',
  }
}

const config = {
  difficulty: 'medium' as const,
  playerSide: 'red' as const,
  aiRedDifficulty: 'medium' as const,
  aiBlackDifficulty: 'hard' as const,
}

test('JSON repository persists games and enforces revisions across concurrent writes', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-games-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new JsonGameRepository(directory)
  await repository.init()
  const created = await repository.create({ mode: 'human-vs-ai', config, state: initialState() })

  const results = await Promise.allSettled([
    repository.rename(created.id, 0, '第一局'),
    repository.rename(created.id, 0, '冲突局'),
  ])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  const rejected = results.find((result) => result.status === 'rejected')
  assert.ok(rejected?.status === 'rejected' && rejected.reason instanceof GameRevisionConflictError)
  await repository.flush()

  const reloaded = new JsonGameRepository(directory)
  await reloaded.init()
  assert.equal(reloaded.get(created.id).revision, 1)
  assert.equal(reloaded.list()[0].moveCount, 0)
  assert.equal(
    (
      JSON.parse(await readFile(path.join(directory, 'index.json'), 'utf8')) as {
        schemaVersion: number
      }
    ).schemaVersion,
    2,
  )
  assert.equal(
    (
      JSON.parse(await readFile(path.join(directory, `${created.id}.json`), 'utf8')) as {
        schemaVersion: number
      }
    ).schemaVersion,
    2,
  )
})

test('JSON repository restores the last valid backup when the main file is corrupt', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-games-backup-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new JsonGameRepository(directory)
  await repository.init()
  const created = await repository.create({ mode: 'human-vs-human', config, state: initialState() })
  await repository.rename(created.id, 0, '生成备份')
  await writeFile(path.join(directory, `${created.id}.json`), '{broken', 'utf8')

  const recovered = new JsonGameRepository(directory)
  await recovered.init()
  assert.equal(recovered.get(created.id).revision, 0)
  assert.equal(recovered.isAvailable(), true)
})

test('ordinary game exports never include Jieqi arbiter state or hidden identities', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-games-export-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = new JsonGameRepository(directory)
  await repository.init()
  const ordinary = await repository.create({
    mode: 'human-vs-ai',
    config,
    state: initialState(),
  })
  const jieqi = await repository.create({ mode: 'jieqi', config, state: initialJieqiState() })

  const allExport = repository.export()
  assert.deepEqual(
    allExport.games.map((game) => game.id),
    [ordinary.id],
  )
  assert.equal(JSON.stringify(allExport).includes(JIEQI_HIDDEN_LAYOUT), false)

  assert.throws(() => repository.export([ordinary.id, jieqi.id]), InvalidGameDataError)
  assert.throws(() => repository.export([jieqi.id]), InvalidGameDataError)

  const restoredDirectory = await mkdtemp(path.join(os.tmpdir(), 'xiangqi-games-import-'))
  t.after(() => rm(restoredDirectory, { recursive: true, force: true }))
  const restored = new JsonGameRepository(restoredDirectory)
  await restored.init()
  const importResult = await restored.import(allExport)
  assert.equal(importResult.imported.length, 1)
  assert.equal(importResult.imported[0].mode, 'human-vs-ai')
  await assert.rejects(
    restored.import({
      exportVersion: 2,
      exportedAt: Date.now(),
      games: [jieqi],
    }),
    InvalidGameDataError,
  )
})
