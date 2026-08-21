import { createFileRoute } from '@tanstack/react-router'

import { rulesMarkdown } from '../content/rules.ts'
import { siteOrigin } from '../server/env.ts'

export const Route = createFileRoute('/rules.md')({
  server: {
    handlers: {
      GET: () =>
        new Response(rulesMarkdown(siteOrigin()), {
          headers: {
            'content-type': 'text/markdown; charset=utf-8',
            'cache-control': 'public, max-age=300',
          },
        }),
    },
  },
})
