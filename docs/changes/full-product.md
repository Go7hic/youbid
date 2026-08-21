# Change: complete Youbid public product

Status: verified locally and deployed

## Intent

Ship the full public Youbid site, then stand up remote D1, the `youbid.lol` Worker route, and deploy. Stripe test-mode keys stay operator-installed.

## Scope

- Public board, row claim-on-hover, takeover lock, rules, not-found.
- Atomic D1 reservation, owner cookie, Turnstile gate, Stripe adapters, mock settlement.
- Idempotent paid webhook settlement and absolute refund snapshots.
- Receipt page, `/go/:listingId` click facts, live `/stats`.
- Remote D1 `youbid-lol`, production `OWNER_COOKIE_SECRET`, deploy to `youbid.lol/*` and workers.dev.

## Non-goals

- Creating a Stripe Product/Price catalog (amounts are `price_data.unit_amount`).
- Installing live Stripe keys or taking a live charge.
- Deleting existing apex DNS to convert the zone route into a Custom Domain.

## Acceptance

- [x] Domain planners cover reservation, paid settlement, replay, late takeover, refund, owner cookie, and public stats.
- [x] Typecheck and unit tests pass.
- [x] Mock checkout reserves an intent, settles through the paid planner, and can publish rank.
- [x] Stats page exposes only public board and traffic facts.
- [x] Claim pill is hover and focus-within only.
- [x] Remote D1 migrations applied; Worker responds 200 on `https://youbid.lol` and `/api/stats`.

## Design

Command-plan domain objects emit settlement and reservation plans. A thin D1 executor applies each plan in one `batch()`. Authority is `listings` plus `takeover_leases`. Traffic facts power live visitor counts.

## Product docs to update

- `docs/product/youbid.md`
- `README.md`
- `docs/decisions/0001-d1-payment-settlement.md` names and current limits only
