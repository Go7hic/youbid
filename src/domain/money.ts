export const CENTS_PER_DOLLAR = 100
export const MINIMUM_BID_CENTS = 200
export const BID_STEP_CENTS = 100

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

export function takeoverPrice(leaderAmountCents: number): number {
  return Math.max(MINIMUM_BID_CENTS, leaderAmountCents * 2)
}

export function amountToClaim(amountCents: number): number {
  return Math.max(MINIMUM_BID_CENTS, amountCents + BID_STEP_CENTS)
}
