export interface OwnedListing {
  ownerId: string
}

export function canRaiseListing(ownerId: string, listing: OwnedListing): boolean {
  return ownerId === listing.ownerId
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function hashOwnerToken(token: string): Promise<string> {
  return sha256Hex(token)
}

export function encodeOwnerCookieValue(input: {
  ownerId: string
  token: string
  mac: string
}): string {
  return `v1.${input.ownerId}.${input.token}.${input.mac}`
}

export function parseOwnerCookieValue(
  raw: string,
): { ownerId: string; token: string; mac: string } | null {
  const parts = raw.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') return null
  const [, ownerId, token, mac] = parts
  if (!ownerId || !token || !mac) return null
  return { ownerId, token, mac }
}

export async function signOwnerCookie(
  input: { ownerId: string; token: string },
  secret: string,
): Promise<string> {
  const mac = await hmacSha256Hex(secret, `${input.ownerId}.${input.token}`)
  return encodeOwnerCookieValue({ ...input, mac })
}

export async function verifyOwnerCookie(
  raw: string,
  secret: string,
): Promise<{ ownerId: string; token: string } | null> {
  const parsed = parseOwnerCookieValue(raw)
  if (!parsed) return null
  const expected = await hmacSha256Hex(secret, `${parsed.ownerId}.${parsed.token}`)
  if (!timingSafeEqualHex(parsed.mac, expected)) return null
  return { ownerId: parsed.ownerId, token: parsed.token }
}

function timingSafeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return mismatch === 0
}
