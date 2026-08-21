import { settleVerifiedPaidEvent, type CheckoutStatus } from './checkout.ts'
import type { ProductIdentity } from './identity.ts'
import {
  listingContribution,
  sumOrderPrincipals,
  type IntentRecord,
  type ListingRecord,
  type ProviderOrderRecord,
  type ReceiptDisposition,
  type ReceiptRecord,
  type TakeoverRecord,
} from './records.ts'

export interface PaidEvent {
  eventId: string
  payloadHash: string
  eventType: string
  providerOrderId: string
  intentId: string
  principalPaidCents: number
  principalRefundedCents: number
  occurredAt: string
}

export interface RefundEvent {
  eventId: string
  payloadHash: string
  eventType: string
  providerOrderId: string
  principalPaidCents: number
  principalRefundedCents: number
  occurredAt: string
}

export interface SettlementSnapshot {
  receipts: readonly ReceiptRecord[]
  intent: IntentRecord | null
  listing: ListingRecord | null
  orders: readonly ProviderOrderRecord[]
  activeTakeover: TakeoverRecord | null
  identity: ProductIdentity | null
}

export interface SettlementWrites {
  receipt: {
    eventId: string
    payloadHash: string
    eventType: string
    providerOrderId: string | null
    disposition: ReceiptDisposition
  }
  intent?: Pick<IntentRecord, 'id' | 'state' | 'listingId'>
  order?: ProviderOrderRecord
  listing?: ListingRecord
  takeover?: TakeoverRecord
  receiptStatus: CheckoutStatus
}

export type SettlementPlan =
  | { kind: 'replay'; receiptStatus: CheckoutStatus }
  | { kind: 'quarantine'; writes: SettlementWrites }
  | { kind: 'ignore'; writes: SettlementWrites }
  | { kind: 'needs-support'; writes: SettlementWrites }
  | { kind: 'settle'; writes: SettlementWrites }

const THREE_HOURS_MS = 3 * 60 * 60 * 1000

export function planPaidSettlement(
  snapshot: SettlementSnapshot,
  event: PaidEvent,
  ids: { listingId: string; takeoverId: string },
): SettlementPlan {
  const receiptDecision = settleVerifiedPaidEvent(
    {
      status: 'awaiting-payment',
      receipts: snapshot.receipts,
      paidAmountCents: 0,
    },
    {
      eventId: event.eventId,
      payloadHash: event.payloadHash,
      amountCents: event.principalPaidCents,
      takeover: snapshot.intent?.kind === 'takeover',
    },
  )

  if (receiptDecision.kind === 'replay') {
    return {
      kind: 'replay',
      receiptStatus: snapshot.listing
        ? snapshot.intent?.kind === 'takeover'
          ? 'takeover-active'
          : 'ranked'
        : 'awaiting-payment',
    }
  }

  if (receiptDecision.kind === 'conflict') {
    return {
      kind: 'quarantine',
      writes: {
        receipt: {
          eventId: event.eventId,
          payloadHash: event.payloadHash,
          eventType: event.eventType,
          providerOrderId: event.providerOrderId,
          disposition: 'quarantined',
        },
        intent: snapshot.intent
          ? { id: snapshot.intent.id, state: 'needs-support', listingId: snapshot.intent.listingId }
          : undefined,
        receiptStatus: 'needs-support',
      },
    }
  }

  const intent = snapshot.intent
  if (!intent || intent.id !== event.intentId) {
    return {
      kind: 'needs-support',
      writes: {
        receipt: {
          eventId: event.eventId,
          payloadHash: event.payloadHash,
          eventType: event.eventType,
          providerOrderId: event.providerOrderId,
          disposition: 'settled',
        },
        receiptStatus: 'needs-support',
      },
    }
  }

  const currentContribution = snapshot.listing ? listingContribution(snapshot.listing) : 0
  const expectedCharge = intent.targetAmountCents - currentContribution
  if (event.principalPaidCents !== expectedCharge || event.principalRefundedCents !== 0) {
    return {
      kind: 'needs-support',
      writes: {
        receipt: {
          eventId: event.eventId,
          payloadHash: event.payloadHash,
          eventType: event.eventType,
          providerOrderId: event.providerOrderId,
          disposition: 'settled',
        },
        intent: { id: intent.id, state: 'needs-support', listingId: intent.listingId },
        receiptStatus: 'needs-support',
      },
    }
  }

  const listingId = snapshot.listing?.id ?? ids.listingId
  const identity = snapshot.identity
  if (!identity) {
    return {
      kind: 'needs-support',
      writes: {
        receipt: {
          eventId: event.eventId,
          payloadHash: event.payloadHash,
          eventType: event.eventType,
          providerOrderId: event.providerOrderId,
          disposition: 'settled',
        },
        intent: { id: intent.id, state: 'needs-support', listingId: intent.listingId },
        receiptStatus: 'needs-support',
      },
    }
  }

  const nextOrder: ProviderOrderRecord = {
    providerOrderId: event.providerOrderId,
    intentId: intent.id,
    providerStatus: 'paid',
    principalPaidCents: event.principalPaidCents,
    principalRefundedCents: 0,
    snapshotHash: event.payloadHash,
    occurredAt: event.occurredAt,
  }
  const totals = sumOrderPrincipals([...snapshot.orders.filter((order) => order.providerOrderId !== nextOrder.providerOrderId), nextOrder])
  const listing: ListingRecord = {
    id: listingId,
    ownerId: intent.ownerId,
    canonicalIdentity: identity.canonicalKey,
    displayName: intent.listingTitle || snapshot.listing?.displayName || identity.display,
    targetUrl: identity.targetUrl,
    description: intent.listingDescription || snapshot.listing?.description || '',
    imageUrl: intent.listingImageUrl || snapshot.listing?.imageUrl || null,
    principalPaidCents: totals.principalPaidCents,
    principalRefundedCents: totals.principalRefundedCents,
    settledAt: event.occurredAt,
  }

  const collidingTakeover = intent.kind === 'takeover' && snapshot.activeTakeover !== null
  const takeover: TakeoverRecord | undefined =
    intent.kind === 'takeover'
      ? {
          id: collidingTakeover ? ids.takeoverId : snapshot.activeTakeover?.id ?? ids.takeoverId,
          intentId: intent.id,
          listingId,
          startsAt: event.occurredAt,
          endsAt: new Date(Date.parse(event.occurredAt) + THREE_HOURS_MS).toISOString(),
          status: collidingTakeover ? 'needs-refund' : 'active',
        }
      : undefined

  return {
    kind: 'settle',
    writes: {
      receipt: {
        eventId: event.eventId,
        payloadHash: event.payloadHash,
        eventType: event.eventType,
        providerOrderId: event.providerOrderId,
        disposition: 'settled',
      },
      intent: {
        id: intent.id,
        state: collidingTakeover ? 'needs-support' : 'paid',
        listingId,
      },
      order: nextOrder,
      listing,
      takeover,
      receiptStatus: collidingTakeover ? 'needs-support' : intent.kind === 'takeover' ? 'takeover-active' : 'ranked',
    },
  }
}

