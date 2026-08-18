import assert from 'node:assert/strict'
import test from 'node:test'
import { isLoopbackHostname, replaceLoopbackHostname } from './network'

test('LAN share URL replaces localhost while retaining the frontend port, path and query', () => {
  assert.equal(
    replaceLoopbackHostname('http://localhost:5173/?lan=1&room=abc', ['172.16.20.93']),
    'http://172.16.20.93:5173/?lan=1&room=abc',
  )
})

test('LAN share URL keeps an address already opened through the LAN', () => {
  assert.equal(
    replaceLoopbackHostname('http://192.168.1.9:5173/?lan=1', ['172.16.20.93']),
    'http://192.168.1.9:5173/?lan=1',
  )
})

test('LAN share URL recognizes IPv4 and IPv6 loopback hosts', () => {
  assert.equal(isLoopbackHostname('127.0.0.1'), true)
  assert.equal(isLoopbackHostname('[::1]'), true)
})
