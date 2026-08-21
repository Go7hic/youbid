import type { ProductionBoundaryResult } from './contracts'

interface TurnstileResponse {
  success: boolean
  'error-codes'?: string[]
}

export async function verifyTurnstile(
  token: string,
  secret: string | undefined,
  remoteIp?: string,
): Promise<ProductionBoundaryResult<true>> {
  if (!secret) {
    return { ok: false, status: 503, message: 'Production Turnstile is not configured.' }
  }
  if (!token) return { ok: false, status: 400, message: 'Turnstile token is required.' }

  const form = new FormData()
  form.set('secret', secret)
  form.set('response', token)
  if (remoteIp) form.set('remoteip', remoteIp)
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  })
  const result = (await response.json()) as TurnstileResponse
  return result.success
    ? { ok: true, value: true }
    : {
        ok: false,
        status: 401,
        message: `Turnstile verification failed (${result['error-codes']?.join(', ') || 'unknown'}).`,
      }
}
