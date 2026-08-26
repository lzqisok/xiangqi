import assert from 'node:assert/strict'
import test from 'node:test'
import { configureGameAccountScope, listGamesWithSource } from './api'
import type { GameSummary } from '../types'

function summary(ownerUserId: string, id: string): GameSummary {
  return {
    id,
    ownerUserId,
    revision: 0,
    name: ownerUserId,
    mode: 'human-vs-human',
    config: {
      difficulty: 'medium',
      playerSide: 'red',
      aiRedDifficulty: 'medium',
      aiBlackDifficulty: 'medium',
    },
    status: 'playing',
    moveCount: 0,
    createdAt: 1,
    updatedAt: 1,
  }
}

test('game cache is isolated by account and only backs the active account offline', async (t) => {
  const previousFetch = globalThis.fetch
  const previousStorage = globalThis.localStorage
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  })
  t.after(() => {
    globalThis.fetch = previousFetch
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: previousStorage,
    })
    configureGameAccountScope(null)
  })

  const firstUser = '123e4567-e89b-42d3-a456-426614174001'
  const secondUser = '123e4567-e89b-42d3-a456-426614174002'
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ games: [summary(firstUser, 'game-first')], storage: 'cloud' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  configureGameAccountScope(firstUser)
  assert.equal((await listGamesWithSource()).games[0].ownerUserId, firstUser)

  configureGameAccountScope(secondUser)
  globalThis.fetch = async () => {
    throw new TypeError('offline')
  }
  await assert.rejects(listGamesWithSource(), /network_error/)

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ games: [summary(secondUser, 'game-second')], storage: 'cloud' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  assert.equal((await listGamesWithSource()).games[0].ownerUserId, secondUser)
  globalThis.fetch = async () => {
    throw new TypeError('offline')
  }
  const cached = await listGamesWithSource()
  assert.equal(cached.source, 'cache')
  assert.equal(cached.games[0].ownerUserId, secondUser)
})
