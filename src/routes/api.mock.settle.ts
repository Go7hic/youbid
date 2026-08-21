import { createFileRoute } from '@tanstack/react-router'

import { listingContribution } from '../domain/records.ts'
import { database, isLocalDevelopment, stripeIsConfigured } from '../server/env.ts'
import { expireOpenIntents, loadIntent, loadSettlementSnapshot } from '../server/db.ts'
import { persistPaidEvent } from '../server/settlement-flow.ts'
import { resolveOwner } from '../server/owner-cookie.ts'

export const Route = createFileRoute('/api/mock/settle')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isLocalDevelopment() || stripeIsConfigured()) {
          return Response.json(
            { code: 'mock_disabled', message: 'Mock settlement is local-only and disabled when Stripe is configured.' },
            { status: 409 },
          )
        }

        const owner = await resolveOwner(request)
        if (!owner) {
          return Response.json({ code: 'owner_required', message: 'Owner cookie is required.' }, { status: 401 })
        }

        let raw: unknown
        try {
          raw = await request.json()
        } catch {
          return Response.json({ code: 'invalid_json', message: 'Body must be JSON.' }, { status: 400 })
        }
        const intentId = raw && typeof raw === 'object' && 'intentId' in raw && typeof raw.intentId === 'string'
          ? raw.intentId
          : ''
        if (!intentId) {
          return Response.json({ code: 'invalid_intent', message: 'intentId is required.' }, { status: 400 })
        }

        const db = database()
        const nowIso = new Date().toISOString()
        await expireOpenIntents(db, nowIso)
        const intent = await loadIntent(db, intentId)
        if (!intent || intent.ownerId !== owner.ownerId) {
          return Response.json({ code: 'intent_not_found', message: 'Checkout intent was not found.' }, { status: 404 })
        }

        const snapshot = await loadSettlementSnapshot(db, { eventId: `mock_${intent.id}`, intentId: intent.id })
        const current = snapshot.listing ? listingContribution(snapshot.listing) : 0
        const plan = await persistPaidEvent(db, {
          eventId: `mock_${intent.id}`,
          payloadHash: intent.payloadHash,
          eventType: 'youbid.mock.paid',
          providerOrderId: `mock_order_${intent.id}`,
          intentId: intent.id,
          principalPaidCents: intent.targetAmountCents - current,
          principalRefundedCents: 0,
          occurredAt: nowIso,
        })

        return Response.json({
          code: plan.kind === 'replay' ? 'replay' : plan.kind,
          intentId: intent.id,
          receipt: plan.kind === 'replay' ? plan.receiptStatus : plan.writes.receiptStatus,
        })
      },
    },
  },
})
