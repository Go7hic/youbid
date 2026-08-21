# Variant 1: rank decay

← [overview](overview.md)

Playability 5 · Payment pull 5 · Cost medium · Risk medium

## What it solves, and what it does not

Say this first so the mechanic is not oversold.

**Solves:** revenue becomes recurring instead of one-shot. Every number is visibly falling. Stop paying and you slide. That is a stronger reason to pay than "buy a rank" (loss aversion). The mid-board keeps turning over because no one sits on a historical payment. The board shows **current** willingness to pay, not a past high.

**Does not solve:** a whale who keeps paying still holds `#1`. Decay does not knock them off. It makes them pay rent. Making the board winnable for newcomers is the job of [category boards](variant-2-categories.md), not decay.

Do not write copy that promises "anyone can take first." That is still false.

## Core design: turn a time-dependent rank into a static index key

The naive approach recomputes a decayed score on every board read. That kills the `listings_rank` expression index. Every request becomes a full scan plus sort.

Decay has a useful property: **ordering by "when this listing drops off the board" is the same as ordering by current balance.** Drop-off time is a static timestamp. It can be indexed. It never needs to be recomputed.

Under exponential decay, `score(t) = C · d^(t−s)`, where `C` is the balance at settlement, `d` is the daily decay factor, and `s` is settlement time. Let `T` be the moment the score crosses `floor`:

```
T = s + ln(C / floor) / λ        where λ = −ln d > 0
```

At any fixed read time, descending `score` ≡ descending `T`. Take logs of both sides. Constants cancel. `λ·T = (ln C + λs) − ln floor`. `ln C + λs` is the time-independent rank key.

Linear burn `score(t) = C − r·(t−s)` is the same idea: `T = s + C/r`. A top-up adds `delta/r` to `T` without first computing the current balance.

Consequences:

- One `drops_off_at` column and one ordinary index replace the expression index.
- No cron. No periodic recompute.
- A listing leaving the board **writes nothing**. It simply stops matching `WHERE drops_off_at > now`. Idempotent. Crash-safe. Matches the existing rule that a D1 batch is the only authority.
- Read-path cost stays what it is today.

### Alternatives and why they lose

**A. Compute decay in SQL on read.** `ORDER BY contribution * pow(...)`. Unclear whether D1's SQLite ships the math functions. The index dies. Rejected.

**B. Materialize `score_cents` and recompute on a Cron Trigger.** The index works. It also adds a scheduled Worker, a second write path, and a new failure mode: "the recompute hung, so rank is wrong." Operational surface for a problem a static key already removes. Rejected.

**C. Static drop-off timestamp.** Selected. Reasons above.

### Which decay shape

Prefer **exponential** (proportional). One sentence on `/rules` is enough: "3% a day." Linear burn needs "you lose $3.33 a day, so big amounts last longer." Harder to say.

Suggested starting params: `d = 0.97` (3% daily), `floor = $2` (the minimum bid). A $100 listing drops off in about 128 days. A $1000 listing in about 204. Tune after real top-up rates.

Keep the params as constants in `src/domain/decay.ts`. Do not scatter them.

## Phases

### Phase 1: pure-domain decay model

**Goal.** Pure functions compute balance and drop-off time. Tests cover them. Nothing calls them yet.

**Changes.** Add `src/domain/decay.ts`. Export `DAILY_DECAY`, `DECAY_FLOOR_CENTS`, `decayedBalance(contributionCents, settledAt, now)`, `dropsOffAt(contributionCents, settledAt)`, `toppedUpDropsOffAt(currentDropsOffAt, deltaCents, now)`. All pure.

**Data structures.** The rank key is `drops_off_at` (ISO string, same as every other time column). No new record type.

**Dependencies.** None.

**Verification.** New cases in `src/domain/domain.test.ts`: balance falls monotonically; `dropsOffAt` and `decayedBalance` produce the same order on two listings; a top-up pushes drop-off later without needing the current balance; below floor means off the board. Run `pnpm test`.

