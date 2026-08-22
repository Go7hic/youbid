import assert from 'node:assert/strict'
import test from 'node:test'

import { boardPage } from './board.ts'
import { settleVerifiedPaidEvent } from './checkout.ts'
import { faviconUrlForTarget } from './favicon.ts'
import { normalizeIdentity } from './identity.ts'
import {
  DAILY_DECAY,
  DECAY_FLOOR_CENTS,
  decayedBalance,
  decayedBalanceFromDropOff,
  dropsOffAt,
  listingStanding,
  toppedUpDropsOffAt,
} from './decay.ts'
import { completeListingMetadata } from './listing-metadata.ts'
import { TAKEOVER_FALL_MS, amountToClaim, dollarsToCents, formatUsd, takeoverIdleMs, takeoverPrice } from './money.ts'
import { canRaiseListing, signOwnerCookie, verifyOwnerCookie } from './owner.ts'
import { projectedRank, rankListings } from './ranking.ts'
import { buildPublicReceipt } from './receipt.ts'
import { planReserveCheckout } from './reservation.ts'
import type { IntentRecord, ListingRecord } from './records.ts'
import { planPaidSettlement, planRefundSettlement } from './settlement.ts'
import { buildPublicStats } from './stats.ts'

const listings = [
  { id: 'b', amountCents: 10_000, settledAt: '2026-01-02T00:00:00Z', dropsOffAt: '2026-06-02T00:00:00Z' },
  { id: 'a', amountCents: 10_000, settledAt: '2026-01-01T00:00:00Z', dropsOffAt: '2026-06-01T00:00:00Z' },
  { id: 'c', amountCents: 5_000, settledAt: '2026-01-03T00:00:00Z', dropsOffAt: '2026-05-01T00:00:00Z' },
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
    dropsOffAt: null,
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

test('money stays in integer cents', () => {
  assert.equal(dollarsToCents(10_001), 1_000_100)
  assert.equal(dollarsToCents(0.5), 50)
  assert.equal(amountToClaim(310_000), 310_050)
  assert.equal(amountToClaim(50), 100)
  assert.equal(formatUsd(50), '$0.50')
  assert.equal(formatUsd(200), '$2')
})

test('a takeover opens at 4x and falls to 1.2x over a day', () => {
  const leader = 10_000
  assert.equal(takeoverPrice(leader, 0), 40_000)
  assert.equal(takeoverPrice(leader, TAKEOVER_FALL_MS), 12_000)
  assert.equal(takeoverPrice(leader, TAKEOVER_FALL_MS / 2), 26_000)
  assert.equal(takeoverPrice(leader, TAKEOVER_FALL_MS * 2), 12_000)
  assert.ok(takeoverPrice(leader, TAKEOVER_FALL_MS / 4) > takeoverPrice(leader, TAKEOVER_FALL_MS / 2))
  assert.equal(takeoverPrice(0, 0), 50)
  assert.equal(takeoverIdleMs('2026-08-21T12:00:00.000Z', null), 0)
  assert.equal(takeoverIdleMs('2026-08-21T12:00:00.000Z', '2026-08-21T06:00:00.000Z'), 6 * 60 * 60 * 1000)
})

test('ranking is deterministic and previews equal amounts behind settled bids', () => {
  assert.deepEqual(rankListings(listings).map(({ id }) => id), ['b', 'a', 'c'])
  assert.equal(projectedRank(10_001, listings), 1)
  assert.equal(projectedRank(10_000, listings), 3)
})

test('decayed balance falls and drop-off order matches live balance order', () => {
  const settled = '2026-01-01T00:00:00.000Z'
  const later = '2026-02-01T00:00:00.000Z'
  const high = decayedBalance(10_000, settled, later)
  const low = decayedBalance(5_000, settled, later)
  assert.ok(high < 10_000)
  assert.ok(high > low)
  assert.ok(high > 0)
  assert.equal(decayedBalance(100, settled, later), 0)

  const now = '2026-03-01T00:00:00.000Z'
  const richer = dropsOffAt(20_000, settled)
  const poorer = dropsOffAt(8_000, settled)
  assert.ok(richer > poorer)
  const fromDrop = [
    { id: 'rich', amount: decayedBalanceFromDropOff(richer, now), t: richer },
    { id: 'poor', amount: decayedBalanceFromDropOff(poorer, now), t: poorer },
  ]
  const byAmount = [...fromDrop].sort((left, right) => right.amount - left.amount).map((row) => row.id)
  const byDrop = [...fromDrop].sort((left, right) => right.t.localeCompare(left.t)).map((row) => row.id)
  assert.deepEqual(byAmount, byDrop)

  const next = toppedUpDropsOffAt(poorer, 5_000, now)
  assert.ok(next > poorer)
  assert.ok(next > now)
  assert.equal(DAILY_DECAY, 0.97)
  assert.equal(DECAY_FLOOR_CENTS, 50)
})

test('a public URL uses favicon.so as the listing logo, not an og image host', () => {
  assert.equal(faviconUrlForTarget('https://cleer.deepzero.ai/'), 'https://favicon.so/cleer.deepzero.ai')
  assert.equal(faviconUrlForTarget('https://www.example.com/app'), 'https://favicon.so/example.com')
  assert.equal(faviconUrlForTarget('not-a-url'), null)
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
    takeoverIdleSinceIso: null,
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
  assert.ok(plan.writes.listing?.dropsOffAt)
})

test('a rank raise charges the decayed standing, not the historical ledger', () => {
  const settled = '2026-01-01T00:00:00.000Z'
  const now = '2026-01-11T00:00:00.000Z'
  const existing = listing({
    principalPaidCents: 10_000,
    settledAt: settled,
    dropsOffAt: dropsOffAt(10_000, settled),
  })
  const live = listingStanding(existing, now)
  assert.ok(live < 10_000)
  assert.ok(live >= DECAY_FLOOR_CENTS)

  const settle = planPaidSettlement(
    {
      receipts: [],
      intent: intent({
        id: 'intent_decay',
        listingId: 'listing_1',
        targetAmountCents: live + 100,
        requestId: 'req_decay',
      }),
      listing: existing,
      orders: [
        {
          providerOrderId: 'pi_old',
          intentId: 'intent_1',
          providerStatus: 'paid',
          principalPaidCents: 10_000,
          principalRefundedCents: 0,
          snapshotHash: 'hash_old',
          occurredAt: settled,
        },
      ],
      activeTakeover: null,
      identity,
    },
    {
      eventId: 'evt_decay',
      payloadHash: 'hash_decay',
      eventType: 'checkout.session.completed',
      providerOrderId: 'pi_decay',
      intentId: 'intent_decay',
      principalPaidCents: 100,
      principalRefundedCents: 0,
      occurredAt: now,
    },
    { listingId: 'listing_1', takeoverId: 'lease_x' },
  )
  assert.equal(settle.kind, 'settle')
  if (settle.kind !== 'settle') return
  assert.ok(settle.writes.listing?.dropsOffAt && settle.writes.listing.dropsOffAt > existing.dropsOffAt!)

  const staleLedger = planPaidSettlement(
    {
      receipts: [],
      intent: intent({
        id: 'intent_stale',
        listingId: 'listing_1',
        targetAmountCents: 15_000,
        requestId: 'req_stale',
      }),
      listing: existing,
      orders: [],
      activeTakeover: null,
      identity,
    },
    {
      eventId: 'evt_stale',
      payloadHash: 'hash_stale',
      eventType: 'checkout.session.completed',
      providerOrderId: 'pi_stale',
      intentId: 'intent_stale',
      principalPaidCents: 5_000,
      principalRefundedCents: 0,
      occurredAt: now,
    },
    { listingId: 'listing_1', takeoverId: 'lease_x' },
  )
  assert.equal(staleLedger.kind, 'needs-support')
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

test('a fully refunded listing releases its identity to the next bidder', () => {
  const refunded = listing({ principalPaidCents: 10_000, principalRefundedCents: 10_000 })
  const snapshot = {
    nowIso: '2026-08-21T02:00:00.000Z',
    ownerId: 'owner_2',
    requestId: 'req_9',
    payloadHash: 'hash_9',
    identity,
    targetAmountCents: 5_000,
    kind: 'rank' as const,
    existingByRequest: null,
    listingByIdentity: refunded,
    openTopUpForListing: null,
    activeTakeover: null,
    leaderAmountCents: 0,
    takeoverIdleSinceIso: null,
    listingTitle: 'Example',
    listingDescription: 'A product',
    listingImageUrl: null,
  }
  const plan = planReserveCheckout(snapshot, { intentId: 'intent_9', expiresAt: '2026-08-21T02:30:00.000Z' })
  assert.equal(plan.kind, 'create')

  const stillOwned = planReserveCheckout(
    { ...snapshot, listingByIdentity: listing({ principalPaidCents: 10_000, principalRefundedCents: 0 }) },
    { intentId: 'intent_10', expiresAt: '2026-08-21T02:30:00.000Z' },
  )
  assert.equal(stillOwned.kind, 'reject')
})

test('a takeover checkout is rejected below the live Dutch price', () => {
  const snapshot = {
    nowIso: '2026-08-21T12:00:00.000Z',
    ownerId: 'owner_1',
    requestId: 'req_takeover',
    payloadHash: 'hash_takeover',
    identity,
    targetAmountCents: 20_000,
    kind: 'takeover' as const,
    existingByRequest: null,
    listingByIdentity: null,
    openTopUpForListing: null,
    activeTakeover: null,
    leaderAmountCents: 10_000,
    takeoverIdleSinceIso: null,
    listingTitle: 'Example',
    listingDescription: 'A product',
    listingImageUrl: null,
  }
  const tooCheap = planReserveCheckout(snapshot, {
    intentId: 'intent_cheap',
    expiresAt: '2026-08-21T12:30:00.000Z',
  })
  assert.equal(tooCheap.kind, 'reject')

  const atOpen = planReserveCheckout(
    { ...snapshot, targetAmountCents: 40_000 },
    { intentId: 'intent_open', expiresAt: '2026-08-21T12:30:00.000Z' },
  )
  assert.equal(atOpen.kind, 'create')

  const afterADay = planReserveCheckout(
    {
      ...snapshot,
      nowIso: '2026-08-22T12:00:00.000Z',
      takeoverIdleSinceIso: '2026-08-21T12:00:00.000Z',
      targetAmountCents: 12_000,
    },
    { intentId: 'intent_floor', expiresAt: '2026-08-22T12:30:00.000Z' },
  )
  assert.equal(afterADay.kind, 'create')
})

test('replaying a paid checkout request returns the receipt instead of a new session', () => {
  const plan = planReserveCheckout(
    {
      nowIso: '2026-08-21T02:00:00.000Z',
      ownerId: 'owner_1',
      requestId: 'req_1',
      payloadHash: 'hash_1',
      identity,
      targetAmountCents: 10_000,
      kind: 'rank',
      existingByRequest: intent({ state: 'paid', listingId: 'listing_1' }),
      listingByIdentity: listing(),
      openTopUpForListing: null,
      activeTakeover: null,
      leaderAmountCents: 10_000,
      takeoverIdleSinceIso: null,
      listingTitle: 'Example',
      listingDescription: 'A product',
      listingImageUrl: null,
    },
    { intentId: 'intent_new', expiresAt: '2026-08-21T02:30:00.000Z' },
  )
  assert.equal(plan.kind, 'settled')
})

test('refunding a takeover releases the first-page lease', () => {
  const takeoverOrder = {
    providerOrderId: 'pi_takeover',
    intentId: 'intent_1',
    providerStatus: 'paid',
    principalPaidCents: 20_000,
    principalRefundedCents: 0,
    snapshotHash: 'hash_takeover',
    occurredAt: '2026-08-21T00:40:00.000Z',
  }
  const plan = planRefundSettlement(
    {
      receipts: [],
      intent: intent({ kind: 'takeover', state: 'paid', listingId: 'listing_1' }),
      listing: listing({ principalPaidCents: 20_000 }),
      orders: [takeoverOrder],
      activeTakeover: {
        id: 'lease_1',
        intentId: 'intent_1',
        listingId: 'listing_1',
        startsAt: '2026-08-21T00:40:00.000Z',
        endsAt: '2026-08-21T03:40:00.000Z',
        status: 'active',
      },
      identity,
    },
    {
      eventId: 'evt_takeover_refund',
      payloadHash: 'hash_takeover_refund',
      eventType: 'charge.refunded',
      providerOrderId: 'pi_takeover',
      principalPaidCents: 20_000,
      principalRefundedCents: 20_000,
      occurredAt: '2026-08-21T01:00:00.000Z',
    },
  )
  assert.equal(plan.kind, 'settle')
  if (plan.kind !== 'settle') return
  assert.equal(plan.writes.takeover?.id, 'lease_1')
  assert.equal(plan.writes.takeover?.status, 'ended')
})

test('a partial refund keeps the takeover lease running', () => {
  const plan = planRefundSettlement(
    {
      receipts: [],
      intent: intent({ kind: 'takeover', state: 'paid', listingId: 'listing_1' }),
      listing: listing({ principalPaidCents: 20_000 }),
      orders: [
        {
          providerOrderId: 'pi_takeover',
          intentId: 'intent_1',
          providerStatus: 'paid',
          principalPaidCents: 20_000,
          principalRefundedCents: 0,
          snapshotHash: 'hash_takeover',
          occurredAt: '2026-08-21T00:40:00.000Z',
        },
      ],
      activeTakeover: {
        id: 'lease_1',
        intentId: 'intent_1',
        listingId: 'listing_1',
        startsAt: '2026-08-21T00:40:00.000Z',
        endsAt: '2026-08-21T03:40:00.000Z',
        status: 'active',
      },
      identity,
    },
    {
      eventId: 'evt_partial',
      payloadHash: 'hash_partial',
      eventType: 'charge.refunded',
      providerOrderId: 'pi_takeover',
      principalPaidCents: 20_000,
      principalRefundedCents: 5_000,
      occurredAt: '2026-08-21T01:00:00.000Z',
    },
  )
  assert.equal(plan.kind, 'settle')
  if (plan.kind !== 'settle') return
  assert.equal(plan.writes.takeover, undefined)
})

test('an abandoned checkout reads as expired instead of waiting forever', () => {
  const expired = buildPublicReceipt({
    intent: intent({ state: 'awaiting-payment', expiresAt: '2026-08-21T01:00:00.000Z' }),
    listing: null,
    takeover: null,
    rank: null,
    nowIso: '2026-08-21T02:00:00.000Z',
  })
  assert.equal(expired.status, 'expired')

  const swept = buildPublicReceipt({
    intent: intent({ state: 'expired', expiresAt: '2026-08-21T01:00:00.000Z' }),
    listing: null,
    takeover: null,
    rank: null,
    nowIso: '2026-08-21T02:00:00.000Z',
  })
  assert.equal(swept.status, 'expired')

  const stillOpen = buildPublicReceipt({
    intent: intent({ state: 'awaiting-payment', expiresAt: '2026-08-21T03:00:00.000Z' }),
    listing: null,
    takeover: null,
    rank: null,
    nowIso: '2026-08-21T02:00:00.000Z',
  })
  assert.equal(stillOpen.status, 'awaiting-payment')
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
    nowIso: '2026-08-21T00:00:00.000Z',
    listings: [listing(), listing({ id: 'listing_2', displayName: 'other.com', principalPaidCents: 4_000, settledAt: '2026-08-21T00:01:00.000Z' })],
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

const takeoverSlot = {
  amountCents: 20_000,
  display: 'one.example',
  href: '/go/lst_one',
  endsAt: '2026-08-21T12:00:00.000Z',
}

test('an active takeover adds a page instead of hiding the leaderboard', () => {
  const listings = ['a', 'b', 'c']
  const first = boardPage({ listings, takeover: takeoverSlot, requestedPage: 1 })
  assert.equal(first.pageCount, 2)
  assert.deepEqual(first.takeover, takeoverSlot)
  assert.deepEqual(first.listings, [])

  const second = boardPage({ listings, takeover: takeoverSlot, requestedPage: 2 })
  assert.equal(second.pageCount, 2)
  assert.equal(second.takeover, null)
  assert.deepEqual(second.listings, ['a', 'b', 'c'])
  assert.equal(second.firstRank, 1)
})

test('takeover paging keeps rank numbering continuous across listing pages', () => {
  const listings = Array.from({ length: 120 }, (_, index) => index)
  const withTakeover = boardPage({ listings, takeover: takeoverSlot, requestedPage: 3 })
  assert.equal(withTakeover.pageCount, 4)
  assert.equal(withTakeover.firstRank, 51)
  assert.deepEqual(withTakeover.listings.slice(0, 1), [50])

  const withoutTakeover = boardPage({ listings, takeover: null, requestedPage: 2 })
  assert.equal(withoutTakeover.pageCount, 3)
  assert.equal(withoutTakeover.firstRank, 51)
  assert.deepEqual(withoutTakeover.listings.slice(0, 1), [50])
})

test('a requested page beyond the board clamps instead of rendering an empty board', () => {
  const clamped = boardPage({ listings: ['a'], takeover: null, requestedPage: 7 })
  assert.equal(clamped.page, 1)
  assert.deepEqual(clamped.listings, ['a'])
  assert.equal(boardPage({ listings: [], takeover: null, requestedPage: 1 }).pageCount, 1)
})
