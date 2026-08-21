import { createFileRoute } from '@tanstack/react-router'

import { database } from '../server/env.ts'
import { loadPublicStats } from '../server/db.ts'

export const Route = createFileRoute('/api/stats')({
  server: {
    handlers: {
      GET: async () => Response.json(await loadPublicStats(database(), new Date())),
    },
  },
})
