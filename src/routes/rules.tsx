import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

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
})

function RulesPage() {
  const { visitorsOnline, visitorsLastHour } = Route.useLoaderData()
  return (
    <main className="site-shell">
      <SiteHeader visitorsOnline={visitorsOnline} visitorsLastHour={visitorsLastHour} />
      <article className="page-panel" aria-labelledby="rules-heading">
        <p className="page-kicker">How Youbid works</p>
        <h1 id="rules-heading">Rank is the bid</h1>
        <p className="page-lead">
          Youbid is a public leaderboard. You pay an absolute amount for a URL or @handle. Only a
          verified paid event publishes or raises a listing.
        </p>
        <ul className="rules-list">
          <li>Bids are whole US dollars, minimum $2.</li>
          <li>Paying less than first place still puts you on the board at the rank that amount can take.</li>
          <li>Enter the same URL or @handle again to raise that listing by paying the difference.</li>
          <li>Only the visitor who first paid a listing can raise it.</li>
          <li>Platform paths stay distinct, so two apps on the same host do not share a bid.</li>
          <li>Invite links are rejected. Query strings are stripped.</li>
          <li>A takeover costs twice the current first-place amount and locks page one for three hours.</li>
          <li>Clicks leave through a sponsored outbound and are counted.</li>
          <li>Refunds recompute paid-minus-refunded contribution. They never invent a delta.</li>
        </ul>
      </article>
      <SiteFooter />
    </main>
  )
}
