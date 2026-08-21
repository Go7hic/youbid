export interface ProductIdentity {
  canonicalKey: string
  display: string
  targetUrl: string
}

export type IdentityResult =
  | { ok: true; identity: ProductIdentity }
  | { ok: false; message: string }

const HANDLE_BODY = /^[a-zA-Z0-9_]{1,30}$/
const HANDLE_PATTERN = /^@([a-zA-Z0-9_]{1,30})$/
const X_HOSTS = new Set(['x.com', 'twitter.com'])
const X_RESERVED = new Set([
  'home',
  'explore',
  'search',
  'i',
  'settings',
  'compose',
  'intent',
  'share',
  'tos',
  'privacy',
  'login',
  'signup',
  'notifications',
  'messages',
])
const BLOCKED_HOSTS = new Set([
  't.me',
  'telegram.me',
  'telegram.dog',
  'discord.gg',
  'discord.com',
  'discordapp.com',
  'chat.whatsapp.com',
])

export function normalizeIdentity(rawValue: string): IdentityResult {
  const value = rawValue.trim()
  if (!value) return { ok: false, message: 'Add a product URL or @handle.' }

  const tagged = HANDLE_PATTERN.exec(value)
  if (tagged) return xIdentity(tagged[1])
  if (HANDLE_BODY.test(value) && !value.includes('.')) return xIdentity(value)

  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
  } catch {
    return { ok: false, message: 'Enter a valid public URL or @handle.' }
  }

  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) {
    return { ok: false, message: 'Enter a valid public http(s) URL.' }
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
  if (BLOCKED_HOSTS.has(hostname)) {
    return { ok: false, message: 'Invite links are not allowed. Use a product URL or @handle.' }
  }

  const xHandle = handleFromXUrl(hostname, url.pathname)
  if (xHandle) return xIdentity(xHandle)

  url.hash = ''
  url.search = ''
  url.hostname = hostname
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')
  url.pathname = path || '/'

  return {
    ok: true,
    identity: {
      canonicalKey: `url:${hostname}${path}`,
      display: hostname,
      targetUrl: url.toString(),
    },
  }
}

export function sponsoredUrl(targetUrl: string): string {
  const url = new URL(targetUrl)
  url.searchParams.set('utm_source', 'youbid')
  return url.toString()
}

function xIdentity(rawHandle: string): IdentityResult {
  const normalizedHandle = rawHandle.toLowerCase()
  return {
    ok: true,
    identity: {
      canonicalKey: `x:${normalizedHandle}`,
      display: `@${normalizedHandle}`,
      targetUrl: `https://x.com/${normalizedHandle}`,
    },
  }
}

function handleFromXUrl(hostname: string, pathname: string): string | null {
  if (!X_HOSTS.has(hostname)) return null
  const segment = pathname.split('/').filter(Boolean)[0]?.replace(/^@/, '') ?? ''
  if (!HANDLE_BODY.test(segment) || X_RESERVED.has(segment.toLowerCase())) return null
  return segment
}

export function identityFromCanonical(canonicalKey: string): ProductIdentity | null {
  const handle = /^x:([a-z0-9_]{1,30})$/.exec(canonicalKey)
  if (handle) {
    return {
      canonicalKey,
      display: `@${handle[1]}`,
      targetUrl: `https://x.com/${handle[1]}`,
    }
  }
  const urlMatch = /^url:([^/]+)(.*)$/.exec(canonicalKey)
  if (!urlMatch) return null
  const hostname = urlMatch[1]
  const path = urlMatch[2] ?? ''
  return {
    canonicalKey,
    display: hostname,
    targetUrl: `https://${hostname}${path || '/'}`,
  }
}
