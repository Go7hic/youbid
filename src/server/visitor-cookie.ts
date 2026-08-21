import { getCookie, setCookie } from '@tanstack/react-start/server'

import { isLocalDevelopment } from './env.ts'

export const VISITOR_COOKIE = 'youbid_visitor'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// Counting rows would call one visitor refreshing the board a crowd. This key is a
// random id with no owner authority attached: it never grants a raise or a refund.
export function resolveVisitorKey(): string {
  const existing = getCookie(VISITOR_COOKIE)
  if (existing && UUID.test(existing)) return existing
  const next = crypto.randomUUID()
  setCookie(VISITOR_COOKIE, next, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: !isLocalDevelopment(),
    maxAge: 60 * 60 * 24 * 30,
  })
  return next
}
