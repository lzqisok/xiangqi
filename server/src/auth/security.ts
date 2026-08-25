import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { argon2id, hash, verify } from 'argon2'

export const PASSWORD_HASH_VERSION = 1
const ARGON2_OPTIONS = {
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
} as const

let dummyHash: Promise<string> | undefined

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid_email')
  const email = value.trim().normalize('NFKC').toLowerCase()
  if (email.length < 3 || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new Error('invalid_email')
  }
  return email
}

export function normalizeDisplayName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid_display_name')
  const displayName = value.trim().normalize('NFC')
  if ([...displayName].length < 2 || [...displayName].length > 20) {
    throw new Error('invalid_display_name')
  }
  return displayName
}

export function assertPassword(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('invalid_password')
  const bytes = Buffer.byteLength(value, 'utf8')
  if (bytes < 12 || bytes > 1024) throw new Error('invalid_password')
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS)
}

export async function verifyPassword(
  passwordHash: string | undefined,
  password: string,
): Promise<boolean> {
  const target =
    passwordHash ??
    (await (dummyHash ??= hash(randomBytes(32).toString('base64url'), ARGON2_OPTIONS)))
  try {
    const valid = await verify(target, password)
    return Boolean(passwordHash) && valid
  } catch {
    return false
  }
}

export function passwordNeedsUpgrade(passwordHash: string, version: number): boolean {
  return version !== PASSWORD_HASH_VERSION || !passwordHash.includes('m=19456,t=2,p=1')
}

export function createOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function tokenHash(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest()
}

export function tokenMatches(token: string, expected: Buffer): boolean {
  const actual = tokenHash(token)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function parseCookies(header: string | undefined): ReadonlyMap<string, string> {
  const cookies = new Map<string, string>()
  for (const segment of (header || '').split(';')) {
    const separator = segment.indexOf('=')
    if (separator < 1) continue
    const name = segment.slice(0, separator).trim()
    const value = segment.slice(separator + 1).trim()
    try {
      cookies.set(name, decodeURIComponent(value))
    } catch {
      continue
    }
  }
  return cookies
}

export function serializeCookie(
  name: string,
  value: string,
  options: { httpOnly?: boolean; secure?: boolean; maxAgeSeconds?: number },
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax']
  if (options.httpOnly) parts.push('HttpOnly')
  if (options.secure) parts.push('Secure')
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${options.maxAgeSeconds}`)
  return parts.join('; ')
}

type Bucket = { count: number; resetAt: number }

export class AuthRateLimiter {
  private readonly buckets = new Map<string, Bucket>()

  constructor(
    private readonly maximum = 5,
    private readonly windowMs = 15 * 60_000,
  ) {}

  consume(
    keys: readonly string[],
    now = Date.now(),
  ): { allowed: boolean; retryAfterSeconds: number } {
    let retryAfterSeconds = 0
    for (const key of keys) {
      const bucket = this.buckets.get(key)
      if (bucket && bucket.resetAt > now && bucket.count >= this.maximum) {
        retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil((bucket.resetAt - now) / 1000))
      }
    }
    if (retryAfterSeconds) return { allowed: false, retryAfterSeconds }
    for (const key of keys) {
      const current = this.buckets.get(key)
      const bucket =
        !current || current.resetAt <= now ? { count: 0, resetAt: now + this.windowMs } : current
      bucket.count++
      this.buckets.set(key, bucket)
    }
    return { allowed: true, retryAfterSeconds: 0 }
  }

  reset(keys: readonly string[]): void {
    for (const key of keys) this.buckets.delete(key)
  }
}
