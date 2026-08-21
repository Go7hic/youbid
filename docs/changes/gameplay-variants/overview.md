# Youbid gameplay variants: ranking and execution plan

Status: proposed

This is a plan, not an implementation. Each variant has its own file with a phased execution checklist.

## Context

Youbid ranks by cumulative net principal. That number only goes up:

```sql
-- src/server/db.ts, loadPublicBoard
SELECT * FROM listings
WHERE principal_paid_cents > principal_refunded_cents
ORDER BY (principal_paid_cents - principal_refunded_cents) DESC, settled_at ASC, id ASC
```

The shape has a built-in endgame. Once someone pays enough, `#1` freezes. `/rules` still says "Paying less than first place still puts you on the board," but the homepage line "bid past your competition to get to the top" becomes false for every later visitor. The board does not die from no traffic. It dies because arrivals discover they cannot win.

Secondary effect: an incumbent listing only pays the difference (`amountToClaim` = current amount + $1). A new visitor pays the full price from zero. Incumbent advantage compounds.

This is not a bug. It is the mechanic copied from outbid.lol. The thing to change is the mechanic, not a code defect.

## Scoring

Each axis is 1–5. The criteria are explicit so the ranking is not a vibe.

**Playability** scores three things: whether the board stays winnable; whether returning players have a reason to come back; whether a new visitor can see one move they can actually make. All three true is a 5.

**Payment pull** scores how hard the mechanic itself converts a visitor into a payer: urgency, ownership, or loss aversion. Static "buy a permanent rank" is a 2–3. A mechanic that keeps producing a reason to pay is a 5.

**Cost** and **risk** do not enter the ranking. They decide execution order.

## Ranking

| # | Variant | Playability | Payment pull | Total | Cost | Risk |
|---|---|---|---|---|---|---|
| 1 | [Rank decay](variant-1-decay.md) | 5 | 5 | 10 | Medium | Medium (user understanding) |
| 2 | [Category boards](variant-2-categories.md) | 4 | 5 | 9 | Medium | Low |
| — | [Payouts to the displaced](rejected.md) | 5 | 5 | 10 | High | **Legal. Rejected.** |
| 3 | [Deposits](variant-5-deposit.md) | 5 | 3 | 8 | High | High (architecture + fees) |
| 4 | [Dutch-auction takeover](variant-3-dutch-takeover.md) | 3 | 4 | 7 | **Low** | **Very low** |
| 5 | [Daily board](variant-4-daily-board.md) | 4 | 3 | 7 | Medium-low | Medium (eats the permanent trophy) |

## Execution order is not the ranking

The ranking is attractiveness. Execution is attractiveness after risk. They differ because #1 changes the site-wide rank key, and #4 changes one pure function.

Recommended order:

1. **Dutch-auction takeover first.** It only changes `takeoverPrice` and one UI block. No schema change. Isolated to the takeover slot. It tests "does dynamic pricing lift conversion" at almost no cost.
2. **Rank decay second.** This is the only change that turns one-shot revenue into rent and keeps the mid-board moving. Whether it ships sets the project's ceiling. It follows the Dutch auction so you already have one real data point on time-based pricing.
3. **Category boards third.** Pure commercial expansion. It does not change what money means. Stack it on decay. The two are orthogonal.
4. **Daily board only after traffic.** Without volume the daily view looks empty. Empty boards do not convert.
5. **Deposits only if you are willing to redesign settlement authority.** See the architectural blocker in that file.

## Constraints

These apply to every variant:

- D1 is the single authority. Rank changes only after one successful `applySettlement` batch (`docs/decisions/0001-d1-payment-settlement.md`). No variant writes an external system on the board read path.
- Amounts are integer cents, minimum $2, step $1 (`src/domain/money.ts`).
- Migrations are additive: a new numbered file, `ALTER TABLE ... ADD COLUMN` with a default. All tables are `STRICT`. Enum columns use `CHECK (... IN (...))`.
- Domain logic stays pure. External data is parsed at the edge. The current 34 tests are all pure-domain unit tests. There are no D1 integration tests.
- The rank rule lives in SQL and TypeScript. Change one, change the other:
  - SQL order: `loadPublicBoard`, and the leader query in `loadReservationSnapshot`
  - TS order: `buildPublicStats`, `loadReceipt`, `routes/index.tsx` (re-runs `rankListings` on loader data)
- Changing the rank mechanic must change the user-visible copy. Otherwise `/rules` becomes a lie. List below.

## Copy that must move with any rank change

| Location | Content |
|---|---|
| `src/routes/rules.tsx` 30–40 | Full ranking contract, nine bullets |
| `src/routes/index.tsx` 228–229 | "bid past your competition to get to the top" |
| `src/routes/index.tsx` 254–256 | "Your amount decides the rank" |
| `src/routes/index.tsx` 396 | "first verified bid takes #1" |
| `src/ui/site-chrome.tsx` 28 | "ranked by verified principal" |
| `docs/product/youbid.md` 14 | Product-truth definition of rank |

## Applicable skills

Invoke as needed during implementation:

- `tdd` — this repo already writes the failing test first. The last seven bug fixes did.
- `architect` — variant 1 crosses the SQL/TS rank boundary. Walk it before the change.
- `how` — read `settlement.ts` or the `db.ts` batch path before touching either.
- `living-spec` — after a variant ships, update `docs/product/youbid.md` and write the settled mechanic into `docs/decisions/`.
- `unslop` — run it on any `rules.tsx` copy change.

## Project-level verification

At the end of every phase:

```bash
pnpm typecheck
pnpm test
```

Real-surface verification is the local mock loop: `POST /api/checkout` → `POST /api/mock/settle` → confirm on `/` and `/stats`. The dev server port is not fixed. Port 3000 is often taken. Read the Vite output.

Before deploy, `pnpm dry-run` to confirm bindings. Vite regenerates `wrangler.jsonc` into `dist/server/wrangler.json`. A dry-run without a rebuild reads the old config.

## Implementation guidance

- Every phase is independently verifiable and independently revertible. Do not mix variants in one commit.
- Failing test first. Pure-domain tests go in `src/domain/domain.test.ts`, `node:test` + `node:assert/strict`, relative imports with a `.ts` suffix.
- Do not keep old and new rank paths in parallel. Migrate every caller, then delete the old one.
- Variants that change real money (1 and 5) need a full Stripe test-mode webhook loop before launch. Unit tests do not prove the money path.
