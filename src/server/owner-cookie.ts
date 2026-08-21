import { getCookie, setCookie } from '@tanstack/react-start/server'

import { hashOwnerToken, signOwnerCookie, verifyOwnerCookie } from '../domain/owner.ts'
import { ownerSigningSecret, readProductionConfig } from './env.ts'

export const OWNER_COOKIE = 'youbid_owner'

export interface ResolvedOwner {
  ownerId: string
  token: string
  tokenHash: string
  cookieValue: string
  created: boolean
}

export async function resolveOwner(request?: Request): Promise<ResolvedOwner | null> {
  const secret = ownerSigningSecret(readProductionConfig())
  if (!secret) return null
  const raw = request ? readCookie(request, OWNER_COOKIE) : getCookie(OWNER_COOKIE)
  if (raw) {
    const verified = await verifyOwnerCookie(raw, secret)
    if (verified) {
      return {
        ownerId: verified.ownerId,
        token: verified.token,
        tokenHash: await hashOwnerToken(verified.token),
        cookieValue: raw,
        created: false,
      }
    }
  }
  const ownerId = crypto.randomUUID()
  const token = hexRandom(32)
  const cookieValue = await signOwnerCookie({ ownerId, token }, secret)
  return {
    ownerId,
    token,
    tokenHash: await hashOwnerToken(token),
    cookieValue,
    created: true,
  }
}

export function attachOwnerCookie(response: Response, cookieValue: string, secure: boolean): Response {
  response.headers.append('Set-Cookie', serializeOwnerCookie(cookieValue, secure))
  return response
}

export function writeOwnerCookie(cookieValue: string, secure: boolean): void {
  setCookie(OWNER_COOKIE, cookieValue, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: 60 * 60 * 24 * 365,
  })
}

export function serializeOwnerCookie(cookieValue: string, secure: boolean): string {
  const parts = [
    `${OWNER_COOKIE}=${cookieValue}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${60 * 60 * 24 * 365}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('Cookie')
  if (!header) return undefined
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    if (trimmed.startsWith(`${name}=`)) return trimmed.slice(name.length + 1)
  }
  return undefined
}

function hexRandom(bytes: number): string {
  const values = new Uint8Array(bytes)
  crypto.getRandomValues(values)
  return [...values].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
