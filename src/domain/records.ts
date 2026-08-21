export type IntentState =
  | 'creating'
  | 'checkout-uncertain'
  | 'awaiting-payment'
  | 'paid'
  | 'expired'
  | 'needs-support'

export type PurchaseKind = 'rank' | 'takeover'

export type ReceiptDisposition = 'settled' | 'replay' | 'quarantined' | 'ignored'

export type TakeoverStatus = 'active' | 'ended' | 'needs-refund'

export interface IntentRecord {
  id: string
  ownerId: string
  listingId: string | null
  requestId: string
  payloadHash: string
  canonicalIdentity: string
  targetAmountCents: number
  kind: PurchaseKind
  state: IntentState
  providerCheckoutId: string | null
  expiresAt: string
  listingTitle: string
  listingDescription: string
  listingImageUrl: string | null
}

export interface ListingRecord {
  id: string
  ownerId: string
  canonicalIdentity: string
  displayName: string
  targetUrl: string
  description: string
  imageUrl: string | null
  principalPaidCents: number
  principalRefundedCents: number
  settledAt: string | null
  dropsOffAt: string | null
}

export interface ProviderOrderRecord {
  providerOrderId: string
  intentId: string
  providerStatus: string
  principalPaidCents: number
  principalRefundedCents: number
  snapshotHash: string
  occurredAt: string
}

export interface ReceiptRecord {
  eventId: string
  payloadHash: string
}

export interface TakeoverRecord {
  id: string
  intentId: string
  listingId: string
  startsAt: string
  endsAt: string
  status: TakeoverStatus
}

export function listingContribution(listing: Pick<ListingRecord, 'principalPaidCents' | 'principalRefundedCents'>): number {
  return listing.principalPaidCents - listing.principalRefundedCents
}

export function sumOrderPrincipals(orders: readonly ProviderOrderRecord[]): {
  principalPaidCents: number
  principalRefundedCents: number
} {
  return orders.reduce(
    (totals, order) => ({
      principalPaidCents: totals.principalPaidCents + order.principalPaidCents,
      principalRefundedCents: totals.principalRefundedCents + order.principalRefundedCents,
    }),
    { principalPaidCents: 0, principalRefundedCents: 0 },
  )
}

export function isOpenIntent(state: IntentState): boolean {
  return state === 'creating' || state === 'checkout-uncertain' || state === 'awaiting-payment'
}

export function intentIsExpired(intent: Pick<IntentRecord, 'expiresAt' | 'state'>, nowIso: string): boolean {
  return intent.state !== 'paid' && intent.expiresAt <= nowIso
}
