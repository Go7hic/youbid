import { createFileRoute } from '@tanstack/react-router'

import { database, readProductionConfig } from '../server/env.ts'
import { persistIgnoredEvent, persistPaidEvent, persistRefundEvent } from '../server/settlement-flow.ts'
import { verifyStripeWebhookEvent } from '../server/stripe.ts'

export const Route = createFileRoute('/api/webhooks/stripe')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const verification = await verifyStripeWebhookEvent(request, readProductionConfig())
        if (!verification.ok) {
          return Response.json(
            { code: 'stripe_webhook_rejected', message: verification.message },
            { status: verification.status },
          )
        }

        const db = database()
        const event = verification.value

        if (event.kind === 'ignored') {
          await persistIgnoredEvent(db, event)
          return Response.json({ code: 'ignored', eventType: event.eventType })
        }

        if (event.kind === 'refund') {
          const plan = await persistRefundEvent(db, event.snapshot)
          return Response.json({
            code: plan.kind === 'replay' ? 'replay' : plan.kind,
            receipt: plan.kind === 'replay' ? plan.receiptStatus : plan.writes.receiptStatus,
          })
        }

        const plan = await persistPaidEvent(db, event.snapshot)
        return Response.json({
          code: plan.kind === 'replay' ? 'replay' : plan.kind,
          receipt: plan.kind === 'replay' ? plan.receiptStatus : plan.writes.receiptStatus,
        })
      },
    },
  },
})
