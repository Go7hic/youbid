import { Stripe } from 'stripe'

import { sha256Hex } from '../domain/owner.ts'
import type {
  CheckoutRequest,
  PaidWebhookSnapshot,
  ProductionBoundaryResult,
  ProductionConfig,
  StripeWebhookResult,
} from './contracts.ts'

function createStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    httpClient: Stripe.createFetchHttpClient(),
  })
}

export async function createStripeCheckout(
  input: CheckoutRequest,
  config: ProductionConfig,
): Promise<ProductionBoundaryResult<{ checkoutUrl: string; sessionId: string }>> {
  if (!config.stripeSecretKey || !config.appUrl) {
    return { ok: false, status: 503, message: 'Production Stripe Checkout is not configured.' }
  }

  const stripe = createStripeClient(config.stripeSecretKey)
  const appUrl = config.appUrl.replace(/\/$/, '')
  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      client_reference_id: input.intentId,
      success_url: `${appUrl}/receipts/${input.intentId}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/?checkout=cancelled`,
      allow_promotion_codes: false,
      automatic_tax: { enabled: false },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: input.amountCents,
            product_data: {
              name: input.takeover
                ? 'Youbid first-page takeover · 3 hours'
                : 'Youbid leaderboard bid',
              description: `Paid placement for ${input.canonicalIdentity}`,
            },
          },
        },
      ],
      metadata: {
        youbid_intent_id: input.intentId,
        purchase_kind: input.takeover ? 'takeover' : 'rank',
      },
    },
    { idempotencyKey: `youbid-checkout-${input.requestId}` },
  )

  if (!session.url) {
    return { ok: false, status: 503, message: 'Stripe did not return a hosted Checkout URL.' }
  }

  return { ok: true, value: { checkoutUrl: session.url, sessionId: session.id } }
}

export async function verifyPaidStripeWebhook(
  request: Request,
  config: ProductionConfig,
): Promise<ProductionBoundaryResult<PaidWebhookSnapshot>> {
  const result = await verifyStripeWebhookEvent(request, config)
  if (!result.ok) return result
  if (result.value.kind !== 'paid') {
    return { ok: false, status: 400, message: `Unsupported Stripe event ${result.value.kind === 'ignored' ? result.value.eventType : result.value.snapshot.eventType}.` }
  }
  return { ok: true, value: result.value.snapshot }
}

export async function verifyStripeWebhookEvent(
  request: Request,
  config: ProductionConfig,
): Promise<ProductionBoundaryResult<StripeWebhookResult>> {
  if (!config.stripeSecretKey || !config.stripeWebhookSecret) {
    return { ok: false, status: 503, message: 'Stripe webhook verification is not configured.' }
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) return { ok: false, status: 400, message: 'Missing Stripe-Signature header.' }

  const rawBody = await request.text()
  const stripe = createStripeClient(config.stripeSecretKey)

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      config.stripeWebhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    )
  } catch {
    return { ok: false, status: 401, message: 'Invalid Stripe webhook signature.' }
  }

  const payloadHash = await sha256Hex(rawBody)
  const occurredAt = new Date(event.created * 1000).toISOString()

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object
    const intentId = session.metadata?.youbid_intent_id
    if (!intentId || session.payment_status !== 'paid' || session.currency !== 'usd') {
      return { ok: false, status: 409, message: 'Stripe Checkout Session is not a paid USD Youbid intent.' }
    }
    const providerOrderId =
      typeof session.payment_intent === 'string' ? session.payment_intent : session.id
    return {
      ok: true,
      value: {
        kind: 'paid',
        snapshot: {
          eventId: event.id,
          payloadHash,
          providerOrderId,
          intentId,
          principalPaidCents: session.amount_subtotal ?? session.amount_total ?? 0,
          principalRefundedCents: 0,
          occurredAt,
          eventType: event.type,
        },
      },
    }
  }

  if (event.type === 'charge.refunded') {
    const charge = event.data.object
    const providerOrderId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.id
    if (charge.currency !== 'usd') {
      return { ok: false, status: 409, message: 'Refund is not a USD Youbid charge.' }
    }
    return {
      ok: true,
      value: {
        kind: 'refund',
        snapshot: {
          eventId: event.id,
          payloadHash,
          providerOrderId,
          principalPaidCents: charge.amount,
          principalRefundedCents: charge.amount_refunded,
          occurredAt,
          eventType: event.type,
        },
      },
    }
  }

  return {
    ok: true,
    value: { kind: 'ignored', eventId: event.id, payloadHash, eventType: event.type },
  }
}
