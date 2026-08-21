import assert from 'node:assert/strict'
import test from 'node:test'

import { settleVerifiedPaidEvent } from './checkout.ts'
import { normalizeIdentity } from './identity.ts'
import { completeListingMetadata } from './listing-metadata.ts'
import { amountToClaim, dollarsToCents, takeoverPrice } from './money.ts'
import { canRaiseListing, signOwnerCookie, verifyOwnerCookie } from './owner.ts'
import { projectedRank, rankListings } from './ranking.ts'
import { planReserveCheckout } from './reservation.ts'
import type { IntentRecord, ListingRecord } from './records.ts'
import { planPaidSettlement, planRefundSettlement } from './settlement.ts'
import { buildPublicStats } from './stats.ts'

const listings = [
  { id: 'b', amountCents: 10_000, settledAt: '2026-01-02T00:00:00Z' },
  { id: 'a', amountCents: 10_000, settledAt: '2026-01-01T00:00:00Z' },
  { id: 'c', amountCents: 5_000, settledAt: '2026-01-03T00:00:00Z' },
]

const identity = {
  canonicalKey: 'url:example.com',
  display: 'example.com',
  targetUrl: 'https://example.com/',
}

function listing(overrides: Partial<ListingRecord> = {}): ListingRecord {
  return {
    id: 'listing_1',
    ownerId: 'owner_1',
    canonicalIdentity: identity.canonicalKey,
    displayName: identity.display,
    targetUrl: identity.targetUrl,
    description: '',
    imageUrl: null,
    principalPaidCents: 10_000,
    principalRefundedCents: 0,
    settledAt: '2026-08-21T00:00:00.000Z',
    ...overrides,
  }
}

function intent(overrides: Partial<IntentRecord> = {}): IntentRecord {
  return {
    id: 'intent_1',
    ownerId: 'owner_1',
    listingId: null,
    requestId: 'req_1',
    payloadHash: 'hash_1',
    canonicalIdentity: identity.canonicalKey,
    targetAmountCents: 10_000,
    kind: 'rank',
    state: 'awaiting-payment',
    providerCheckoutId: 'cs_1',
    expiresAt: '2026-08-21T01:00:00.000Z',
    listingTitle: 'Example',
    listingDescription: 'A product',
    listingImageUrl: null,
    ...overrides,
  }
}

test('money stays in integer cents and takeover is exactly 2x', () => {
  assert.equal(dollarsToCents(10_001), 1_000_100)
  assert.equal(amountToClaim(310_000), 310_100)
  assert.equal(takeoverPrice(1_000_000), 2_000_000)
})

test('ranking is deterministic and previews equal amounts behind settled bids', () => {
  assert.deepEqual(rankListings(listings).map(({ id }) => id), ['a', 'b', 'c'])
  assert.equal(projectedRank(10_001, listings), 1)
  assert.equal(projectedRank(10_000, listings), 3)
})

test('identity normalization accepts public URLs and handles, rejects invite and script URLs', () => {
  const handle = normalizeIdentity('@YouBid')
  assert.equal(handle.ok && handle.identity.canonicalKey, 'x:youbid')
  const url = normalizeIdentity('https://www.example.com/launch/?utm_source=test&ref=1')
  assert.equal(url.ok && url.identity.canonicalKey, 'url:example.com/launch')
  assert.equal(normalizeIdentity('javascript:alert(1)').ok, false)
  assert.equal(normalizeIdentity('https://t.me/spam').ok, false)
  assert.equal(normalizeIdentity('https://discord.gg/invite').ok, false)
  const bare = normalizeIdentity('YouBid')
  assert.equal(bare.ok && bare.identity.canonicalKey, 'x:youbid')
  const xUrl = normalizeIdentity('https://x.com/YouBid')
  assert.equal(xUrl.ok && xUrl.identity.canonicalKey, 'x:youbid')
  const twitter = normalizeIdentity('twitter.com/YouBid')
  assert.equal(twitter.ok && twitter.identity.canonicalKey, 'x:youbid')
})

test('missing listing metadata requires title and description', () => {
  const missing = completeListingMetadata({ title: '', description: '', imageUrl: null }, null)
  assert.equal(missing.ok, false)
  if (!missing.ok) assert.deepEqual(missing.missing, ['title', 'description'])

  const handleNeedsCopy = completeListingMetadata(
    { title: '', description: '', imageUrl: null },
    { title: '@youbid', description: '', imageUrl: null },
  )
  assert.equal(handleNeedsCopy.ok, false)

  const filled = completeListingMetadata(
    { title: 'Youbid', description: 'Paid leaderboard', imageUrl: 'https://example.com/a.png' },
    null,
  )
  assert.equal(filled.ok, true)
  if (filled.ok) {
    assert.equal(filled.metadata.title, 'Youbid')
    assert.equal(filled.metadata.description, 'Paid leaderboard')
  }

  const raiseKeepsExisting = completeListingMetadata(
    { title: '', description: '', imageUrl: null },
    { title: 'Kept', description: 'Existing listing', imageUrl: null },
  )
  assert.equal(raiseKeepsExisting.ok, true)
  if (raiseKeepsExisting.ok) assert.equal(raiseKeepsExisting.metadata.title, 'Kept')
})

