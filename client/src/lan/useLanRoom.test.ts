import assert from 'node:assert/strict'
import test from 'node:test'
import { forgetLanRoom, getLanRecentRooms, getLanToken, saveLanToken } from './useLanRoom'

test('forgetLanRoom removes a cancelled room token, invite, and recent entry', () => {
  const previous = globalThis.localStorage
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  })
  try {
    const roomId = '11111111-1111-4111-8111-111111111111'
    saveLanToken(roomId, 'owner-token')
    localStorage.setItem(`xiangqi-lan-invite:${roomId}`, 'invite-token')
    localStorage.setItem(
      'xiangqi-lan-recent',
      JSON.stringify([
        { id: roomId, name: '已取消', variant: 'xiangqi', role: 'owner', updatedAt: 1 },
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: '保留',
          variant: 'xiangqi',
          role: 'spectator',
          updatedAt: 2,
        },
      ]),
    )

    forgetLanRoom(roomId)

    assert.equal(getLanToken(roomId), '')
    assert.equal(localStorage.getItem(`xiangqi-lan-invite:${roomId}`), null)
    assert.deepEqual(
      getLanRecentRooms().map((room) => room.name),
      ['保留'],
    )
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: previous,
    })
  }
})
