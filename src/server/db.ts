import { identityFromCanonical, type ProductIdentity } from '../domain/identity.ts'
import { listingContribution, type IntentRecord, type ListingRecord, type ProviderOrderRecord, type ReceiptRecord, type TakeoverRecord } from '../domain/records.ts'
import type { ReservationSnapshot } from '../domain/reservation.ts'
import type { SettlementSnapshot, SettlementWrites } from '../domain/settlement.ts'
import { buildPublicStats, type PublicStatsSnapshot } from '../domain/stats.ts'
import { buildPublicReceipt, type PublicReceipt } from '../domain/receipt.ts'
import { publicTakeover, toPublicListing } from '../domain/board.ts'
import type { Listing } from '../data/listings.ts'
import { rankListings } from '../domain/ranking.ts'
import type { PurchaseKind } from '../domain/records.ts'

interface ListingRow {
  id: string
  owner_id: string
  canonical_identity: string
  display_name: string
  target_url: string
  description: string
  image_url: string | null
  principal_paid_cents: number
  principal_refunded_cents: number
  settled_at: string | null
}

interface IntentRow {
  id: string
  owner_id: string
  listing_id: string | null
  request_id: string
  payload_hash: string
  canonical_identity: string
  target_amount_cents: number
  kind: PurchaseKind
  state: IntentRecord['state']
  provider_checkout_id: string | null
  expires_at: string
  listing_title: string
  listing_description: string
  listing_image_url: string | null
}

interface OrderRow {
  provider_order_id: string
  intent_id: string
  provider_status: string
  principal_paid_cents: number
  principal_refunded_cents: number
  snapshot_hash: string
  occurred_at: string
}

interface ReceiptRow {
  provider_event_id: string
  payload_hash: string
}

interface TakeoverRow {
  id: string
  intent_id: string
  listing_id: string
  starts_at: string
  ends_at: string
  status: TakeoverRecord['status']
}

interface ClickCountRow {
  listing_id: string
  clicks: number
}

export async function expireOpenIntents(db: D1Database, nowIso: string): Promise<void> {
  await db
    .prepare(
      `UPDATE checkout_intents
       SET state = 'expired'
       WHERE state IN ('creating', 'checkout-uncertain', 'awaiting-payment')
         AND expires_at <= ?`,
    )
    .bind(nowIso)
    .run()
  await endExpiredTakeovers(db, nowIso)
}

/**
 * A lease past `ends_at` still occupies the `one_active_takeover` unique index,
 * so it must be swept before any path that reads or inserts an active lease.
 */
export async function endExpiredTakeovers(db: D1Database, nowIso: string): Promise<void> {
  await db
    .prepare(`UPDATE takeover_leases SET status = 'ended' WHERE status = 'active' AND ends_at <= ?`)
    .bind(nowIso)
    .run()
}

export async function ensureOwner(db: D1Database, owner: { ownerId: string; tokenHash: string }): Promise<void> {
  await db
    .prepare(`INSERT OR IGNORE INTO owners (id, token_hash) VALUES (?, ?)`)
    .bind(owner.ownerId, owner.tokenHash)
    .run()
}

