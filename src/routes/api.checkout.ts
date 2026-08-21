import { createFileRoute } from '@tanstack/react-router'

import { sha256Hex } from '../domain/owner.ts'
import { listingStanding } from '../domain/decay.ts'
import { normalizeIdentity } from '../domain/identity.ts'
import { completeListingMetadata, sanitizeListingMetadata } from '../domain/listing-metadata.ts'
import { planMarkCheckoutReady, planMarkCheckoutUncertain, planReserveCheckout } from '../domain/reservation.ts'
import { attachOwnerCookie, resolveOwner } from '../server/owner-cookie.ts'
import { parseCheckoutBody } from '../server/parse.ts'
import { createStripeCheckout } from '../server/stripe.ts'
import { verifyTurnstile } from '../server/turnstile.ts'
import { database, publicCheckoutConfig, readProductionConfig } from '../server/env.ts'
import { ensureOwner, expireOpenIntents, insertIntent, loadReservationSnapshot, updateIntent } from '../server/db.ts'
import { isDuplicateCheckoutRequest } from '../server/d1-errors.ts'

export const Route = createFileRoute('/api/checkout')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const config = readProductionConfig()
        const owner = await resolveOwner(request)
        if (!owner) {
          return Response.json(
            { code: 'owner_cookie_unconfigured', message: 'Owner cookie signing is not configured.' },
            { status: 503 },
          )
        }

        let raw: unknown
        try {
          raw = await request.json()
        } catch {
          return Response.json({ code: 'invalid_json', message: 'Checkout body must be JSON.' }, { status: 400 })
        }

        const parsed = parseCheckoutBody(raw)
        if (!parsed.ok) {
          return Response.json({ code: 'invalid_checkout', message: parsed.message }, { status: parsed.status })
        }

        const identity = normalizeIdentity(parsed.value.identityInput)
        if (!identity.ok) {
          return Response.json({ code: 'invalid_identity', message: identity.message }, { status: 400 })
        }

        if (config.turnstileSecret) {
          const turnstile = await verifyTurnstile(
            parsed.value.turnstileToken,
            config.turnstileSecret,
            request.headers.get('CF-Connecting-IP') ?? undefined,
          )
          if (!turnstile.ok) {
            return Response.json({ code: 'turnstile_rejected', message: turnstile.message }, { status: turnstile.status })
          }
        }

        const checkoutMode = publicCheckoutConfig(config)
        if (checkoutMode.mode === 'unavailable') {
          return Response.json(
            { code: 'checkout_unavailable', message: 'Production checkout requires Stripe.' },
            { status: 503 },
          )
        }

        const db = database()
        const now = new Date()
        const nowIso = now.toISOString()
        await expireOpenIntents(db, nowIso)
        await ensureOwner(db, owner)

        const kind = parsed.value.takeover ? ('takeover' as const) : ('rank' as const)
        const submitted = sanitizeListingMetadata({
          title: parsed.value.title,
          description: parsed.value.description,
          imageUrl: parsed.value.imageUrl,
        })
        const payloadHash = await sha256Hex(
          JSON.stringify({
            identity: identity.identity.canonicalKey,
            amount: parsed.value.amountCents,
            kind,
            title: submitted.title,
            description: submitted.description,
          }),
        )
        const snapshotInput = {
          nowIso,
          ownerId: owner.ownerId,
          requestId: parsed.value.requestId,
          payloadHash,
          identity: identity.identity,
          targetAmountCents: parsed.value.amountCents,
          kind,
          listingTitle: submitted.title,
          listingDescription: submitted.description,
          listingImageUrl: submitted.imageUrl,
        }
        const loaded = await loadReservationSnapshot(db, snapshotInput)
        const metadata = completeListingMetadata(
          submitted,
          loaded.listingByIdentity
            ? {
                title: loaded.listingByIdentity.displayName,
                description: loaded.listingByIdentity.description,
                imageUrl: loaded.listingByIdentity.imageUrl,
              }
            : null,
        )
        if (!metadata.ok) {
          return jsonWithOwner(
            {
              code: 'listing_metadata_required',
              message: 'Add a title and description so the board can show this listing.',
              missing: metadata.missing,
            },
            400,
            owner.cookieValue,
            request,
          )
        }
        const snapshot = {
          ...loaded,
          listingTitle: metadata.metadata.title,
          listingDescription: metadata.metadata.description,
          listingImageUrl: metadata.metadata.imageUrl,
        }
        const plan = planReserveCheckout(snapshot, {
          intentId: crypto.randomUUID(),
          expiresAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
        })

        if (plan.kind === 'reject') {
          return jsonWithOwner(
            { code: 'checkout_rejected', message: plan.message },
            plan.status,
            owner.cookieValue,
            request,
          )
        }

        if (plan.kind === 'settled') {
          return jsonWithOwner(
            { mode: 'settled', intentId: plan.intent.id, checkoutUrl: `/receipts/${plan.intent.id}` },
            200,
            owner.cookieValue,
            request,
          )
        }

        let reserved = plan.intent
        if (plan.kind === 'create') {
          try {
            await insertIntent(db, { ...plan.intent, providerCheckoutId: null })
          } catch (error) {
            if (!isDuplicateCheckoutRequest(error)) throw error
            const retry = await loadReservationSnapshot(db, {
              ...snapshotInput,
              listingTitle: metadata.metadata.title,
              listingDescription: metadata.metadata.description,
              listingImageUrl: metadata.metadata.imageUrl,
            })
            if (!retry.existingByRequest) throw error
            reserved = retry.existingByRequest
          }
        }

        const liveCents = snapshot.listingByIdentity
          ? listingStanding(snapshot.listingByIdentity, nowIso)
          : 0
        const chargeCents = parsed.value.amountCents - liveCents

        if (checkoutMode.mode === 'stripe') {
          if (reserved.state === 'awaiting-payment' && reserved.providerCheckoutId) {
            const existing = await createStripeCheckout(
              {
                requestId: parsed.value.requestId,
                intentId: reserved.id,
                amountCents: chargeCents,
                canonicalIdentity: identity.identity.canonicalKey,
                takeover: parsed.value.takeover,
                turnstileToken: parsed.value.turnstileToken,
              },
              config,
            )
            if (existing.ok) {
              return jsonWithOwner(
                { mode: 'stripe', intentId: reserved.id, checkoutUrl: existing.value.checkoutUrl },
                200,
                owner.cookieValue,
                request,
              )
            }
          }

          const created = await createStripeCheckout(
            {
              requestId: parsed.value.requestId,
              intentId: reserved.id,
              amountCents: chargeCents,
              canonicalIdentity: identity.identity.canonicalKey,
              takeover: parsed.value.takeover,
              turnstileToken: parsed.value.turnstileToken,
            },
            config,
          )
          if (!created.ok) {
            await updateIntent(db, planMarkCheckoutUncertain(reserved))
            return jsonWithOwner(
              { code: 'checkout_uncertain', message: created.message, intentId: reserved.id },
              created.status,
              owner.cookieValue,
              request,
            )
          }
          await updateIntent(db, planMarkCheckoutReady(reserved, created.value.sessionId))
          return jsonWithOwner(
            { mode: 'stripe', intentId: reserved.id, checkoutUrl: created.value.checkoutUrl },
            200,
            owner.cookieValue,
            request,
          )
        }

        const ready = planMarkCheckoutReady(reserved, `mock_${reserved.id}`)
        await updateIntent(db, ready)
        return jsonWithOwner(
          { mode: 'mock', intentId: reserved.id, checkoutUrl: `/receipts/${reserved.id}` },
          200,
          owner.cookieValue,
          request,
        )
      },
    },
  },
})

function jsonWithOwner(body: unknown, status: number, cookieValue: string, request: Request): Response {
  const response = Response.json(body, { status })
  return attachOwnerCookie(response, cookieValue, new URL(request.url).protocol === 'https:')
}