export function planRefundSettlement(snapshot: SettlementSnapshot, event: RefundEvent): SettlementPlan {
  const receiptDecision = settleVerifiedPaidEvent(
    {
      status: 'ranked',
      receipts: snapshot.receipts,
      paidAmountCents: 0,
    },
    {
      eventId: event.eventId,
      payloadHash: event.payloadHash,
      amountCents: event.principalRefundedCents,
      takeover: false,
    },
  )

  if (receiptDecision.kind === 'replay') {
    return { kind: 'replay', receiptStatus: 'ranked' }
  }
  if (receiptDecision.kind === 'conflict') {
    return {
      kind: 'quarantine',
      writes: {
        receipt: {
          eventId: event.eventId,
          payloadHash: event.payloadHash,
          eventType: event.eventType,
          providerOrderId: event.providerOrderId,
          disposition: 'quarantined',
        },
        receiptStatus: 'needs-support',
      },
    }
  }

  const order = snapshot.orders.find((row) => row.providerOrderId === event.providerOrderId)
  if (!order || !snapshot.listing) {
    return {
      kind: 'needs-support',
      writes: {
        receipt: {
          eventId: event.eventId,
          payloadHash: event.payloadHash,
          eventType: event.eventType,
          providerOrderId: event.providerOrderId,
          disposition: 'settled',
        },
        receiptStatus: 'needs-support',
      },
    }
  }

  if (event.principalRefundedCents > event.principalPaidCents || event.principalPaidCents !== order.principalPaidCents) {
    return {
      kind: 'needs-support',
      writes: {
        receipt: {
          eventId: event.eventId,
          payloadHash: event.payloadHash,
          eventType: event.eventType,
          providerOrderId: event.providerOrderId,
          disposition: 'settled',
        },
        receiptStatus: 'needs-support',
      },
    }
  }

  const nextOrder: ProviderOrderRecord = {
    ...order,
    providerStatus: 'refunded',
    principalRefundedCents: event.principalRefundedCents,
    snapshotHash: event.payloadHash,
    occurredAt: event.occurredAt,
  }
  const totals = sumOrderPrincipals(
    snapshot.orders.map((row) => (row.providerOrderId === nextOrder.providerOrderId ? nextOrder : row)),
  )

  return {
    kind: 'settle',
    writes: {
      receipt: {
        eventId: event.eventId,
        payloadHash: event.payloadHash,
        eventType: event.eventType,
        providerOrderId: event.providerOrderId,
        disposition: 'settled',
      },
      order: nextOrder,
      listing: {
        ...snapshot.listing,
        principalPaidCents: totals.principalPaidCents,
        principalRefundedCents: totals.principalRefundedCents,
      },
      receiptStatus: 'ranked',
    },
  }
}

export function planIgnoredEvent(event: { eventId: string; payloadHash: string; eventType: string }): SettlementPlan {
  return {
    kind: 'ignore',
    writes: {
      receipt: {
        eventId: event.eventId,
        payloadHash: event.payloadHash,
        eventType: event.eventType,
        providerOrderId: null,
        disposition: 'ignored',
      },
      receiptStatus: 'awaiting-payment',
    },
  }
}