test('verified settlement is idempotent and conflicting replays are quarantined', () => {
  const initial = {
    status: 'awaiting-payment' as const,
    receipts: [],
    paidAmountCents: 0,
  }
  const event = {
    eventId: 'evt_1',
    payloadHash: 'sha256:one',
    amountCents: 42_000,
    takeover: false,
  }
  const settled = settleVerifiedPaidEvent(initial, event)
  assert.equal(settled.kind, 'settled')
  assert.equal(settled.state.status, 'ranked')
  assert.equal(settleVerifiedPaidEvent(settled.state, event).kind, 'replay')
  const conflict = settleVerifiedPaidEvent(settled.state, {
    ...event,
    payloadHash: 'sha256:different',
  })
  assert.equal(conflict.kind, 'conflict')
  assert.equal(conflict.state.status, 'needs-support')
})

test('reservation is idempotent, blocks foreign raises, and recovers uncertain checkouts', () => {
  const base = {
    nowIso: '2026-08-21T00:30:00.000Z',
    ownerId: 'owner_1',
    requestId: 'req_1',
    payloadHash: 'hash_1',
    identity,
    targetAmountCents: 10_000,
    kind: 'rank' as const,
    existingByRequest: null,
    listingByIdentity: null,
    openTopUpForListing: null,
    activeTakeover: null,
    leaderAmountCents: 5_000,
    listingTitle: 'Example',
    listingDescription: 'A product',
    listingImageUrl: null,
  }
  const created = planReserveCheckout(base, {
    intentId: 'intent_new',
    expiresAt: '2026-08-21T01:00:00.000Z',
  })
  assert.equal(created.kind, 'create')

  const reused = planReserveCheckout(
    { ...base, existingByRequest: intent() },
    { intentId: 'ignored', expiresAt: '2026-08-21T01:00:00.000Z' },
  )
  assert.equal(reused.kind, 'reuse')

  const recovered = planReserveCheckout(
    { ...base, existingByRequest: intent({ state: 'checkout-uncertain', providerCheckoutId: null }) },
    { intentId: 'ignored', expiresAt: '2026-08-21T01:00:00.000Z' },
  )
  assert.equal(recovered.kind, 'recover')

  const foreign = planReserveCheckout(
    { ...base, ownerId: 'owner_2', listingByIdentity: listing() },
    { intentId: 'intent_x', expiresAt: '2026-08-21T01:00:00.000Z' },
  )
  assert.equal(foreign.kind, 'reject')
  if (foreign.kind === 'reject') assert.equal(foreign.status, 409)
})

test('paid settlement writes absolute rank and treats webhook replay as a no-op', () => {
  const event = {
    eventId: 'evt_paid',
    payloadHash: 'hash_paid',
    eventType: 'checkout.session.completed',
    providerOrderId: 'pi_1',
    intentId: 'intent_1',
    principalPaidCents: 10_000,
    principalRefundedCents: 0,
    occurredAt: '2026-08-21T00:40:00.000Z',
  }
  const first = planPaidSettlement(
    {
      receipts: [],
      intent: intent({ listingId: null, targetAmountCents: 10_000 }),
      listing: null,
      orders: [],
      activeTakeover: null,
      identity,
    },
    event,
    { listingId: 'listing_new', takeoverId: 'lease_1' },
  )
  assert.equal(first.kind, 'settle')
  if (first.kind !== 'settle') return
  assert.equal(first.writes.listing?.principalPaidCents, 10_000)
  assert.equal(first.writes.receiptStatus, 'ranked')

  const replay = planPaidSettlement(
    {
      receipts: [{ eventId: event.eventId, payloadHash: event.payloadHash }],
      intent: intent({ state: 'paid', listingId: 'listing_new' }),
      listing: listing({ id: 'listing_new' }),
      orders: [],
      activeTakeover: null,
      identity,
    },
    event,
    { listingId: 'listing_new', takeoverId: 'lease_1' },
  )
  assert.equal(replay.kind, 'replay')
})

test('top-up settlement applies the absolute target, not the charged delta', () => {
  const event = {
    eventId: 'evt_raise',
    payloadHash: 'hash_raise',
    eventType: 'checkout.session.completed',
    providerOrderId: 'pi_2',
    intentId: 'intent_2',
    principalPaidCents: 5_000,
    principalRefundedCents: 0,
    occurredAt: '2026-08-21T00:50:00.000Z',
  }
  const plan = planPaidSettlement(
    {
      receipts: [],
      intent: intent({
        id: 'intent_2',
        listingId: 'listing_1',
        targetAmountCents: 15_000,
        requestId: 'req_2',
      }),
      listing: listing(),
      orders: [
        {
          providerOrderId: 'pi_1',
          intentId: 'intent_1',
          providerStatus: 'paid',
          principalPaidCents: 10_000,
          principalRefundedCents: 0,
          snapshotHash: 'hash_paid',
          occurredAt: '2026-08-21T00:40:00.000Z',
        },
      ],
      activeTakeover: null,
      identity,
    },
    event,
    { listingId: 'listing_1', takeoverId: 'lease_x' },
  )
  assert.equal(plan.kind, 'settle')
  if (plan.kind !== 'settle') return
  assert.equal(plan.writes.listing?.principalPaidCents, 15_000)
  assert.equal(plan.writes.listing?.principalRefundedCents, 0)
})

