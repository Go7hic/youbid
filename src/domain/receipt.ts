import type { CheckoutStatus } from './checkout.ts'
import { listingStanding } from './decay.ts'
import {
  intentIsExpired,
  type IntentRecord,
  type ListingRecord,
  type TakeoverRecord,
} from './records.ts'

export interface PublicReceipt {
  intentId: string
  status: CheckoutStatus
  display: string | null
  amountCents: number
  rank: number | null
  takeoverEndsAt: string | null
  listingId: string | null
}

export function buildPublicReceipt(input: {
  intent: IntentRecord
  listing: ListingRecord | null
  takeover: TakeoverRecord | null
  rank: number | null
  nowIso: string
}): PublicReceipt {
  const takeoverActive =
    input.intent.kind === 'takeover' &&
    input.intent.state === 'paid' &&
    input.takeover?.status === 'active' &&
    input.takeover.endsAt > input.nowIso

  const status: CheckoutStatus =
    input.intent.state === 'needs-support'
      ? 'needs-support'
      : input.intent.state === 'paid'
        ? takeoverActive
          ? 'takeover-active'
          : 'ranked'
        : intentIsExpired(input.intent, input.nowIso)
          ? 'expired'
          : 'awaiting-payment'

  return {
    intentId: input.intent.id,
    status,
    display: input.listing?.displayName ?? null,
    amountCents: input.listing ? listingStanding(input.listing, input.nowIso) : input.intent.targetAmountCents,
    rank: status === 'ranked' || status === 'takeover-active' ? input.rank : null,
    takeoverEndsAt: takeoverActive ? input.takeover?.endsAt ?? null : null,
    listingId: input.listing?.id ?? input.intent.listingId,
  }
}
