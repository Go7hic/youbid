import type { Listing } from '../data/listings'
import { listingStanding } from './decay.ts'
import { type ListingRecord, type TakeoverRecord } from './records.ts'

export const BOARD_PAGE_SIZE = 50

export interface TakeoverSlot {
  amountCents: number
  display: string
  href: string
  endsAt: string
}

export interface BoardPage<T> {
  page: number
  pageCount: number
  takeover: TakeoverSlot | null
  listings: T[]
  firstRank: number
}

/**
 * An active takeover owns its own page ahead of the listing pages rather than
 * replacing page one, so paid listings stay reachable while a takeover runs.
 */
export function boardPage<T>(input: {
  listings: readonly T[]
  takeover: TakeoverSlot | null
  requestedPage: number
}): BoardPage<T> {
  const takeoverPages = input.takeover ? 1 : 0
  const listingPages = Math.max(1, Math.ceil(input.listings.length / BOARD_PAGE_SIZE))
  const pageCount = takeoverPages + listingPages
  const requested = Number.isFinite(input.requestedPage) ? Math.trunc(input.requestedPage) : 1
  const page = Math.min(Math.max(1, requested), pageCount)

  if (input.takeover && page === 1) {
    return { page, pageCount, takeover: input.takeover, listings: [], firstRank: 0 }
  }

  const offset = (page - 1 - takeoverPages) * BOARD_PAGE_SIZE
  return {
    page,
    pageCount,
    takeover: null,
    listings: input.listings.slice(offset, offset + BOARD_PAGE_SIZE),
    firstRank: offset + 1,
  }
}

export function ageLabel(settledAt: string, now: Date): string {
  const deltaMs = now.getTime() - Date.parse(settledAt)
  if (!Number.isFinite(deltaMs) || deltaMs < 45_000) return 'just now'
  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export function toPublicListing(
  listing: ListingRecord,
  clicks: number,
  now: Date,
): Listing {
  const nowIso = now.toISOString()
  return {
    id: listing.id,
    domain: listing.displayName,
    description: listing.description || 'Paid and verified on Youbid.',
    href: `/go/${listing.id}`,
    image: listing.imageUrl || faviconForUrl(listing.targetUrl),
    amountCents: listingStanding(listing, nowIso),
    settledAt: listing.settledAt ?? nowIso,
    dropsOffAt: listing.dropsOffAt ?? listing.settledAt ?? nowIso,
    age: listing.settledAt ? ageLabel(listing.settledAt, now) : 'just now',
    clicks,
  }
}

export function publicTakeover(
  takeover: TakeoverRecord | null,
  listing: ListingRecord | null,
  nowIso: string,
): TakeoverSlot | null {
  if (!takeover || !listing || takeover.status !== 'active' || takeover.endsAt <= nowIso) return null
  return {
    amountCents: listingStanding(listing, nowIso),
    display: listing.displayName,
    href: `/go/${listing.id}`,
    endsAt: takeover.endsAt,
  }
}

function faviconForUrl(targetUrl: string): string | null {
  try {
    const hostname = new URL(targetUrl).hostname
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`
  } catch {
    return null
  }
}
