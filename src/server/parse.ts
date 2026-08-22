import { dollarsToCents, isValidBidCents } from '../domain/money.ts'
import type { ParsedCheckoutBody, ProductionBoundaryResult } from './contracts.ts'

export function parseCheckoutBody(raw: unknown): ProductionBoundaryResult<ParsedCheckoutBody> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, status: 400, message: 'Checkout body must be a JSON object.' }
  }
  const body = raw as Record<string, unknown>
  const requestId = asNonEmptyString(body.requestId)
  const identityInput = asNonEmptyString(body.identity ?? body.identityInput)
  if (!requestId) return { ok: false, status: 400, message: 'requestId is required.' }
  if (!identityInput) return { ok: false, status: 400, message: 'A product URL or @handle is required.' }

  const amountCents =
    typeof body.amountCents === 'number'
      ? body.amountCents
      : typeof body.amountDollars === 'number'
        ? dollarsToCents(body.amountDollars)
        : Number.NaN
  if (!isValidBidCents(amountCents)) {
    return { ok: false, status: 400, message: 'Bid in $0.50 steps, at least $0.50.' }
  }

  return {
    ok: true,
    value: {
      requestId,
      amountCents,
      identityInput,
      title: typeof body.title === 'string' ? body.title : '',
      description: typeof body.description === 'string' ? body.description : '',
      imageUrl: typeof body.imageUrl === 'string' ? body.imageUrl : null,
      takeover: body.takeover === true,
      turnstileToken: typeof body.turnstileToken === 'string' ? body.turnstileToken : '',
    },
  }
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
