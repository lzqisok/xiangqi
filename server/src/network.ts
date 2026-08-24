import type { NetworkInterfaceInfo } from 'node:os'

const VIRTUAL_INTERFACE = /^(?:awdl|bridge|docker|gif|llw|lo|stf|tailscale|utun|vbox|vmnet)/i
const PRIMARY_INTERFACE = /^(?:en\d+|eth\d+|wlan\d+|wi-?fi)$/i

function interfacePriority(name: string): number {
  if (VIRTUAL_INTERFACE.test(name)) return 2
  if (PRIMARY_INTERFACE.test(name)) return 0
  return 1
}

export function isLoopbackAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase()
  if (normalized === '::1') return true
  const ipv4 = normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized
  const octets = ipv4.split('.')
  return (
    octets.length === 4 &&
    octets[0] === '127' &&
    octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  )
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase()
  if (!normalized) return false
  if (normalized.startsWith('[')) {
    const closingBracket = normalized.indexOf(']')
    const suffix = normalized.slice(closingBracket + 1)
    return (
      closingBracket > 0 &&
      normalized.slice(1, closingBracket) === '::1' &&
      (suffix === '' || /^:\d+$/.test(suffix))
    )
  }
  const [hostname, port, ...rest] = normalized.split(':')
  if (rest.length > 0 || (port !== undefined && !/^\d+$/.test(port))) return false
  return hostname === 'localhost' || isLoopbackAddress(hostname)
}

/**
 * 本机对局库包含揭棋裁判态。除了校验 TCP 来源和原始 Host，通过开发代理时
 * 还必须校验由受信 Vite 代理覆盖写入的原始客户端地址。
 */
export function isLocalGameLibraryRequest(
  remoteAddress: string,
  host: string,
  proxyClientAddress?: string,
): boolean {
  return (
    isLoopbackAddress(remoteAddress) &&
    isLoopbackHost(host) &&
    (proxyClientAddress === undefined || isLoopbackAddress(proxyClientAddress))
  )
}

export function listLanIPv4(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string[] {
  const candidates = Object.entries(interfaces).flatMap(([name, items]) =>
    (items || [])
      .filter((item) => item.family === 'IPv4' && !item.internal && item.address !== '0.0.0.0')
      .map((item) => ({ name, address: item.address })),
  )

  candidates.sort(
    (left, right) =>
      interfacePriority(left.name) - interfacePriority(right.name) ||
      left.name.localeCompare(right.name),
  )
  return [...new Set(candidates.map((item) => item.address))]
}
