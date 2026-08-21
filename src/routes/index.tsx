import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'

import type { Listing } from '../data/listings.ts'
import { normalizeIdentity } from '../domain/identity.ts'
import {
  BID_STEP_CENTS,
  MINIMUM_BID_CENTS,
  amountToClaim,
  formatUsd,
  takeoverPrice,
} from '../domain/money.ts'
import { projectedRank, rankListings } from '../domain/ranking.ts'
import { database, publicCheckoutConfig } from '../server/env.ts'
import { loadPublicBoard, loadPublicStats, recordTraffic } from '../server/db.ts'
import { SiteFooter, SiteHeader } from '../ui/site-chrome.tsx'

const PAGE_SIZE = 50

const loadHome = createServerFn({ method: 'GET' }).handler(async () => {
  const db = database()
  const now = new Date()
  await recordTraffic(db, 'board', getRequestHeader('CF-IPCountry') ?? null)
  const board = await loadPublicBoard(db, now)
  const stats = await loadPublicStats(db, now)
  return {
    listings: board.listings,
    takeover: board.takeover,
    checkout: publicCheckoutConfig(),
    visitorsOnline: stats.visitorsOnline,
    visitorsLastHour: stats.visitorsLastHour,
  }
})

export const Route = createFileRoute('/')({
  loader: () => loadHome(),
  component: Home,
})

