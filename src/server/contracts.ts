export interface ProductionConfig {
  appUrl?: string
  stripeSecretKey?: string
  stripeWebhookSecret?: string
  turnstileSecret?: string
  turnstileSiteKey?: string
  ownerCookieSecret?: string
}

export interface CheckoutRequest {
  requestId: string
  intentId: string
  amountCents: number
  canonicalIdentity: string
  takeover: boolean
  turnstileToken: string
}

export type ProductionBoundaryResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 401 | 409 | 501 | 503; message: string }

export interface PaidWebhookSnapshot {
  eventId: string
  payloadHash: string
  providerOrderId: string
  intentId: string
  principalPaidCents: number
  principalRefundedCents: number
  occurredAt: string
  eventType: string
}

export interface RefundWebhookSnapshot {
  eventId: string
  payloadHash: string
  providerOrderId: string
  principalPaidCents: number
  principalRefundedCents: number
  occurredAt: string
  eventType: string
}

export type StripeWebhookResult =
  | { kind: 'paid'; snapshot: PaidWebhookSnapshot }
  | { kind: 'refund'; snapshot: RefundWebhookSnapshot }
  | { kind: 'ignored'; eventId: string; payloadHash: string; eventType: string }

export interface ParsedCheckoutBody {
  requestId: string
  amountCents: number
  identityInput: string
  title: string
  description: string
  imageUrl: string | null
  takeover: boolean
  turnstileToken: string
}

export interface PublicCheckoutConfig {
  mode: 'mock' | 'stripe' | 'unavailable'
  turnstileSiteKey: string | null
}
