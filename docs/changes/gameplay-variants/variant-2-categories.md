# Variant 2: category boards

← [overview](overview.md)

Playability 4 · Payment pull 5 · Cost medium · Risk low

## Mechanic

There is one `#1` on the whole site. Only one person can claim it. Split into N categories and there are N `#1`s, each much cheaper.

Payment pull is a 5 because of price, not novelty. First in a narrow category might be $20. Site-wide first might be $500. Far more people will pay $20, and they still get a real first place. That is a conversion change, nothing else.

This is also the main way the board becomes winnable for newcomers. [Decay](variant-1-decay.md) makes whales pay rent. Categories give newcomers somewhere to win. Orthogonal. Stackable.

## Core design: scope of identity uniqueness

`listings.canonical_identity` is globally UNIQUE today. After categories there are two options.

**A. Keep global uniqueness. Category is chosen on first payment and cannot change.** One URL lives in one category. Smallest change. The `UNIQUE` constraint stays. Ownership stays (`canRaiseListing` is untouched).

**B. Change to `UNIQUE (canonical_identity, category)` so the same URL can pay in several categories.** Higher revenue ceiling. The same product then occupies every board. The leaderboard becomes one person's show, and visitors cannot tell which self they are paying for.

Choose **A**. B's extra revenue comes from allowing board-stuffing, and stuffing is exactly what destroys the only thing this product sells: a board people believe. Experience-first versus short-term revenue. Pick experience.

Hard-code a small enum first (6–10). Do not let visitors create categories. User-created categories collapse into one category per person and everyone is first.

## Phases

### Phase 1: category model and validation

**Goal.** A category enum and a parser. Illegal values die at the boundary.

**Changes.** Add `src/domain/category.ts`. Export `CATEGORIES`, a `Category` type, and `parseCategory(raw: unknown): Category | null`. Wire it into checkout-body parsing in `src/server/parse.ts`.

**Data structures.** `Category` is a string-literal union. It must match the D1 `CHECK (category IN (...))`. If the two enums drift, settlement hits a CHECK failure. That path now throws instead of silently acknowledging a replay (`src/server/d1-errors.ts`). Keep it that way.

**Dependencies.** None.

**Verification.** Unit tests: valid values pass; invalid and missing values return null; case and whitespace are handled. `pnpm test`.

**Rollback.** Delete the file and the parse hook.

### Phase 2: land the column and write through

**Goal.** New listings persist a category. The board still ignores it.

**Changes.** `migrations/0004_categories.sql` (renumber if decay landed first): add `category TEXT NOT NULL DEFAULT 'other' CHECK (category IN (...))` to `listings` and `checkout_intents`. Store it on the intent. Write it onto the listing at settlement, same as `listing_title`. Extend `IntentRecord`, `ListingRecord`, `applySettlement`, and `insertIntent`.

**Data structures.** Category travels with the intent into settlement because the visitor picks it at checkout and the listing is created at settlement. Same shape as title/description in `0003_listing_metadata.sql`. Keep that shape.

**Dependencies.** Phase 1.

**Verification.** Local mock loop with a category on the payment. `SELECT id, category FROM listings` confirms the value. Existing 34 tests stay green (the default keeps the old path working).

**Rollback.** Keep the column. Roll back the read/write path.

### Phase 3: category board route

**Goal.** `/c/$category` shows one category. Home stays the site-wide board.

**Changes.** Add `src/routes/c.$category.tsx`. `loadPublicBoard` takes an optional category and the SQL adds `AND category = ?`. Index: `listings_rank` needs a category-prefixed version, or a category query becomes a full scan then a filter.

**Data structures.** Board queries go from one global order to an order partitioned by category. Index shape `(category, <rank key>)`. If decay has already landed, the rank key is `drops_off_at`.

**Dependencies.** Phase 2.

**Verification.** Static suite green. Real surface: seed two listings in each of three categories. Visit each `/c/$category` and confirm only that category appears, ranks starting at 1. An unknown category is a 404, not an empty board.

**Rollback.** Delete the route. An empty category argument restores site-wide behavior.

### Phase 4: composer and pricing

**Goal.** The visitor picks a category at bid time and sees that category's real floor price.

**Changes.** Add a category picker to the composer in `routes/index.tsx`. `leaderAmount` becomes first place **in the chosen category**, not site-wide first. That means the leader query in `loadReservationSnapshot` must filter by category too. Otherwise the visitor is charged the site-wide price. That is a money-correctness bug, not a display bug. Inputs to `amountToClaim` and `takeoverPrice` follow.

**Data structures.** `ReservationSnapshot.leaderAmountCents` changes from global to in-category. Whether takeover is also per-category is a separate decision. `one_active_takeover` is a partial unique index on `singleton_key`. Per-category takeovers replace that with the category column. First version: keep takeover site-wide. Do not move two mechanics at once.

**Dependencies.** Phase 3.

**Verification.** Real surface: bid in category A and confirm the Stripe charge equals category A's floor, not the site-wide floor. Stripe test mode. The UI is not enough.

**Rollback.** Composer loses the picker. Default category is `other`.

### Phase 5: navigation and copy

**Goal.** Visitors can find categories. `/rules` states the contract.

**Changes.** Category nav on home and in `site-chrome.tsx`. `rules.tsx` says category cannot change and identity stays globally unique. Whether `/stats` splits by category is a separate call. Sync `docs/product/youbid.md`.

**Dependencies.** Phase 4.

**Verification.** Real surface: home to every category page and back. `/rules` matches behavior.

**Rollback.** Revert copy and nav.
