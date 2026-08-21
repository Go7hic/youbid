import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useEffect } from 'react'

import { formatUsd } from '../domain/money.ts'
import type { PublicReceipt } from '../domain/receipt.ts'
import { database } from '../server/env.ts'
import { loadPublicStats, loadReceipt } from '../server/db.ts'
import { SiteFooter, SiteHeader } from '../ui/site-chrome.tsx'

const loadReceiptPage = createServerFn({ method: 'GET' })
  .validator((intentId: string) => intentId)
  .handler(async ({ data: intentId }) => {
    const db = database()
    const now = new Date()
    const receipt = await loadReceipt(db, intentId, now.toISOString())
    const stats = await loadPublicStats(db, now)
    return { receipt, visitorsOnline: stats.visitorsOnline, visitorsLastHour: stats.visitorsLastHour }
  })

export const Route = createFileRoute('/receipts/$intentId')({
  loader: ({ params }) => loadReceiptPage({ data: params.intentId }),
  component: ReceiptPage,
})

function ReceiptPage() {
  const { receipt, visitorsOnline, visitorsLastHour } = Route.useLoaderData()
  const router = useRouter()

  useEffect(() => {
    if (!receipt || receipt.status !== 'awaiting-payment') return
    const timer = window.setInterval(() => {
      void router.invalidate()
    }, 2000)
    return () => window.clearInterval(timer)
  }, [receipt, router])

  return (
    <main className="site-shell">
      <SiteHeader visitorsOnline={visitorsOnline} visitorsLastHour={visitorsLastHour} />
      <section className="page-panel receipt-panel" aria-labelledby="receipt-heading">
        {receipt ? <ReceiptBody receipt={receipt} /> : <MissingReceipt />}
      </section>
      <SiteFooter />
    </main>
  )
}

function ReceiptBody({ receipt }: { receipt: PublicReceipt }) {
  const title =
    receipt.status === 'takeover-active'
      ? 'Page one is yours'
      : receipt.status === 'ranked'
        ? `You claimed rank #${receipt.rank}`
        : receipt.status === 'needs-support'
          ? 'This payment needs a review'
          : 'Waiting for payment'

  return (
    <>
      <p className={`page-kicker ${receipt.status === 'awaiting-payment' ? '' : 'paid'}`}>
        {receipt.status === 'awaiting-payment' ? 'Checkout return' : 'Paid and settled'}
      </p>
      <h1 id="receipt-heading">{title}</h1>
      <dl className="receipt-dl">
        <div>
          <dt>Listing</dt>
          <dd>{receipt.display ?? 'Pending identity'}</dd>
        </div>
        <div>
          <dt>Amount</dt>
          <dd>{formatUsd(receipt.amountCents)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{receipt.status}</dd>
        </div>
      </dl>
      {receipt.status === 'awaiting-payment' ? (
        <p className="page-lead">
          Returning from checkout does not publish a listing. Rank appears only after a verified paid
          webhook settles. This page refreshes until that happens.
        </p>
      ) : null}
      {receipt.status === 'takeover-active' && receipt.takeoverEndsAt ? (
        <p className="page-lead">
          First-page takeover is active until {new Date(receipt.takeoverEndsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
        </p>
      ) : null}
      {receipt.status === 'needs-support' ? (
        <p className="page-lead">
          The payment was recorded, but the board lock could not be applied. Rank was not corrupted.
        </p>
      ) : null}
      <Link className="primary-button modal-primary" to="/">
        See the board
      </Link>
    </>
  )
}

function MissingReceipt() {
  return (
    <>
      <p className="page-kicker">Receipt</p>
      <h1 id="receipt-heading">No checkout found</h1>
      <p className="page-lead">That receipt id is not on Youbid. Start a new bid from the board.</p>
      <Link className="primary-button modal-primary" to="/">
        Back to Youbid
      </Link>
    </>
  )
}
