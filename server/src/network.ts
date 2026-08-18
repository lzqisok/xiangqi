import type { NetworkInterfaceInfo } from 'node:os'

const VIRTUAL_INTERFACE = /^(?:awdl|bridge|docker|gif|llw|lo|stf|tailscale|utun|vbox|vmnet)/i
const PRIMARY_INTERFACE = /^(?:en\d+|eth\d+|wlan\d+|wi-?fi)$/i

function interfacePriority(name: string): number {
  if (VIRTUAL_INTERFACE.test(name)) return 2
  if (PRIMARY_INTERFACE.test(name)) return 0
  return 1
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
