export const CENTS_PER_DOLLAR = 100
export const MINIMUM_BID_CENTS = 200
export const BID_STEP_CENTS = 100
export const TAKEOVER_OPEN_MULTIPLE = 4
export const TAKEOVER_FLOOR_NUMERATOR = 6
export const TAKEOVER_FLOOR_DENOMINATOR = 5
export const TAKEOVER_FALL_MS = 24 * 60 * 60 * 1000

export function dollarsToCents(dollars: number): number {
  if (!Number.isFinite(dollars)) return MINIMUM_BID_CENTS
  return Math.max(MINIMUM_BID_CENTS, Math.round(dollars) * CENTS_PER_DOLLAR)
}

export function centsToWholeDollars(cents: number): number {
  return Math.round(cents / CENTS_PER_DOLLAR)
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / CENTS_PER_DOLLAR)
}

export function takeoverIdleMs(nowIso: string, lastEndedAtIso: string | null): number {
  if (!lastEndedAtIso) return 0
  const idle = Date.parse(nowIso) - Date.parse(lastEndedAtIso)
  return Number.isFinite(idle) ? Math.max(0, idle) : 0
}

export function takeoverPrice(leaderAmountCents: number, idleMs: number): number {
  const open = snapWholeDollar(leaderAmountCents * TAKEOVER_OPEN_MULTIPLE)
  const floor = snapWholeDollar(
    Math.ceil((leaderAmountCents * TAKEOVER_FLOOR_NUMERATOR) / TAKEOVER_FLOOR_DENOMINATOR),
  )
  const span = open - floor
  if (span <= 0) return open
  const progress = Math.min(1, Math.max(0, idleMs / TAKEOVER_FALL_MS))
  return snapWholeDollar(open - span * progress)
}

function snapWholeDollar(cents: number): number {
  return Math.max(MINIMUM_BID_CENTS, Math.round(cents / BID_STEP_CENTS) * BID_STEP_CENTS)
}

export function amountToClaim(amountCents: number): number {
  return Math.max(MINIMUM_BID_CENTS, amountCents + BID_STEP_CENTS)
}