export async function loadReservationSnapshot(
  db: D1Database,
  input: {
    nowIso: string
    ownerId: string
    requestId: string
    payloadHash: string
    identity: ProductIdentity
    targetAmountCents: number
    kind: PurchaseKind
    listingTitle: string
    listingDescription: string
    listingImageUrl: string | null
  },
): Promise<ReservationSnapshot> {
  const [existing, listing, open, takeover, leader] = await db.batch([
    db.prepare(`SELECT * FROM checkout_intents WHERE owner_id = ? AND request_id = ? LIMIT 1`).bind(input.ownerId, input.requestId),
    db.prepare(`SELECT * FROM listings WHERE canonical_identity = ? LIMIT 1`).bind(input.identity.canonicalKey),
    db
      .prepare(
        `SELECT * FROM checkout_intents
         WHERE listing_id = (SELECT id FROM listings WHERE canonical_identity = ?)
           AND state IN ('creating', 'checkout-uncertain', 'awaiting-payment')
         LIMIT 1`,
      )
      .bind(input.identity.canonicalKey),
    db.prepare(`SELECT * FROM takeover_leases WHERE status = 'active' AND ends_at > ? LIMIT 1`).bind(input.nowIso),
    db
      .prepare(
        `SELECT (principal_paid_cents - principal_refunded_cents) AS amount
         FROM listings
         WHERE principal_paid_cents > principal_refunded_cents
         ORDER BY (principal_paid_cents - principal_refunded_cents) DESC, settled_at ASC, id ASC
         LIMIT 1`,
      ),
  ])

  const listingRow = firstRow<ListingRow>(listing)
  return {
    nowIso: input.nowIso,
    ownerId: input.ownerId,
    requestId: input.requestId,
    payloadHash: input.payloadHash,
    identity: input.identity,
    targetAmountCents: input.targetAmountCents,
    kind: input.kind,
    existingByRequest: mapIntent(firstRow<IntentRow>(existing)),
    listingByIdentity: mapListing(listingRow),
    openTopUpForListing: mapIntent(firstRow<IntentRow>(open)),
    activeTakeover: mapTakeover(firstRow<TakeoverRow>(takeover)),
    leaderAmountCents: Number(firstRow<{ amount: number }>(leader)?.amount ?? 0),
    listingTitle: input.listingTitle,
    listingDescription: input.listingDescription,
    listingImageUrl: input.listingImageUrl,
  }
}

