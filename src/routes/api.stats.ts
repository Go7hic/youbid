import { createFileRoute } from '@tanstack/react-router'

import { database } from '../server/env.ts'
import { loadPublicStats, recordTraffic } from '../server/db.ts'

export const Route = createFileRoute('/api/stats')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const db = database()
        await recordTraffic(db, 'stats', request.headers.get('CF-IPCountry'))
        return Response.json(await loadPublicStats(db, new Date()))
      },
    },
  },
})
