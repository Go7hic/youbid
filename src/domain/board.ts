import type { Listing } from '../data/listings'
import { listingContribution, type ListingRecord, type TakeoverRecord } from './records.ts'

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
  return {
    id: listing.id,
    domain: listing.displayName,
    description: listing.description || 'Paid and verified on Youbid.',
    href: `/go/${listing.id}`,
    image: listing.imageUrl || faviconForUrl(listing.targetUrl),
    amountCents: listingContribution(listing),
    settledAt: listing.settledAt ?? now.toISOString(),
    age: listing.settledAt ? ageLabel(listing.settledAt, now) : 'just now',
    clicks,
  }
}

export function publicTakeover(
  takeover: TakeoverRecord | null,
  listing: ListingRecord | null,
  nowIso: string,
): { amountCents: number; display: string; href: string; endsAt: string } | null {
  if (!takeover || !listing || takeover.status !== 'active' || takeover.endsAt <= nowIso) return null
  return {
    amountCents: listingContribution(listing),
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
