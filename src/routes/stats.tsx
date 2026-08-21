import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useEffect } from 'react'

import { formatUsd } from '../domain/money.ts'
import type { PublicStatsSnapshot } from '../domain/stats.ts'
import { database } from '../server/env.ts'
import { loadPublicStats } from '../server/db.ts'
import { SiteFooter, SiteHeader } from '../ui/site-chrome.tsx'

// This loader re-runs every few seconds. Recording a traffic fact here would bill one
// open tab as hundreds of visits an hour and count nothing anyone reads.
const loadStats = createServerFn({ method: 'GET' }).handler(async () => {
  return loadPublicStats(database(), new Date())
})

export const Route = createFileRoute('/stats')({
  loader: () => loadStats(),
  component: StatsPage,
})

function StatsPage() {
  const stats = Route.useLoaderData()
  const router = useRouter()

  useEffect(() => {
    const timer = window.setInterval(() => {
      void router.invalidate()
    }, 3000)
    return () => window.clearInterval(timer)
  }, [router])

  return (
    <main className="site-shell">
      <SiteHeader visitorsOnline={stats.visitorsOnline} visitorsLastHour={stats.visitorsLastHour} />
      <section className="page-panel" aria-labelledby="stats-heading">
        <p className="page-kicker">Live</p>
        <h1 id="stats-heading">Youbid stats</h1>
        <p className="page-lead">
          Public board traffic and settled payments. Updates every few seconds. Secrets and owner
          tokens stay off this page.
        </p>
        <p className="live-updated">Updated {formatClock(stats.generatedAt)}</p>

        <dl className="stat-grid">
          <Stat label="Visitors online" value={stats.visitorsOnline.toLocaleString()} />
          <Stat label="Last hour" value={stats.visitorsLastHour.toLocaleString()} />
          <Stat label="Last 24 hours" value={stats.visitorsLast24h.toLocaleString()} />
          <Stat label="Clicks · 24h" value={stats.clicksLast24h.toLocaleString()} />
          <Stat label="Live listings" value={stats.listingsLive.toLocaleString()} />
          <Stat label="Live volume" value={formatUsd(stats.volumeLiveCents)} />
          <Stat label="First place" value={stats.firstPlaceCents ? formatUsd(stats.firstPlaceCents) : '—'} />
          <Stat
            label="Takeover"
            value={stats.takeover ? `${stats.takeover.display} · ${formatUsd(stats.takeover.amountCents)}` : 'None'}
          />
        </dl>

        <h2>Recent settlements</h2>
        {stats.recentSettlements.length === 0 ? (
          <p className="empty-note">No verified payments yet. Local mock checkout publishes here after settlement.</p>
        ) : (
          <ol className="settlement-list">
            {stats.recentSettlements.map((row) => (
              <li key={`${row.listingId}-${row.settledAt}`}>
                <span>#{row.rank}</span>
                <strong>{row.display}</strong>
                <em>{formatUsd(row.amountCents)}</em>
                <small>{formatClock(row.settledAt)}</small>
              </li>
            ))}
          </ol>
        )}
      </section>
      <SiteFooter />
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function formatClock(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export type { PublicStatsSnapshot }
