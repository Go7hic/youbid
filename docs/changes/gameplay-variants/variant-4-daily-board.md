# Variant 4: daily board

← [overview](overview.md)

Playability 4 · Payment pull 3 · Cost medium-low · Risk medium

## Mechanic

Rank is not cumulative principal. Rank is principal paid in the **last 24 hours**. The board reshuffles every day. Whoever spent the most today is on top.

Playability is 4: anyone can take first on any day without beating historical totals.

Payment pull is only 3 because the mechanic also weakens a stronger reason to pay. People pay a lot for a permanent first place. That is a screenshot and a pitch-deck line. Daily first is gone tomorrow, so willingness to pay per bid drops. What you get back is frequency.

## When to ship, when not to

**Do not ship this without traffic.** The daily view shows listings that paid today. In a cold start most days have zero to two rows. The board looks emptier than the cumulative board, and an empty board converts nobody.

Gate: at least 3–5 settlements a day for two weeks. Before that the expected return is negative.

**Ship it beside the main board, not instead of it.** Home keeps the all-time board (cumulative or [decayed](variant-1-decay.md)). Daily lives at `/today`. The two boards sell different things: lasting status versus today's attention. Replacing the main board gives up the higher ticket.

## Core design: the data is already in the database

No new table. `provider_orders` has `principal_paid_cents` and `occurred_at`, joined to `checkout_intents.listing_id` through `intent_id`:

```sql
SELECT ci.listing_id, SUM(po.principal_paid_cents - po.principal_refunded_cents) AS window_amount
FROM provider_orders po
JOIN checkout_intents ci ON ci.id = po.intent_id
WHERE po.occurred_at > ? AND ci.listing_id IS NOT NULL
GROUP BY ci.listing_id
```

`provider_orders.intent_id` is UNIQUE. One intent, one order. The window sum is clean.

Missing index: `provider_orders` has a primary key and a unique `intent_id`. It has no `occurred_at` index. Add one.

Refunds: subtract `principal_refunded_cents` inside the window, same as the main board. Note that a refund overwrites `occurred_at` (`applySettlement` upserts it). A payment from yesterday that refunds today enters today's window at the net amount. Decide during implementation whether that is acceptable. It may need paid-at and updated-at split.

## Phases

### Phase 1: pure-domain window ranking

**Goal.** Given order facts and a window, produce a daily ranking. Pure. Tested.

**Changes.** Add `src/domain/daily.ts`: a `WindowFact` type and `rankWindow(facts, windowStartIso)`. Reuse the `rankListings` tie-break (amount desc, time asc, id asc) so the whole site agrees.

**Data structures.** `WindowFact { listingId, amountCents, occurredAt }`. Do not reuse `RankableListing`. The daily sort input is an order, not a listing.

**Dependencies.** None.

**Verification.** Unit tests: orders outside the window do not count; multiple orders on one listing add; refunds subtract; an empty window is an empty array. `pnpm test`.

**Rollback.** Delete the file.

### Phase 2: query and index

**Goal.** Pull window facts from D1.

**Changes.** Add `loadDailyBoard(db, now)` to `src/server/db.ts`. Add a migration for `provider_orders(occurred_at DESC)`. Confirm whether overwriting paid time with refund time needs a column split.

**Data structures.** If you split, `provider_orders` needs `paid_at` separate from `updated_at`. That is the only possible schema break in this variant. Confirm before you move.

**Dependencies.** Phase 1.

**Verification.** Seed orders at different times locally. Confirm the window boundary. `EXPLAIN QUERY PLAN` must use the new index.

**Rollback.** Delete the query. The index can stay.

### Phase 3: `/today` route

**Goal.** A standalone daily page. Home does not change.

**Changes.** Add `src/routes/today.tsx`. Reuse `boardPage` pagination and the existing `.leaderboard` classes. Add an entry in `site-chrome.tsx`.

**Dependencies.** Phase 2.

**Verification.** Real surface: seed data that straddles the window and confirm the page only shows the inside. Confirm the empty state is not ugly. Empty is this variant's most common state.

**Rollback.** Delete the route and the entry.

### Phase 4: copy and reset cadence

**Goal.** Visitors know when the board resets.

**Changes.** The page states the window (rolling 24 hours versus calendar day). A rolling window is harder to explain and better for payment, because there is no "wait until tomorrow." Prefer rolling, and say so on the page. Sync `rules.tsx` and `docs/product/youbid.md`.

**Dependencies.** Phase 3.

**Verification.** Copy matches the actual window.

**Rollback.** Revert the copy.
