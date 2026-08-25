import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'

const origin = process.env.STAGING_ORIGIN
if (!origin) throw new Error('STAGING_ORIGIN is required')
const base = new URL(origin)
if (base.protocol !== 'https:' && process.env.ALLOW_HTTP_STAGING !== '1') {
  throw new Error('staging smoke requires HTTPS')
}

async function request(path, init = {}, expected = 200) {
  const response = await fetch(new URL(path, base), { redirect: 'manual', ...init })
  if (response.status !== expected) {
    throw new Error(`${path} returned ${response.status}; expected ${expected}`)
  }
  return response
}

const live = await request('/health/live')
if (live.headers.get('x-content-type-options') !== 'nosniff') {
  throw new Error('security headers are missing')
}
await request('/health/ready')
await request('/api/capabilities')
await request('/api/capabilities', { headers: { Origin: 'https://invalid.example' } }, 403)
if (base.protocol === 'https:' && process.env.STAGING_SKIP_HTTP_REDIRECT !== '1') {
  const insecure = new URL('/health/live', base)
  insecure.protocol = 'http:'
  const redirect = await fetch(insecure, { redirect: 'manual' })
  if (redirect.status !== 308 || !redirect.headers.get('location')?.startsWith(base.origin)) {
    throw new Error('HTTP endpoint did not return a safe 308 redirect')
  }
}

const email = process.env.STAGING_ACCOUNT_EMAIL
const password = process.env.STAGING_ACCOUNT_PASSWORD
if (!email || !password) throw new Error('isolated STAGING_ACCOUNT_EMAIL/PASSWORD are required')
const login = await request('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: base.origin },
  body: JSON.stringify({ email, password, deviceLabel: `release-smoke-${randomUUID()}` }),
})
const loginBody = await login.json()
const cookies = login.headers
  .getSetCookie()
  .map((value) => value.split(';', 1)[0])
  .join('; ')
if (!cookies || !loginBody.csrfToken)
  throw new Error('login did not establish Cookie and CSRF state')
const authenticatedHeaders = { Cookie: cookies, Origin: base.origin }
await request('/api/auth/session', { headers: authenticatedHeaders })
await request('/api/online/lobby', { headers: authenticatedHeaders })
await request('/api/me/matches?limit=5', { headers: authenticatedHeaders })

async function websocketProbe(path) {
  const target = new URL(path, base)
  target.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(target, { headers: { Cookie: cookies, Origin: base.origin } })
    const timeout = setTimeout(() => {
      socket.terminate()
      reject(new Error(`${path} WebSocket timed out`))
    }, 5_000)
    socket.once('open', () => socket.close(1000, 'smoke complete'))
    socket.once('close', () => {
      clearTimeout(timeout)
      resolve()
    })
    socket.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })
}
await websocketProbe('/ws')
await websocketProbe('/gomoku-ws')

process.stdout.write(`${JSON.stringify({ ok: true, origin: base.origin })}\n`)