**Rollback.** Delete the file. No callers.

### Phase 2: land the column and write it at settlement

**Goal.** Every listing has a correct `drops_off_at`. The board still sorts by the old rule.

**Changes.** Add `migrations/0004_decay.sql`: `ALTER TABLE listings ADD COLUMN drops_off_at TEXT`, and backfill existing rows from `settled_at` plus current contribution. `applySettlement` in `src/server/db.ts` writes the column in the existing batch. `src/domain/settlement.ts` computes the value. `mapListing` and `ListingRecord` gain the field.

**Data structures.** `ListingRecord.dropsOffAt: string`. `SettlementWrites.listing` carries it.

**Dependencies.** Phase 1.

**Verification.** Static: `pnpm typecheck`, `pnpm test`. Real surface: pay once through the local mock loop, then `wrangler d1 execute youbid-lol --local --command "SELECT id, settled_at, drops_off_at FROM listings"` and confirm the value is sane. Top up the same listing. Confirm the timestamp moves later.

**Rollback.** Leave the column (nullable). Roll back the write path. Do not roll back the migration.

### Phase 3: switch the rank key

**Goal.** The board orders by decayed balance and the order moves with time.

**Changes.** Migrate every rank caller. No old/new parallel path:

- SQL: `loadPublicBoard` and the leader query in `loadReservationSnapshot` become `ORDER BY drops_off_at DESC, settled_at ASC, id ASC`, filter `WHERE drops_off_at > ?`.
- TS: `RankableListing` in `rankListings` carries `dropsOffAt`. `buildPublicStats`, `loadReceipt`, and `routes/index.tsx` follow.
- Migration: add `listings_decay_rank`, drop `listings_rank`.

**Data structures.** `RankableListing` changes from `{ amountCents, settledAt }` to a `dropsOffAt` primary key. `amountCents` becomes a display field. This is the only cross-boundary breaking change in the variant. Walk `architect` before it.

**Dependencies.** Phase 2, with backfill done.

**Verification.** Static suite green. Real surface: seed two listings with similar amounts, move one `settled_at` earlier by hand, confirm `/`, `/stats`, and `/receipts/$intentId` all show the same rank. Three sort sites, one answer.

**Rollback.** Restore the old `ORDER BY` and the old index. Keeping `drops_off_at` does not hurt the old path.

### Phase 4: UI and rules copy

**Goal.** A visitor can see what they are paying for.

**Changes.** Listing rows show current balance and drop-off date. Rewrite the ranking bullets in `rules.tsx`. Update every copy location listed in the overview. Sync `docs/product/youbid.md`.

**Data structures.** None new. Balance is computed at render with `decayedBalance`. That value moves with time, so SSR and the client can disagree. Use day granularity, or recompute in a client effect. Do not invent a hydration mismatch. This project already had one from `toLocaleTimeString`.

**Dependencies.** Phase 3.

**Verification.** Real surface: open the homepage in a browser and confirm no hydration warning. `/rules` matches the actual sort.

**Rollback.** Revert the copy. The mechanic stays.

### Phase 5: top-up pricing

**Goal.** "claim this rank for $N" stays accurate after decay.

**Changes.** `amountToClaim` is currently `target + $1`, but the target is falling. By the time the user pays it may not be enough. Price against the expected balance at settlement, or add a small margin. Revisit `expectedCharge = target − currentContribution` in `src/domain/settlement.ts`: after decay, "current contribution" is a function of time, and there is delay between checkout and webhook.

**Data structures.** None new. This is the easiest place in the variant to lose money. A mismatch already goes to `needs-support`. Keep that conservative path.

**Dependencies.** Phase 3.

**Verification.** Unit tests for "balance was X at checkout, X−δ when the webhook arrives." Real surface: one full Stripe test-mode webhook loop. Unit tests do not prove the money path.

**Rollback.** Fall back to static `amountToClaim`. Slight inaccuracy is acceptable for a short window.