export async function insertIntent(db: D1Database, intent: IntentRecord): Promise<void> {
  await db
    .prepare(
      `INSERT INTO checkout_intents (
         id, owner_id, listing_id, request_id, payload_hash, canonical_identity,
         target_amount_cents, kind, state, provider_checkout_id, expires_at,
         listing_title, listing_description, listing_image_url
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      intent.id,
      intent.ownerId,
      intent.listingId,
      intent.requestId,
      intent.payloadHash,
      intent.canonicalIdentity,
      intent.targetAmountCents,
      intent.kind,
      intent.state,
      intent.providerCheckoutId,
      intent.expiresAt,
      intent.listingTitle,
      intent.listingDescription,
      intent.listingImageUrl,
    )
    .run()
}

export async function updateIntent(db: D1Database, intent: Pick<IntentRecord, 'id' | 'state' | 'providerCheckoutId' | 'listingId'>): Promise<void> {
  await db
    .prepare(`UPDATE checkout_intents SET state = ?, provider_checkout_id = ?, listing_id = ? WHERE id = ?`)
    .bind(intent.state, intent.providerCheckoutId, intent.listingId, intent.id)
    .run()
}

export async function loadSettlementSnapshot(db: D1Database, input: { eventId: string; nowIso: string; intentId?: string; providerOrderId?: string }): Promise<SettlementSnapshot> {
  const intent = input.intentId
    ? mapIntent(await db.prepare(`SELECT * FROM checkout_intents WHERE id = ? LIMIT 1`).bind(input.intentId).first<IntentRow>())
    : input.providerOrderId
      ? mapIntent(
          await db
            .prepare(
              `SELECT checkout_intents.* FROM checkout_intents
               JOIN provider_orders ON provider_orders.intent_id = checkout_intents.id
               WHERE provider_orders.provider_order_id = ?
               LIMIT 1`,
            )
            .bind(input.providerOrderId)
            .first<IntentRow>(),
        )
      : null

  const listingId = intent?.listingId ?? null
  const listing = listingId
    ? mapListing(await db.prepare(`SELECT * FROM listings WHERE id = ? LIMIT 1`).bind(listingId).first<ListingRow>())
    : intent
      ? mapListing(
          await db
            .prepare(`SELECT * FROM listings WHERE canonical_identity = ? LIMIT 1`)
            .bind(intent.canonicalIdentity)
            .first<ListingRow>(),
        )
      : null

  const [receipts, orders, takeover] = await db.batch([
    db.prepare(`SELECT provider_event_id, payload_hash FROM webhook_receipts WHERE provider_event_id = ?`).bind(input.eventId),
    intent
      ? db.prepare(`SELECT * FROM provider_orders WHERE intent_id IN (SELECT id FROM checkout_intents WHERE listing_id = ? OR id = ?)`).bind(listing?.id ?? intent.id, intent.id)
      : db.prepare(`SELECT * FROM provider_orders WHERE provider_order_id = ?`).bind(input.providerOrderId ?? ''),
    db.prepare(`SELECT * FROM takeover_leases WHERE status = 'active' AND ends_at > ? LIMIT 1`).bind(input.nowIso),
  ])

  return {
    receipts: (receipts.results as ReceiptRow[] | undefined)?.map(mapReceipt) ?? [],
    intent,
    listing,
    orders: (orders.results as OrderRow[] | undefined)?.map(mapOrder) ?? [],
    activeTakeover: mapTakeover(firstRow<TakeoverRow>(takeover)),
    identity: intent ? identityFromCanonical(intent.canonicalIdentity) : listing ? identityFromCanonical(listing.canonicalIdentity) : null,
  }
}

export async function applySettlement(db: D1Database, writes: SettlementWrites): Promise<void> {
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO webhook_receipts (provider_event_id, payload_hash, event_type, provider_order_id, disposition)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        writes.receipt.eventId,
        writes.receipt.payloadHash,
        writes.receipt.eventType,
        writes.receipt.providerOrderId,
        writes.receipt.disposition,
      ),
  ]

  if (writes.listing) {
    statements.push(
      db
        .prepare(
          `INSERT INTO listings (
             id, owner_id, canonical_identity, display_name, target_url, description, image_url,
             principal_paid_cents, principal_refunded_cents, settled_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             owner_id = excluded.owner_id,
             display_name = excluded.display_name,
             description = excluded.description,
             image_url = excluded.image_url,
             principal_paid_cents = excluded.principal_paid_cents,
             principal_refunded_cents = excluded.principal_refunded_cents,
             settled_at = excluded.settled_at`,
        )
        .bind(
          writes.listing.id,
          writes.listing.ownerId,
          writes.listing.canonicalIdentity,
          writes.listing.displayName,
          writes.listing.targetUrl,
          writes.listing.description,
          writes.listing.imageUrl,
          writes.listing.principalPaidCents,
          writes.listing.principalRefundedCents,
          writes.listing.settledAt,
        ),
    )
  }

  if (writes.order) {
    statements.push(
      db
        .prepare(
          `INSERT INTO provider_orders (
             provider_order_id, intent_id, provider_status, principal_paid_cents,
             principal_refunded_cents, snapshot_hash, occurred_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(provider_order_id) DO UPDATE SET
             provider_status = excluded.provider_status,
             principal_refunded_cents = excluded.principal_refunded_cents,
             snapshot_hash = excluded.snapshot_hash,
             occurred_at = excluded.occurred_at,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
        )
        .bind(
          writes.order.providerOrderId,
          writes.order.intentId,
          writes.order.providerStatus,
          writes.order.principalPaidCents,
          writes.order.principalRefundedCents,
          writes.order.snapshotHash,
          writes.order.occurredAt,
        ),
    )
  }

  if (writes.intent) {
    statements.push(
      db
        .prepare(`UPDATE checkout_intents SET state = ?, listing_id = ? WHERE id = ?`)
        .bind(writes.intent.state, writes.intent.listingId, writes.intent.id),
    )
  }

  if (writes.takeover) {
    statements.push(
      db
        .prepare(
          `INSERT INTO takeover_leases (id, intent_id, listing_id, starts_at, ends_at, status)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             ends_at = excluded.ends_at,
             status = excluded.status`,
        )
        .bind(
          writes.takeover.id,
          writes.takeover.intentId,
          writes.takeover.listingId,
          writes.takeover.startsAt,
          writes.takeover.endsAt,
          writes.takeover.status,
        ),
    )
  }

  await db.batch(statements)
}