test('late takeover payment does not create a second active lease', () => {
  const plan = planPaidSettlement(
    {
      receipts: [],
      intent: intent({ kind: 'takeover', targetAmountCents: 20_000 }),
      listing: null,
      orders: [],
      activeTakeover: {
        id: 'lease_live',
        intentId: 'intent_other',
        listingId: 'listing_other',
        startsAt: '2026-08-21T00:00:00.000Z',
        endsAt: '2026-08-21T03:00:00.000Z',
        status: 'active',
      },
      identity,
    },
    {
      eventId: 'evt_late',
      payloadHash: 'hash_late',
      eventType: 'checkout.session.completed',
      providerOrderId: 'pi_late',
      intentId: 'intent_1',
      principalPaidCents: 20_000,
      principalRefundedCents: 0,
      occurredAt: '2026-08-21T00:40:00.000Z',
    },
    { listingId: 'listing_new', takeoverId: 'lease_late' },
  )
  assert.equal(plan.kind, 'settle')
  if (plan.kind !== 'settle') return
  assert.equal(plan.writes.takeover?.status, 'needs-refund')
  assert.equal(plan.writes.receiptStatus, 'needs-support')
})

test('refund snapshots recompute contribution without inventing a delta', () => {
  const plan = planRefundSettlement(
    {
      receipts: [],
      intent: intent({ state: 'paid', listingId: 'listing_1' }),
      listing: listing({ principalPaidCents: 15_000 }),
      orders: [
        {
          providerOrderId: 'pi_2',
          intentId: 'intent_2',
          providerStatus: 'paid',
          principalPaidCents: 5_000,
          principalRefundedCents: 0,
          snapshotHash: 'hash_raise',
          occurredAt: '2026-08-21T00:50:00.000Z',
        },
        {
          providerOrderId: 'pi_1',
          intentId: 'intent_1',
          providerStatus: 'paid',
          principalPaidCents: 10_000,
          principalRefundedCents: 0,
          snapshotHash: 'hash_paid',
          occurredAt: '2026-08-21T00:40:00.000Z',
        },
      ],
      activeTakeover: null,
      identity,
    },
    {
      eventId: 'evt_refund',
      payloadHash: 'hash_refund',
      eventType: 'charge.refunded',
      providerOrderId: 'pi_2',
      principalPaidCents: 5_000,
      principalRefundedCents: 5_000,
      occurredAt: '2026-08-21T01:10:00.000Z',
    },
  )
  assert.equal(plan.kind, 'settle')
  if (plan.kind !== 'settle') return
  assert.equal(plan.writes.listing?.principalPaidCents, 15_000)
  assert.equal(plan.writes.listing?.principalRefundedCents, 5_000)
})

test('owner cookie verifies only the signed visitor token', async () => {
  assert.equal(canRaiseListing('owner_1', { ownerId: 'owner_1' }), true)
  assert.equal(canRaiseListing('owner_2', { ownerId: 'owner_1' }), false)
  const cookie = await signOwnerCookie({ ownerId: 'owner_1', token: 'tok_1' }, 'secret')
  const verified = await verifyOwnerCookie(cookie, 'secret')
  assert.deepEqual(verified, { ownerId: 'owner_1', token: 'tok_1' })
  assert.equal(await verifyOwnerCookie(cookie, 'other'), null)
})

test('public stats expose only board facts and hide owner tokens', () => {
  const stats = buildPublicStats({
    nowIso: '2026-08-21T02:00:00.000Z',
    listings: [listing(), listing({ id: 'listing_2', displayName: 'other.com', principalPaidCents: 4_000, settledAt: '2026-08-21T01:00:00.000Z' })],
    takeover: null,
    takeoverDisplay: null,
    visitorsOnline: 12,
    visitorsLastHour: 40,
    visitorsLast24h: 90,
    clicksLast24h: 7,
  })
  assert.equal(stats.listingsLive, 2)
  assert.equal(stats.firstPlaceCents, 10_000)
  assert.equal(stats.volumeLiveCents, 14_000)
  assert.equal(stats.recentSettlements[0]?.display, 'other.com')
  assert.equal(JSON.stringify(stats).includes('owner_1'), false)
})

test('an empty paid board stays empty', () => {
  assert.deepEqual(rankListings([]), [])
})
