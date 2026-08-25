import assert from 'node:assert/strict'
import test from 'node:test'
import { toAccountDto, toPublicMatchDto } from './dto.js'

test('repository entities are mapped through allowlisted public DTOs', () => {
  const account = toAccountDto({
    id: 'user-id',
    status: 'active',
    authEpoch: 7,
    displayName: '棋手',
    locale: 'zh-CN',
    createdAt: new Date(0),
    updatedAt: new Date(0),
  })
  assert.deepEqual(account, {
    id: 'user-id',
    status: 'active',
    displayName: '棋手',
    locale: 'zh-CN',
  })

  const serialized = JSON.stringify(
    toPublicMatchDto(
      {
        id: 'match-id',
        variant: 'jieqi',
        gomokuRule: null,
        matchmaking: false,
        visibility: 'public',
        phase: 'finished',
        status: 'red-wins',
        statusReason: 'resignation',
        revision: 2,
        createdByUserId: 'private-user-id',
        createdAt: new Date(0),
        updatedAt: new Date(1),
        startedAt: new Date(0),
        finishedAt: new Date(1),
        expiresAt: new Date(2),
      },
      {
        matchId: 'match-id',
        schemaVersion: 1,
        revision: 2,
        publicState: { turn: 'red' },
        refereeState: { completeHiddenLayout: 'secret-layout' },
        updatedAt: new Date(1),
      },
    ),
  )
  assert.equal(serialized.includes('secret-layout'), false)
  assert.equal(serialized.includes('private-user-id'), false)
})
