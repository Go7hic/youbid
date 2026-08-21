import { createFileRoute } from '@tanstack/react-router'

import { sponsoredUrl } from '../domain/identity.ts'
import { database } from '../server/env.ts'
import { recordClick } from '../server/db.ts'

export const Route = createFileRoute('/go/$listingId')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const referrer = request.headers.get('Referer')
        let referrerHost: string | null = null
        try {
          referrerHost = referrer ? new URL(referrer).hostname : null
        } catch {
          referrerHost = null
        }
        const listing = await recordClick(database(), {
          listingId: params.listingId,
          referrerHost,
          countryCode: request.headers.get('CF-IPCountry'),
        })
        if (!listing) {
          return new Response('Listing not found', { status: 404 })
        }
        return Response.redirect(sponsoredUrl(listing.targetUrl), 302)
      },
    },
  },
})
