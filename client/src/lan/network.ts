let addressRequest: Promise<string[]> | null = null

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '::1' ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  )
}

export function replaceLoopbackHostname(value: string, addresses: string[]): string {
  const url = new URL(value)
  if (isLoopbackHostname(url.hostname) && addresses[0]) url.hostname = addresses[0]
  return url.toString()
}

async function loadLanAddresses(): Promise<string[]> {
  addressRequest ||= fetch('/api/network-info')
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = (await response.json()) as { addresses?: unknown }
      return Array.isArray(body.addresses)
        ? body.addresses.filter((item): item is string => typeof item === 'string')
        : []
    })
    .catch(() => {
      addressRequest = null
      return []
    })
  return addressRequest
}

export async function resolveLanShareUrl(value: string): Promise<string> {
  const url = new URL(value)
  if (!isLoopbackHostname(url.hostname)) return url.toString()
  return replaceLoopbackHostname(url.toString(), await loadLanAddresses())
}
