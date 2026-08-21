import { listingContribution, type ListingRecord, type TakeoverRecord } from './records.ts'
import { rankListings } from './ranking.ts'

export interface PublicSettlementFact {
  listingId: string
  display: string
  amountCents: number
  settledAt: string
  rank: number
}

export interface PublicTakeoverFact {
  listingId: string
  display: string
  amountCents: number
  endsAt: string
}

export interface PublicStatsSnapshot {
  generatedAt: string
  listingsLive: number
  visitorsOnline: number
  visitorsLastHour: number
  visitorsLast24h: number
  clicksLast24h: number
  volumeLiveCents: number
  firstPlaceCents: number
  takeover: PublicTakeoverFact | null
  recentSettlements: readonly PublicSettlementFact[]
}

export interface StatsFacts {
  nowIso: string
  listings: readonly ListingRecord[]
  takeover: TakeoverRecord | null
  takeoverDisplay: string | null
  visitorsOnline: number
  visitorsLastHour: number
  visitorsLast24h: number
  clicksLast24h: number
}

export function buildPublicStats(facts: StatsFacts): PublicStatsSnapshot {
  const live = facts.listings.filter((listing) => listingContribution(listing) > 0 && listing.settledAt)
  const ranked = rankListings(
    live.map((listing) => ({
      id: listing.id,
      amountCents: listingContribution(listing),
      settledAt: listing.settledAt ?? facts.nowIso,
    })),
  )
  const rankById = new Map(ranked.map((listing, index) => [listing.id, index + 1]))
  const recent = [...live]
    .sort((left, right) => (right.settledAt ?? '').localeCompare(left.settledAt ?? ''))
    .slice(0, 12)
    .map((listing) => ({
      listingId: listing.id,
      display: listing.displayName,
      amountCents: listingContribution(listing),
      settledAt: listing.settledAt ?? facts.nowIso,
      rank: rankById.get(listing.id) ?? live.length,
    }))

  const activeTakeover =
    facts.takeover && facts.takeover.status === 'active' && facts.takeover.endsAt > facts.nowIso
      ? facts.takeover
      : null
  const takeoverListing = activeTakeover
    ? live.find((listing) => listing.id === activeTakeover.listingId)
    : undefined

  return {
    generatedAt: facts.nowIso,
    listingsLive: live.length,
    visitorsOnline: facts.visitorsOnline,
    visitorsLastHour: facts.visitorsLastHour,
    visitorsLast24h: facts.visitorsLast24h,
    clicksLast24h: facts.clicksLast24h,
    volumeLiveCents: live.reduce((sum, listing) => sum + listingContribution(listing), 0),
    firstPlaceCents: ranked[0]?.amountCents ?? 0,
    takeover:
      activeTakeover && takeoverListing
        ? {
            listingId: takeoverListing.id,
            display: facts.takeoverDisplay ?? takeoverListing.displayName,
            amountCents: listingContribution(takeoverListing),
            endsAt: activeTakeover.endsAt,
          }
        : null,
    recentSettlements: recent,
  }
}
