# Variant 5: deposits

← [overview](overview.md)

Playability 5 · Payment pull 3 · Cost high · Risk high

**Status: conditional. Do not land this until the architectural blocker below is resolved.**

## Mechanic

A bid becomes a deposit, not a spend. When someone outbids you, principal returns. The platform keeps a percentage fee.

Playability is a real 5. The mental bar moves from "spend $100" to "park $100." Bid volume rises a lot. Being outbid is no longer a pure loss, so people stay in the loop.

Payment pull is only 3 because **this is a different business**. Revenue moves from principal to fees. Revenue per bid drops one or two orders of magnitude and has to be made up in volume. That is not a feature flag. It is a business-model change. Ship it before there is real traffic and revenue collapses.

## Architectural blocker

This variant collides with a core invariant. A new column will not fix it.

**Collision: a refund has to be initiated on the board-update path.**

`docs/decisions/0001-d1-payment-settlement.md` says D1 is the single authority, rank changes only after one successful `applySettlement` batch, and the board read path writes no external system.

Deposits require "A outbids B" to do two things at once: update rank (a D1 write) and refund B (a Stripe API call). Those two cannot share one atomic batch. A crash in the middle produces one of two bad states: rank updated and no refund (you owe the user), or refund sent and rank not updated (the money is gone and the seat is still theirs).

The workable shape is a **refund queue**: the settlement batch writes a "pending refund" row in D1. A Cloudflare Queue or Cron consumes it, calls Stripe, and writes the result back. The system moves from "one batch, done" to "eventual consistency plus compensation." That is an architecture change, not an incremental feature.

There is a related precedent: takeover already has `needs-refund` (`takeover_leases.status` CHECK includes it). The system already treats "needs a refund that has not happened" as a legal intermediate. Deposits make that edge the happy path.

## Other questions that must be answered first

**Who eats Stripe fees.** Every refund has already paid an acquire fee. High outbid frequency can eat the entire margin. Compute first: assume a seat is outbid N times a day, what does fee cost look like. If that number does not work, stop.

**Disputes and chargebacks.** High refund volume raises dispute rate. Stripe has thresholds.

**Deposit cap.** An uncapped deposit pool means you can owe users a large sum at any moment. In many jurisdictions that is custody.

**CHECK constraints.** `listings.principal_refunded_cents <= principal_paid_cents` and the matching `provider_orders` check still hold when refunds are normal. `planRefundSettlement` currently treats a full refund as the listing leaving the board (the identity-release change from this pass). Under deposits a full refund is ordinary flow, not an exit. That semantics needs a redesign.

## Recommendation

Do not treat this as the next feature. Treat it as a separate decision: **are you building a paid board or an auction market.**

If the answer is an auction market, do not bolt deposits onto the current code. Write an ADR in `docs/decisions/` that moves settlement authority from "one batch" to "batch plus a compensation queue," then implement deposits on the new shape. Use `architect`.

If the answer is a paid board, reject this variant and remove it from the plan. Do not leave it sitting in a backlog.

## If you still go: first step

No code. A one-page numbers sheet:

- assumed DAU and daily settled bids
- assumed outbid frequency
- Stripe fees versus fee revenue
- size of the deposit pool at any moment

If that sheet does not produce a positive number, stop. This is build-the-lever: an hour of arithmetic instead of weeks of implementation.