export async function loadPublicBoard(
  db: D1Database,
  now: Date,
): Promise<{
  listings: Listing[]
  takeover: { amountCents: number; display: string; href: string; endsAt: string } | null
}> {
  const nowIso = now.toISOString()
  await expireOpenIntents(db, nowIso)
  const [listingResult, clickResult, takeoverResult] = await db.batch([
    db.prepare(
      `SELECT * FROM listings
       WHERE principal_paid_cents > principal_refunded_cents
       ORDER BY (principal_paid_cents - principal_refunded_cents) DESC, settled_at ASC, id ASC`,
    ),
    db.prepare(`SELECT listing_id, COUNT(*) AS clicks FROM click_facts GROUP BY listing_id`),
    db.prepare(`SELECT * FROM takeover_leases WHERE status = 'active' AND ends_at > ? LIMIT 1`).bind(nowIso),
  ])
  const clicks = new Map(
    ((clickResult.results as ClickCountRow[] | undefined) ?? []).map((row) => [row.listing_id, Number(row.clicks)]),
  )
  const paid = ((listingResult.results as ListingRow[] | undefined) ?? [])
    .map(mapListing)
    .filter((row): row is ListingRecord => row !== null)
    .map((row) => toPublicListing(row, clicks.get(row.id) ?? 0, now))
  const takeoverRow = mapTakeover(firstRow<TakeoverRow>(takeoverResult))
  const takeoverListing = takeoverRow
    ? ((listingResult.results as ListingRow[] | undefined) ?? []).map(mapListing).find((row) => row?.id === takeoverRow.listingId) ?? null
    : null
  return {
    listings: paid,
    takeover: publicTakeover(takeoverRow, takeoverListing, nowIso),
  }
}

export async function loadPublicStats(db: D1Database, now: Date): Promise<PublicStatsSnapshot> {
  const nowIso = now.toISOString()
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const onlineSince = new Date(now.getTime() - 5 * 60 * 1000).toISOString()
  await expireOpenIntents(db, nowIso)

  const [listings, takeover, online, hour, day, clicks] = await db.batch([
    db.prepare(`SELECT * FROM listings WHERE principal_paid_cents > principal_refunded_cents`),
    db.prepare(`SELECT * FROM takeover_leases WHERE status = 'active' AND ends_at > ? LIMIT 1`).bind(nowIso),
    db.prepare(`SELECT COUNT(*) AS count FROM traffic_facts WHERE kind = 'board' AND occurred_at >= ?`).bind(onlineSince),
    db.prepare(`SELECT COUNT(*) AS count FROM traffic_facts WHERE kind = 'board' AND occurred_at >= ?`).bind(hourAgo),
    db.prepare(`SELECT COUNT(*) AS count FROM traffic_facts WHERE kind = 'board' AND occurred_at >= ?`).bind(dayAgo),
    db.prepare(`SELECT COUNT(*) AS count FROM click_facts WHERE occurred_at >= ?`).bind(dayAgo),
  ])

  const listingRows = ((listings.results as ListingRow[] | undefined) ?? [])
    .map(mapListing)
    .filter((row): row is ListingRecord => row !== null)
  const takeoverRow = mapTakeover(firstRow<TakeoverRow>(takeover))
  const takeoverListing = takeoverRow ? listingRows.find((row) => row.id === takeoverRow.listingId) : undefined

  return buildPublicStats({
    nowIso,
    listings: listingRows,
    takeover: takeoverRow,
    takeoverDisplay: takeoverListing?.displayName ?? null,
    visitorsOnline: Number(firstRow<{ count: number }>(online)?.count ?? 0),
    visitorsLastHour: Number(firstRow<{ count: number }>(hour)?.count ?? 0),
    visitorsLast24h: Number(firstRow<{ count: number }>(day)?.count ?? 0),
    clicksLast24h: Number(firstRow<{ count: number }>(clicks)?.count ?? 0),
  })
}

export async function recordTraffic(db: D1Database, kind: 'board' | 'stats', countryCode: string | null): Promise<void> {
  await db
    .prepare(`INSERT INTO traffic_facts (id, kind, country_code) VALUES (?, ?, ?)`)
    .bind(crypto.randomUUID(), kind, sanitizeCountry(countryCode))
    .run()
}

