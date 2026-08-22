# Youbid product truth

Status: current

Youbid is a public paid leaderboard at youbid.lol. A visitor chooses an absolute bid, submits a URL or @handle, pays through hosted checkout, and appears at the rank determined by their current decayed balance.

## Current behavior

- The home page shows the first-place amount, a default bid of first place plus one dollar, live projected rank, pagination of 50 listings per page, and a three-hour first-page takeover whose price starts at four times current first place after the last takeover ends and falls to 1.2× over 24 hours.
- Hovering or focusing a leaderboard row reveals a coral pill: `claim this rank for $N`, where N is that row’s current decayed amount plus one dollar. The pill sets the same global bid field and continues the existing identity and checkout flow. Mouse leave hides it. Keyboard users reach it through focus-within.
- Each listing shows the date it will drop off the board. That date is the rank key. A listing below the $1 floor is gone; leaving writes nothing.
- Identity is a public URL or X handle (`@name`, `name`, `x.com/name`, `twitter.com/name`). Query strings are stripped. Invite hosts are rejected. A URL scrape prefills title, description, and favicon when it can. Missing name or description must be filled before checkout. Handles are parsed but not fetched from X; the visitor supplies title and description. That copy is stored on the intent and written onto the listing at settlement.
- Checkout reserves a D1 intent before any provider call. Creating or confirming checkout never changes the board.
- Only a verified, idempotent paid webhook — or the local mock settlement that uses the same planner — publishes or raises a listing.
- Rank is drop-off time descending (equivalent to current decayed balance), then settlement time, then stable id. Balance falls 3% a day from each settlement. A raise extends drop-off from the live balance plus the new payment. Takeover price still tracks current first place.
- A product identity can be raised only by its owning visitor cookie. Secrets and ownership tokens never enter client loader data.
- After checkout return, `/receipts/$intentId` is presentational and polls until settlement. Typed receipts are `awaiting-payment`, `ranked`, `takeover-active`, or `needs-support`.
- `/go/$listingId` records a click fact and redirects to a sponsored outbound URL.
- `/stats` is a live public stats page. Every figure is computed from D1 at request time; nothing is cached or precomputed. It refreshes every few seconds with listing count, volume, first place, takeover state, recent settlements, visitors, and outbound clicks. It does not show secrets, owner tokens, or checkout internals.
- Visitor figures count distinct visitors, not page views. A board view records one traffic fact carrying a `youbid_visitor` cookie: a random id with no owner authority, 30-day lifetime, and the counts are `COUNT(DISTINCT visitor_key)` over 5-minute, 1-hour, and 24-hour windows. Rows written before that cookie existed fall back to their own id and count once each.
- Viewing `/stats` or `/api/stats` records no traffic fact. Those loaders poll, so recording there would bill one open tab as hundreds of visits an hour and inflate a number nobody reads.
- `/rules` states the public contract: rank by current decayed balance at 3% a day, owner-only raises while live, the falling takeover auction, identity rules, and refunds. Unmatched routes render a Youbid not-found page.
- Rules copy has one source, `src/content/rules.ts`. `/rules` renders it as HTML and `/rules.md` serves the same sections as Markdown, so the human and machine-readable versions cannot drift.
- `/llms.txt`, `/robots.txt`, and `/sitemap.xml` are static assets. `robots.txt` allows the board, rules, stats, and `/api/stats` while disallowing `/api/`, `/go/`, and `/receipts/`. The document head carries Organization, WebSite, and WebApplication JSON-LD whose claims also appear in visible copy.
- Local development uses mock checkout. Local and production boards show only D1-paid rows. Production never settles mock payments.

## Failure and boundary scenarios

- Replayed webhooks with the same payload hash are no-ops. The same event id with a different hash is quarantined.
- A late takeover payment never creates a second active lease. The receipt becomes `needs-support` and the lease is marked `needs-refund`.
- Refunds apply an absolute provider snapshot. Rank contribution is recomputed. Tax never contributes.
- Expiry blocks checkout reuse. Verified money that arrives late still settles.
- If Stripe is configured, mock settlement is rejected. If Stripe is not configured, `/api/checkout` still reserves an intent and `/api/mock/settle` runs the paid planner.
- Missing owner-cookie signing with Stripe configured refuses checkout. Local mock uses a local-only signing secret.

## Product constraints

- Amounts are integer cents, displayed as USD, minimum $1, step $1.
- Outbound targets open as sponsored placements.
- The mobile layout keeps the same interaction order without horizontal overflow.
- Remote D1 `youbid-lol` (`5fc1f229-ee89-42c9-8d44-fe7af9c0d15a`) is live. The Worker is deployed on `youbid.lol/*` and `https://youbid-lol.gtfx0209.workers.dev`. Stripe and Turnstile remain unset until test-mode keys are installed.

## Technical constraints

- D1 is the single authority for owners, listings, checkout intents, provider orders, webhook receipts, takeover leases, click facts, and traffic facts. There is no `board_state` table.
- Settlement and refund writes apply one planned D1 batch. Public rank changes only after that batch succeeds.
- Owner cookie is signed, HttpOnly, SameSite=Lax. Only the hashed token is stored.

## Verification surfaces

- `pnpm typecheck`
- `pnpm test`
- Deployed board: `https://youbid.lol` and `https://youbid-lol.gtfx0209.workers.dev`
- Local mock loop: POST `/api/checkout`, POST `/api/mock/settle`, then confirm the listing on `/` and `/stats`
- `/stats` polling, `/go/$listingId` click increment, `/receipts/$intentId` after return

## Related decisions

- `docs/decisions/0001-d1-payment-settlement.md`
