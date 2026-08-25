import { chmod, writeFile } from 'node:fs/promises'

const target = process.argv[2]
const raw = process.env.DATABASE_TOOL_URL
if (!target || !raw) throw new Error('option file target and DATABASE_TOOL_URL are required')
const url = new URL(raw)
if (url.protocol !== 'mysql:' || !url.username || !url.hostname || url.pathname === '/') {
  throw new Error('DATABASE_TOOL_URL must be a complete mysql:// URL')
}

const quote = (value) =>
  `"${decodeURIComponent(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
const lines = [
  '[client]',
  `host=${quote(url.hostname)}`,
  `port=${url.port || '3306'}`,
  `user=${quote(url.username)}`,
  `password=${quote(url.password)}`,
  'default-character-set=utf8mb4',
]
if (process.env.DATABASE_SSL_MODE === 'require') lines.push('ssl-mode=REQUIRED')
await writeFile(target, `${lines.join('\n')}\n`, { mode: 0o600 })
await chmod(target, 0o600)
process.stdout.write(decodeURIComponent(url.pathname.slice(1)))