export async function recordClick(
  db: D1Database,
  input: { listingId: string; referrerHost: string | null; countryCode: string | null },
): Promise<ListingRecord | null> {
  const listing = mapListing(await db.prepare(`SELECT * FROM listings WHERE id = ? LIMIT 1`).bind(input.listingId).first<ListingRow>())
  if (!listing || listingContribution(listing) <= 0) return null
  await db
    .prepare(`INSERT INTO click_facts (id, listing_id, referrer_host, country_code) VALUES (?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), listing.id, input.referrerHost, sanitizeCountry(input.countryCode))
    .run()
  return listing
}

export async function loadReceipt(db: D1Database, intentId: string, nowIso: string): Promise<PublicReceipt | null> {
  const intent = mapIntent(await db.prepare(`SELECT * FROM checkout_intents WHERE id = ? LIMIT 1`).bind(intentId).first<IntentRow>())
  if (!intent) return null
  const listing = intent.listingId
    ? mapListing(await db.prepare(`SELECT * FROM listings WHERE id = ? LIMIT 1`).bind(intent.listingId).first<ListingRow>())
    : mapListing(
        await db.prepare(`SELECT * FROM listings WHERE canonical_identity = ? LIMIT 1`).bind(intent.canonicalIdentity).first<ListingRow>(),
      )
  const takeover = mapTakeover(
    await db.prepare(`SELECT * FROM takeover_leases WHERE intent_id = ? LIMIT 1`).bind(intent.id).first<TakeoverRow>(),
  )
  const paid = listing
    ? ((
        await db
          .prepare(
            `SELECT id, (principal_paid_cents - principal_refunded_cents) AS amount, settled_at
             FROM listings
             WHERE principal_paid_cents > principal_refunded_cents`,
          )
          .all<{ id: string; amount: number; settled_at: string | null }>()
      ).results ?? [])
    : []
  const ranked = rankListings(
    paid.map((row) => ({
      id: row.id,
      amountCents: Number(row.amount),
      settledAt: row.settled_at ?? nowIso,
    })),
  )
  const rank = listing ? ranked.findIndex((row) => row.id === listing.id) + 1 : null
  return buildPublicReceipt({
    intent,
    listing,
    takeover,
    rank: rank && rank > 0 ? rank : null,
    nowIso,
  })
}

export async function loadIntent(db: D1Database, intentId: string): Promise<IntentRecord | null> {
  return mapIntent(await db.prepare(`SELECT * FROM checkout_intents WHERE id = ? LIMIT 1`).bind(intentId).first<IntentRow>())
}

function firstRow<T>(result: D1Result<unknown> | { results?: unknown[] }): T | null {
  if ('results' in result && Array.isArray(result.results)) {
    return (result.results[0] as T | undefined) ?? null
  }
  return null
}

function mapListing(row: ListingRow | null | undefined): ListingRecord | null {
  if (!row) return null
  return {
    id: row.id,
    ownerId: row.owner_id,
    canonicalIdentity: row.canonical_identity,
    displayName: row.display_name,
    targetUrl: row.target_url,
    description: row.description,
    imageUrl: row.image_url ?? null,
    principalPaidCents: row.principal_paid_cents,
    principalRefundedCents: row.principal_refunded_cents,
    settledAt: row.settled_at,
  }
}

function mapIntent(row: IntentRow | null | undefined): IntentRecord | null {
  if (!row) return null
  return {
    id: row.id,
    ownerId: row.owner_id,
    listingId: row.listing_id,
    requestId: row.request_id,
    payloadHash: row.payload_hash,
    canonicalIdentity: row.canonical_identity,
    targetAmountCents: row.target_amount_cents,
    kind: row.kind,
    state: row.state,
    providerCheckoutId: row.provider_checkout_id,
    expiresAt: row.expires_at,
    listingTitle: row.listing_title ?? '',
    listingDescription: row.listing_description ?? '',
    listingImageUrl: row.listing_image_url ?? null,
  }
}

function mapOrder(row: OrderRow): ProviderOrderRecord {
  return {
    providerOrderId: row.provider_order_id,
    intentId: row.intent_id,
    providerStatus: row.provider_status,
    principalPaidCents: row.principal_paid_cents,
    principalRefundedCents: row.principal_refunded_cents,
    snapshotHash: row.snapshot_hash,
    occurredAt: row.occurred_at,
  }
}

function mapReceipt(row: ReceiptRow): ReceiptRecord {
  return { eventId: row.provider_event_id, payloadHash: row.payload_hash }
}

function mapTakeover(row: TakeoverRow | null | undefined): TakeoverRecord | null {
  if (!row) return null
  return {
    id: row.id,
    intentId: row.intent_id,
    listingId: row.listing_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
  }
}

function sanitizeCountry(value: string | null): string | null {
  if (!value || value.length !== 2 || value === 'XX' || value === 'T1') return null
  return value.toUpperCase()
}