function Home() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const bidFormRef = useRef<HTMLElement>(null)
  const listings = data.listings
  const rankedListings = useMemo(() => rankListings(listings), [listings])
  const leaderAmount = rankedListings[0]?.amountCents ?? MINIMUM_BID_CENTS
  const [amountCents, setAmountCents] = useState(() => amountToClaim(leaderAmount))
  const [identityInput, setIdentityInput] = useState('')
  const [identityError, setIdentityError] = useState('')
  const [listingTitle, setListingTitle] = useState('')
  const [listingDescription, setListingDescription] = useState('')
  const [listingImageUrl, setListingImageUrl] = useState('')
  const [resolving, setResolving] = useState(false)
  const [resolvedKey, setResolvedKey] = useState('')
  const lastCanonical = useRef('')
  const resolveSeq = useRef(0)
  const [takeover, setTakeover] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [pendingIntentId, setPendingIntentId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState(false)

  const pageCount = Math.max(1, Math.ceil(rankedListings.length / PAGE_SIZE))
  const visibleListings = rankedListings.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const previewRank = projectedRank(amountCents, rankedListings)
  const normalizedIdentity = normalizeIdentity(identityInput)
  const canCheckout =
    data.checkout.mode !== 'unavailable' &&
    normalizedIdentity.ok &&
    listingTitle.trim() !== '' &&
    listingDescription.trim() !== '' &&
    amountCents >= MINIMUM_BID_CENTS &&
    !busy
  const showMetadataFallback =
    normalizedIdentity.ok &&
    resolvedKey === normalizedIdentity.identity.canonicalKey &&
    !resolving &&
    (!listingTitle.trim() || !listingDescription.trim())

  function applyIdentityInput(value: string) {
    setIdentityInput(value)
    setIdentityError('')
    const next = normalizeIdentity(value)
    const key = next.ok ? next.identity.canonicalKey : ''
    if (key !== lastCanonical.current) {
      lastCanonical.current = key
      setResolvedKey('')
      setListingTitle('')
      setListingDescription('')
      setListingImageUrl('')
    }
  }

  useEffect(() => {
    const result = normalizeIdentity(identityInput)
    if (!result.ok) return
    const timer = window.setTimeout(() => {
      void resolveIdentityFields(identityInput)
    }, 450)
    return () => window.clearTimeout(timer)
  }, [identityInput])

  async function resolveIdentityFields(value: string) {
    const result = normalizeIdentity(value)
    if (!result.ok) return
    const seq = ++resolveSeq.current
    setResolving(true)
    try {
      const response = await fetch('/api/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identity: value }),
      })
      if (seq !== resolveSeq.current) return
      const payload = (await response.json()) as {
        metadata?: { title?: string; description?: string; imageUrl?: string | null }
      }
      setResolvedKey(result.identity.canonicalKey)
      if (!response.ok || !payload.metadata) return
      setListingTitle((current) => current || payload.metadata?.title || '')
      setListingDescription((current) => current || payload.metadata?.description || '')
      setListingImageUrl((current) => current || payload.metadata?.imageUrl || '')
    } finally {
      if (seq === resolveSeq.current) setResolving(false)
    }
  }
  const activeTakeover = data.takeover

  function scrollToBidForm() {
    bidFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  function chooseRank(listing: Listing) {
    setTakeover(false)
    setAmountCents(amountToClaim(listing.amountCents))
    setIdentityError('')
    scrollToBidForm()
  }

  function chooseTakeover() {
    setTakeover(true)
    setAmountCents(takeoverPrice(leaderAmount))
    setIdentityError('')
    scrollToBidForm()
  }

  async function openCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = normalizeIdentity(identityInput)
    if (!result.ok) {
      setIdentityError(result.message)
      return
    }
    setBusy(true)
    setIdentityError('')
    try {
      const turnstileInput = event.currentTarget.querySelector<HTMLInputElement>('[name="cf-turnstile-response"]')
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          amountCents,
          identity: identityInput,
          title: listingTitle,
          description: listingDescription,
          imageUrl: listingImageUrl || null,
          takeover,
          turnstileToken: turnstileInput?.value ?? '',
        }),
      })
      const payload = (await response.json()) as {
        message?: string
        mode?: 'mock' | 'stripe' | 'unavailable'
        intentId?: string
        checkoutUrl?: string
      }
      if (!response.ok || !payload.intentId) {
        setIdentityError(payload.message ?? 'Checkout could not start.')
        return
      }
      if (payload.mode === 'stripe' && payload.checkoutUrl) {
        window.location.assign(payload.checkoutUrl)
        return
      }
      setPendingIntentId(payload.intentId)
      setCheckoutOpen(true)
    } finally {
      setBusy(false)
    }
  }

  async function confirmMockPayment() {
    if (!pendingIntentId) return
    setBusy(true)
    try {
      const response = await fetch('/api/mock/settle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ intentId: pendingIntentId }),
      })
      const payload = (await response.json()) as { message?: string; receipt?: string }
      if (!response.ok) {
        setIdentityError(payload.message ?? 'Mock settlement failed.')
        return
      }
      window.location.assign(`/receipts/${pendingIntentId}`)
    } finally {
      setBusy(false)
    }
  }

  function closeCheckout() {
    setCheckoutOpen(false)
  }

  return (
    <main className="site-shell">
      <SiteHeader visitorsOnline={data.visitorsOnline} visitorsLastHour={data.visitorsLastHour} />

      <section className="intro" id="top">
        <p className="tagline">you bid, you get</p>

        <section className="bid-panel" ref={bidFormRef} aria-labelledby="bid-heading">
          <div className="bid-title-row">
            <h1 id="bid-heading">{takeover ? 'Take page one for' : `Claim #${previewRank} for`}</h1>
            <button
              className="step-button"
              type="button"
              aria-label="Decrease bid by one dollar"
              onClick={() => setAmountCents((amount) => Math.max(MINIMUM_BID_CENTS, amount - BID_STEP_CENTS))}
            >
              −
            </button>
            <strong className="bid-amount">{formatUsd(amountCents)}</strong>
            <button
              className="step-button"
              type="button"
              aria-label="Increase bid by one dollar"
              onClick={() => setAmountCents((amount) => amount + BID_STEP_CENTS)}
            >
              +
            </button>
          </div>
          <p className="bid-explainer">
            {takeover
              ? 'This paid bid takes the whole first page for three hours.'
              : 'Your amount decides the rank. Paying less than the #1 price still puts you on the board wherever that bid can take you.'}
          </p>

          <form className="bid-composer-wrap" onSubmit={openCheckout} noValidate>
            <div className="bid-composer">
              <div className="bid-form">
                <label className="identity-field">
                  <span className="input-prefix" aria-hidden="true">
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4">
                      <circle cx="8" cy="8" r="6.2" />
                      <path d="M2 8h12M8 2c1.8 1.8 2.7 3.8 2.7 6S9.8 12.2 8 14C6.2 12.2 5.3 10.2 5.3 8S6.2 3.8 8 2Z" />
                    </svg>
                  </span>
                  <span className="sr-only">Product URL or social handle</span>
                  <input
                    value={identityInput}
                    onChange={(event) => applyIdentityInput(event.target.value)}
                    onBlur={(event) => void resolveIdentityFields(event.target.value)}
                    placeholder="Your product URL or @handle"
                    aria-invalid={Boolean(identityError)}
                    aria-describedby="identity-help identity-error"
                    autoComplete="url"
                  />
                </label>
                <button className="primary-button" type="submit" disabled={!canCheckout}>
                  {busy ? 'Working…' : takeover ? 'Take over' : 'Bid'}
                </button>
              </div>
              <p className="identity-help" id="identity-help">
                {data.checkout.mode === 'unavailable'
                  ? 'Paid bids open after Stripe is configured. The live board shows verified payments only.'
                  : resolving
                    ? 'Reading listing details…'
                    : 'Already on the list? Enter the same URL or @handle and up your bid to get back to the top.'}
              </p>
            </div>
            {data.checkout.turnstileSiteKey ? (
              <div className="cf-turnstile" data-sitekey={data.checkout.turnstileSiteKey} />
            ) : null}
            {showMetadataFallback ? (
              <div className="listing-meta">
                <label>
                  <span>Title</span>
                  <input
                    value={listingTitle}
                    onChange={(event) => setListingTitle(event.target.value)}
                    placeholder="Name shown on the board"
                    maxLength={80}
                    required
                  />
                </label>
                <label>
                  <span>Description</span>
                  <textarea
                    value={listingDescription}
                    onChange={(event) => setListingDescription(event.target.value)}
                    placeholder="One or two sentences"
                    maxLength={240}
                    rows={2}
                    required
                  />
                </label>
                <label>
                  <span>Image URL <em>(optional)</em></span>
                  <input
                    value={listingImageUrl}
                    onChange={(event) => setListingImageUrl(event.target.value)}
                    placeholder="https://…"
                    inputMode="url"
                  />
                </label>
              </div>
            ) : null}
            <p className="field-error" id="identity-error" role="alert">{identityError}</p>
          </form>
        </section>

        <section className="takeover-offer" aria-label="Leaderboard takeover">
          <p>
            <strong>New: Leaderboard takeover.</strong> Own the first page for 3 hours —{' '}
            {formatUsd(takeoverPrice(leaderAmount))} <span>(2× current #1)</span>
          </p>
          <button type="button" onClick={chooseTakeover} disabled={Boolean(activeTakeover)}>
            {activeTakeover ? 'Active' : 'Take over'}
          </button>
        </section>
      </section>

      <section className="leaderboard" aria-labelledby="leaderboard-heading">
        <h2 className="sr-only" id="leaderboard-heading">Paid product leaderboard</h2>
        <div className="board-controls">
          <button className="refresh-button" type="button" onClick={() => void router.invalidate()}>
            Refresh
          </button>
          <nav className="pagination" aria-label="Leaderboard pages">
            <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1}>Prev</button>
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
              <button
                key={pageNumber}
                type="button"
                className={pageNumber === page ? 'current-page' : undefined}
                aria-current={pageNumber === page ? 'page' : undefined}
                onClick={() => setPage(pageNumber)}
              >
                {pageNumber}
              </button>
            ))}
            <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page === pageCount}>Next</button>
          </nav>
        </div>

        {page === 1 && activeTakeover ? (
          <article className="takeover-live">
            <span className="takeover-kicker">First-page takeover · paid</span>
            <a href={activeTakeover.href} rel="sponsored">
              {activeTakeover.display}
            </a>
            <p>
              This listing owns Youbid page one until{' '}
              {new Date(activeTakeover.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
            </p>
            <strong>{formatUsd(activeTakeover.amountCents)}</strong>
            <button type="button" onClick={() => setPage(2)}>Browse the regular leaderboard</button>
          </article>
        ) : (
          <div className="listing-stack">
            {visibleListings.length === 0 ? (
              <p className="empty-note">No paid listings yet. The first verified bid takes #1.</p>
            ) : null}
            {visibleListings.map((listing, index) => {
              const rank = (page - 1) * PAGE_SIZE + index + 1
              const claimCents = amountToClaim(listing.amountCents)
              return (
                <article
                  className={`listing-card rank-${Math.min(rank, 4)}`}
                  key={listing.id}
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest('a, .claim-rank')) return
                    chooseRank(listing)
                  }}
                >
                  <button
                    className="claim-rank"
                    type="button"
                    onClick={() => chooseRank(listing)}
                  >
                    claim this rank for {formatUsd(claimCents)}
                  </button>
                  <button className="rank-badge" type="button" onClick={() => chooseRank(listing)} aria-label={`Claim rank ${rank} for ${formatUsd(claimCents)}`}>
                    #{rank}
                  </button>
                  {listing.image ? <img src={listing.image} alt="" width="56" height="56" loading="lazy" /> : null}
                  <div className="listing-copy">
                    <a href={listing.href} target={listing.href.startsWith('/go/') ? undefined : '_blank'} rel="sponsored noopener noreferrer">
                      {listing.domain}
                    </a>
                    <p>{listing.description}</p>
                    <small>{listing.age} <span className="meta-dot" aria-hidden="true">•</span> <strong>{listing.clicks.toLocaleString()} clicks</strong></small>
                  </div>
                  <button className="listing-price" type="button" onClick={() => chooseRank(listing)} aria-label={`Current rank amount ${formatUsd(listing.amountCents)}`}>
                    {formatUsd(listing.amountCents)}
                  </button>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <SiteFooter />

      {checkoutOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) closeCheckout()
        }}>
          <section className="checkout-modal" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
            <span className="modal-kicker">Local mock checkout</span>
            <h2 id="checkout-title">Review your {takeover ? 'takeover' : 'bid'}</h2>
            <dl>
              <div><dt>Listing</dt><dd>{listingTitle || (normalizedIdentity.ok ? normalizedIdentity.identity.display : identityInput)}</dd></div>
              <div><dt>Placement</dt><dd>{takeover ? 'Page one · 3 hours' : `Projected rank #${previewRank}`}</dd></div>
              <div><dt>Total</dt><dd>{formatUsd(amountCents)}</dd></div>
            </dl>
            <p className="payment-note">
              Creating checkout reserved a D1 intent and did not change the board. Confirming
              runs the same settlement planner as a paid webhook.
            </p>
            <button className="primary-button modal-primary" type="button" disabled={busy} onClick={() => void confirmMockPayment()}>
              Confirm mock payment
            </button>
            <button className="text-button" type="button" onClick={closeCheckout}>Cancel</button>
          </section>
        </div>
      ) : null}
    </main>
  )
}
