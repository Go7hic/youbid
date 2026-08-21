# Variant 3: Dutch-auction takeover

← [overview](overview.md)

Playability 3 · Payment pull 4 · Cost low · Risk very low

**Ship this one first.**

## Why first

Playability is only 3 because it touches one slot and leaves the main board alone. It is also the only variant whose cost and risk are near zero:

- No schema change.
- The work is one pure function, `takeoverPrice`, plus one UI block.
- Isolated to the takeover slot. Main-board rank does not move.
- Worst failure is a bad takeover price. Main-board money is untouched.

The real value is **testing one hypothesis cheaply**: does dynamic pricing lift conversion. That answer decides whether to invest in [decay](variant-1-decay.md), which is also "let the price move with time." Try it on the takeover slot first. Smarter than rewriting site-wide rank.

This is build-the-lever: a cheap experiment before the large change.

## Mechanic

Takeover is a fixed price today: `takeoverPrice(leader) = max($2, 2 × leader)` in `src/domain/money.ts:22-24`. `/rules` at `rules.tsx:37` says "twice the current first-place amount."

2× is a guess. Too high and nobody buys. Too low and page one is undersold. A Dutch auction lets the market set the price. After the last takeover ends, the price starts high and falls until someone takes it or it hits the floor.

Two effects. Price discovery is one. The stronger one is **urgency**. A falling price creates "buy now or someone else picks it up tomorrow." A fixed price has no clock. Visitors can delay forever, and delay is a no.

## Core design: where the clock starts

Price is a function of time since the last takeover ended. No new column:

```sql
SELECT MAX(ends_at) FROM takeover_leases WHERE status = 'ended'
```

No rows (never a takeover) fall back to a fixed opening price. Read-only. No schema change.

`takeoverPrice` changes from `(leaderAmountCents) => number` to `(leaderAmountCents, idleMs) => number`. Still pure. Still easy to test.

Suggested curve: open at `4 × leader`, fall linearly to a floor of `1.2 × leader` over 24 hours, then sit. Constants, not scattered literals.

One edge: `leader` itself moves. If someone takes a new first place during the idle window, the base rises. That is correct. Page one is worth more when first place paid more.

## Phases

### Phase 1: pricing function

**Goal.** A pure function prices from idle time. Tests cover both ends of the curve and the midpoint.

**Changes.** `takeoverPrice` in `src/domain/money.ts` takes `idleMs`. Add three constants: opening multiple, floor multiple, fall window.

**Data structures.** No new types. Keep the `MINIMUM_BID_CENTS` floor. Keep integer cents.

**Dependencies.** None.

**Verification.** Unit tests: `idleMs = 0` is the opening price; `idleMs >= window` is the floor; the midpoint sits between them and the function is monotone decreasing; a zero leader still meets the minimum bid. `pnpm test`.

**Rollback.** Default `idleMs` to 0 and the old multiple returns.

### Phase 2: wire the reservation snapshot

**Goal.** Checkout validates against the dynamic price. The charge is correct.

**Changes.** `loadReservationSnapshot` adds a query for the last ended takeover (fits in the existing five-statement batch). `ReservationSnapshot` gains the field. The takeover branch in `planReserveCheckout` validates against the dynamic price.

**Data structures.** `ReservationSnapshot.takeoverIdleSinceIso: string | null`. Null means there has never been a takeover.

**Dependencies.** Phase 1.

**Verification.** Static suite green. Real surface: this is what the visitor is actually charged, so it must be checked. Seed a lease with `status='ended'` and `ends_at` a few hours ago. Run a mock takeover checkout. Confirm the charge sits on the curve.

**Rollback.** Validation returns to the fixed multiple. The extra snapshot field is harmless.

### Phase 3: UI and countdown

**Goal.** The visitor sees the price falling.

**Changes.** The `.takeover-offer` block in `routes/index.tsx` (around line 349) shows the current price and when it next drops. `chooseTakeover()` prefills the dynamic price.

**Data structures.** Price moves with time, so SSR and the client can disagree. Anchor to the server timestamp, or refresh in a client effect. Do not call `Date.now()` during render. This project already had a hydration error from time formatting.

**Dependencies.** Phase 2.

**Verification.** Real surface: open the homepage, no hydration warning. Wait or move the reference time by hand and confirm the displayed price falls. Click "Take over" and confirm the prefilled amount matches the displayed price.

**Rollback.** UI shows a static price. The mechanic still works.

### Phase 4: rules copy

**Goal.** `rules.tsx:37` is no longer a lie.

**Changes.** Replace "A takeover costs twice the current first-place amount" with a Dutch-auction sentence. Sync `docs/product/youbid.md:9` (it currently says "at twice the current first-place amount").

**Dependencies.** Phase 3.

**Verification.** Copy matches the actual price. Run `unslop`.

**Rollback.** Revert the copy.
