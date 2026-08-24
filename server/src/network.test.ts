import assert from 'node:assert/strict'
import test from 'node:test'
import type { NetworkInterfaceInfo } from 'node:os'
import {
  isLocalGameLibraryRequest,
  isLoopbackAddress,
  isLoopbackHost,
  listLanIPv4,
} from './network.js'

function address(
  value: string,
  family: 'IPv4' | 'IPv6' = 'IPv4',
  internal = false,
): NetworkInterfaceInfo {
  const base = {
    address: value,
    netmask: '255.255.255.0',
    mac: '00:00:00:00:00:00',
    internal,
    cidr: `${value}/24`,
  }
  return family === 'IPv4' ? { ...base, family } : { ...base, family, scopeid: 0 }
}

test('listLanIPv4 prefers physical interfaces and filters unusable addresses', () => {
  assert.deepEqual(
    listLanIPv4({
      utun0: [address('10.251.1.1')],
      lo0: [address('127.0.0.1', 'IPv4', true)],
      en0: [address('172.16.20.93'), address('fe80::1', 'IPv6')],
      bridge0: [address('192.168.64.1')],
    }),
    ['172.16.20.93', '192.168.64.1', '10.251.1.1'],
  )
})

test('listLanIPv4 removes duplicate addresses', () => {
  assert.deepEqual(listLanIPv4({ en0: [address('192.168.1.8')], en1: [address('192.168.1.8')] }), [
    '192.168.1.8',
  ])
})

test('local game library checks both socket address and original host', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true)
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true)
  assert.equal(isLoopbackAddress('::1'), true)
  assert.equal(isLoopbackAddress('192.168.1.8'), false)
  assert.equal(isLoopbackHost('localhost:5173'), true)
  assert.equal(isLoopbackHost('127.0.0.2:3001'), true)
  assert.equal(isLoopbackHost('[::1]:3001'), true)
  assert.equal(isLoopbackHost('192.168.1.8:5173'), false)
  assert.equal(isLoopbackHost('[::1].example.com'), false)
  assert.equal(isLoopbackHost('localhost.example.com:5173'), false)

  assert.equal(isLocalGameLibraryRequest('127.0.0.1', 'localhost:5173'), true)
  assert.equal(isLocalGameLibraryRequest('127.0.0.1', 'localhost:5173', '127.0.0.1'), true)
  assert.equal(isLocalGameLibraryRequest('127.0.0.1', 'localhost:5173', '192.168.1.8'), false)
  assert.equal(isLocalGameLibraryRequest('127.0.0.1', '192.168.1.8:5173'), false)
  assert.equal(isLocalGameLibraryRequest('192.168.1.8', 'localhost:3001'), false)
})
