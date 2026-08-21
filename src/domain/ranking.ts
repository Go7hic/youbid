export interface RankableListing {
  id: string
  amountCents: number
  settledAt: string
  dropsOffAt: string
}

export function rankListings<T extends RankableListing>(listings: readonly T[]): T[] {
  return [...listings].sort(
    (left, right) =>
      right.dropsOffAt.localeCompare(left.dropsOffAt) ||
      left.settledAt.localeCompare(right.settledAt) ||
      left.id.localeCompare(right.id),
  )
}

export function projectedRank(
  amountCents: number,
  listings: readonly RankableListing[],
): number {
  return listings.filter((listing) => listing.amountCents >= amountCents).length + 1
}
