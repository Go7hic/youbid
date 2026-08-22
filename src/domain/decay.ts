import { BID_STEP_CENTS, MINIMUM_BID_CENTS } from './money.ts'
import { listingContribution, type ListingRecord } from './records.ts'

export const DAILY_DECAY = 0.97
export const DECAY_FLOOR_CENTS = MINIMUM_BID_CENTS
export const MS_PER_DAY = 86_400_000

const LAMBDA = -Math.log(DAILY_DECAY)

export function decayedBalance(contributionCents: number, settledAt: string, nowIso: string): number {
  if (contributionCents < DECAY_FLOOR_CENTS) return 0
  const days = daysBetween(settledAt, nowIso)
  if (days <= 0) return snapDecayCents(contributionCents)
  const score = contributionCents * DAILY_DECAY ** days
  return score < DECAY_FLOOR_CENTS ? 0 : snapDecayCents(score)
}

export function dropsOffAt(contributionCents: number, settledAt: string): string {
  const start = Date.parse(settledAt)
  if (!Number.isFinite(start) || contributionCents < DECAY_FLOOR_CENTS) {
    return Number.isFinite(start) ? new Date(start).toISOString() : settledAt
  }
  const days = Math.log(contributionCents / DECAY_FLOOR_CENTS) / LAMBDA
  return new Date(start + days * MS_PER_DAY).toISOString()
}

export function decayedBalanceFromDropOff(dropsOffAtIso: string, nowIso: string): number {
  const remainingDays = daysBetween(nowIso, dropsOffAtIso)
  if (remainingDays <= 0) return 0
  return snapDecayCents(DECAY_FLOOR_CENTS * Math.exp(LAMBDA * remainingDays))
}

export function toppedUpDropsOffAt(currentDropsOffAt: string, deltaCents: number, nowIso: string): string {
  const next = decayedBalanceFromDropOff(currentDropsOffAt, nowIso) + deltaCents
  if (next < DECAY_FLOOR_CENTS) return nowIso
  return dropsOffAt(next, nowIso)
}

export function listingStanding(listing: ListingRecord, nowIso: string): number {
  if (listing.dropsOffAt) return decayedBalanceFromDropOff(listing.dropsOffAt, nowIso)
  const settledAt = listing.settledAt ?? nowIso
  return decayedBalance(listingContribution(listing), settledAt, nowIso)
}

export function listingDropsOffAt(listing: ListingRecord): string {
  if (listing.dropsOffAt) return listing.dropsOffAt
  return dropsOffAt(listingContribution(listing), listing.settledAt ?? new Date().toISOString())
}

function daysBetween(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / MS_PER_DAY
}

function snapDecayCents(cents: number): number {
  return Math.max(0, Math.round(cents / BID_STEP_CENTS) * BID_STEP_CENTS)
}

