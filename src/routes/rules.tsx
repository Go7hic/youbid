import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

import { RULES_LEAD, RULES_SECTIONS, RULES_TITLE } from '../content/rules.ts'
import { database } from '../server/env.ts'
import { loadPublicStats } from '../server/db.ts'
import { SiteFooter, SiteHeader } from '../ui/site-chrome.tsx'

const loadRules = createServerFn({ method: 'GET' }).handler(async () => {
  const stats = await loadPublicStats(database(), new Date())
  return { visitorsOnline: stats.visitorsOnline, visitorsLastHour: stats.visitorsLastHour }
})

export const Route = createFileRoute('/rules')({
  loader: () => loadRules(),
  component: RulesPage,
  head: () => ({
    meta: [
      { title: `Youbid rules · ${RULES_TITLE}` },
      { name: 'description', content: RULES_LEAD },
      { property: 'og:title', content: `Youbid rules · ${RULES_TITLE}` },
      { property: 'og:description', content: RULES_LEAD },
      { property: 'og:url', content: 'https://youbid.lol/rules' },
    ],
    links: [
      { rel: 'canonical', href: 'https://youbid.lol/rules' },
      { rel: 'alternate', type: 'text/markdown', href: '/rules.md' },
    ],
  }),
})

function RulesPage() {
  const { visitorsOnline, visitorsLastHour } = Route.useLoaderData()
  return (
    <main className="site-shell">
      <SiteHeader visitorsOnline={visitorsOnline} visitorsLastHour={visitorsLastHour} />
      <article className="page-panel" aria-labelledby="rules-heading">
        <p className="page-kicker">How Youbid works</p>
        <h1 id="rules-heading">{RULES_TITLE}</h1>
        <p className="page-lead">{RULES_LEAD}</p>

        {RULES_SECTIONS.map((section) => (
          <div key={section.heading}>
            <h2>{section.heading}</h2>
            {section.lead ? <p className="page-lead">{section.lead}</p> : null}
            <ul className="rules-list">
              {section.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          </div>
        ))}
      </article>
      <SiteFooter />
    </main>
  )
}
