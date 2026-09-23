export function validateServerUrl(value) {
  try {
    const url = new URL(value)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.pathname !== '/' || url.search || url.hash || !url.hostname || url.username || url.password || url.hostname.includes(':')) return null
    if (/^127\./.test(url.hostname) && url.hostname !== '127.0.0.1') return null
    return url.toString().replace(/\/$/, '')
  } catch { return null }
}

function ipv4(address) {
  const parts = address.split('.').map(Number)
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null
}

function networkTier(address) {
  const p = ipv4(address)
  if (!p) return null
  const [a, b, c] = p
  if (a === 192 && b === 168) return 1
  if (a === 10) return 2
  if (a === 172 && b >= 16 && b <= 31) return 3
  if (a === 0 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)) return null
  if ((a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113)) return null
  return 0
}

export function chooseServerUrl(override, interfaces) {
  if (override !== undefined) {
    const baseUrl = validateServerUrl(override)
    if (!baseUrl) throw new Error('SERVER_URL must be an absolute http(s) origin without path, query, or hash')
    const hostname = new URL(baseUrl).hostname
    const local = hostname === 'localhost' || hostname === '127.0.0.1'
    return { baseUrl, source: 'override', bind: local ? '127.0.0.1' : '0.0.0.0' }
  }
  const candidate = interfaces.filter((item) => (item.family === 'IPv4' || item.family === '4') && !item.internal).map((item) => ({ item, tier: networkTier(item.address) })).filter((entry) => entry.tier !== null).sort((a, b) => a.tier - b.tier)[0]?.item
  if (candidate) return { baseUrl: `http://${candidate.address}:5173`, source: 'network', bind: '0.0.0.0', warning: 'Sharing this address requires firewall/network access.' }
  return { baseUrl: 'http://localhost:5173', source: 'localhost', bind: '127.0.0.1', warning: 'No usable network interface found; sharing is local only.' }
}

export function buildWranglerArgs(choice) {
  return ['wrangler', 'dev', '--local', '--ip', choice.bind, '--port', '5173', '--var', `SERVER_URL:${choice.baseUrl}`]
}
