# ADR 0001: D1 is the initial payment and ranking authority

Status: accepted

Date: 2026-08-21

## Decision

Youbid uses one TanStack Start Worker and one D1 database as the authoritative store for listings, checkout intents, provider orders, webhook receipts, takeover leases, click facts, and public traffic facts. It does not introduce Durable Objects, Queues, KV, read replication, a `board_state` table, or a second public projection.

The public rank changes only after a verified paid provider event is durably accepted and reconciled. Settlement records the provider's absolute order state and recomputes the listing contribution in one D1 batch. A checkout success redirect is presentational only.

## Why

D1 uniqueness constraints and atomic batches cover the launch races that matter:

- one open top-up checkout per listing;
- one reserved or active homepage takeover;
- one provider order per intent;
- one durable receipt per webhook id;
- deterministic rank ordering by paid amount, settlement time, and stable id.

A singleton Durable Object could serialize commands, but it would add a second schema, a projection outbox, alarms, cross-store recovery, projection lag, and a global bottleneck without closing the external transaction gap between Stripe and Cloudflare. The service becomes justified only after measured D1 contention or a new live coordination requirement fails an explicit threshold.

## Required safeguards

- Issue a signed Secure, HttpOnly, SameSite=Lax anonymous owner cookie. Only that owner can pay a difference top-up.
- Make checkout creation idempotent by `(owner_id, request_id)` plus a payload hash.
- Preserve a `checkout-uncertain` state when the provider response is lost; reconcile by intent metadata before creating another checkout.
- Allow valid payment evidence to settle after local UI expiry. Expiry blocks checkout reuse, not verified money.
- Expose a typed receipt: `awaiting-payment`, `ranked`, `takeover-active`, or `needs-support`.
- Detect a webhook id replayed with a different payload hash and quarantine it.
- Treat refunds as absolute provider snapshots. Rank contribution is principal paid minus principal refunded; tax never contributes.
- Keep metadata enrichment and redirect expansion outside the payment path until an SSRF-safe implementation is reviewed.

## Consequences

The product has a smaller operational surface and can be tested with local D1, a mock checkout gateway, and signed webhook fixtures. Public page reads and pricing share one authority. We accept advisory rank previews, numbered pagination drift during new settlements, and an explicit `needs-refund` outcome for an irreconcilable late takeover payment.

## Upgrade gates

Consider a Durable Object only when production evidence shows one of the following:

- D1 mutation contention violates the documented checkout latency or error budget;
- the product requires strongly serialized live bidding rather than advisory previews;
- global takeover scheduling expands beyond a single exclusive lease and cannot be expressed safely with D1 constraints.
