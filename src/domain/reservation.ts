import { listingStanding } from './decay.ts'
import type { ProductIdentity } from './identity.ts'
import { MINIMUM_BID_CENTS, takeoverIdleMs, takeoverPrice } from './money.ts'
import { canRaiseListing } from './owner.ts'
import {
  intentIsExpired,
  isOpenIntent,
  type IntentRecord,
  type ListingRecord,
  type PurchaseKind,
  type TakeoverRecord,
} from './records.ts'

export interface ReservationSnapshot {
  nowIso: string
  ownerId: string
  requestId: string
  payloadHash: string
  identity: ProductIdentity
  targetAmountCents: number
  kind: PurchaseKind
  existingByRequest: IntentRecord | null
  listingByIdentity: ListingRecord | null
  openTopUpForListing: IntentRecord | null
  activeTakeover: TakeoverRecord | null
  leaderAmountCents: number
  takeoverIdleSinceIso: string | null
  listingTitle: string
  listingDescription: string
  listingImageUrl: string | null
}

export type ReservationPlan =
  | { kind: 'settled'; intent: IntentRecord }
  | { kind: 'reuse'; intent: IntentRecord }
  | { kind: 'recover'; intent: IntentRecord }
  | {
      kind: 'create'
      intent: Omit<IntentRecord, 'providerCheckoutId'> & { providerCheckoutId: null }
    }
  | { kind: 'reject'; status: 400 | 409; message: string }

export function planReserveCheckout(
  snapshot: ReservationSnapshot,
  ids: { intentId: string; expiresAt: string },
): ReservationPlan {
  if (snapshot.targetAmountCents < MINIMUM_BID_CENTS || snapshot.targetAmountCents % 100 !== 0) {
    return { kind: 'reject', status: 400, message: 'Bid a whole-dollar amount of at least $2.' }
  }

  if (snapshot.kind === 'takeover') {
    const required = takeoverPrice(
      snapshot.leaderAmountCents,
      takeoverIdleMs(snapshot.nowIso, snapshot.takeoverIdleSinceIso),
    )
    if (snapshot.targetAmountCents < required) {
      return {
        kind: 'reject',
        status: 400,
        message: `A takeover must be at least ${required} cents.`,
      }
    }
  }

  const existing = snapshot.existingByRequest
  if (existing) {
    if (existing.payloadHash !== snapshot.payloadHash) {
      return { kind: 'reject', status: 409, message: 'This checkout request already exists with a different payload.' }
    }
    if (existing.state === 'paid') {
      return { kind: 'settled', intent: existing }
    }
    if (existing.state === 'checkout-uncertain' || existing.state === 'creating') {
      return { kind: 'recover', intent: existing }
    }
    if (existing.state === 'awaiting-payment' && !intentIsExpired(existing, snapshot.nowIso)) {
      return { kind: 'reuse', intent: existing }
    }
  }

  const listing = snapshot.listingByIdentity
  if (listing) {
    const current = listingStanding(listing, snapshot.nowIso)
    // A listing at or below the decay floor leaves the board, so its identity
    // becomes claimable again instead of staying locked to the previous owner.
    if (current > 0 && !canRaiseListing(snapshot.ownerId, listing)) {
      return { kind: 'reject', status: 409, message: 'Only the owning visitor can raise this listing.' }
    }
    if (snapshot.kind !== 'takeover' && snapshot.targetAmountCents <= current) {
      return { kind: 'reject', status: 400, message: 'Raise the bid above the listing’s current amount.' }
    }
    if (
      snapshot.openTopUpForListing &&
      snapshot.openTopUpForListing.requestId !== snapshot.requestId &&
      !intentIsExpired(snapshot.openTopUpForListing, snapshot.nowIso)
    ) {
      return { kind: 'reject', status: 409, message: 'This listing already has an open checkout.' }
    }
  }

  return {
    kind: 'create',
    intent: {
      id: ids.intentId,
      ownerId: snapshot.ownerId,
      listingId: listing?.id ?? null,
      requestId: snapshot.requestId,
      payloadHash: snapshot.payloadHash,
      canonicalIdentity: snapshot.identity.canonicalKey,
      targetAmountCents: snapshot.targetAmountCents,
      kind: snapshot.kind,
      state: 'creating',
      providerCheckoutId: null,
      expiresAt: ids.expiresAt,
      listingTitle: snapshot.listingTitle,
      listingDescription: snapshot.listingDescription,
      listingImageUrl: snapshot.listingImageUrl,
    },
  }
}

export function planMarkCheckoutReady(intent: IntentRecord, providerCheckoutId: string): IntentRecord {
  return { ...intent, state: 'awaiting-payment', providerCheckoutId }
}

export function planMarkCheckoutUncertain(intent: IntentRecord): IntentRecord {
  return { ...intent, state: 'checkout-uncertain' }
}

export { isOpenIntent }
