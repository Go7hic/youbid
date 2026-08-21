import type { RankableListing } from '../domain/ranking'

export interface Listing extends RankableListing {
  description: string
  domain: string
  href: string
  image: string | null
  clicks: number
  age: string
}
