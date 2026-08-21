<img src="public/logo.avif" alt="Youbid" width="120">

# Youbid

you bid, you get.

Youbid is a paid public leaderboard at [youbid.lol](https://youbid.lol). A visitor picks a whole-dollar bid, submits a product URL or X handle, pays through hosted Stripe Checkout, and ranks by successfully paid principal. Creating checkout never changes the board. Only a verified paid webhook does.

## What you get

- A public board with live projected rank and hover/focus **claim this rank** pills
- Identity as a URL or `@handle`. Youbid tries to read a title, description, and favicon from the page. If that fails — or the input is an X handle — the visitor fills title and description before paying
- Hosted Stripe Checkout for the reserved bid. Localhost can mock-settle through the same planner
- A three-hour first-page takeover at twice the current #1 amount
- `/stats` for live listings, volume, visitors, and outbound clicks
- `/go/$listingId` records a click and redirects to the sponsored URL
- `/receipts/$intentId` after return from checkout

## Stack

TanStack Start on Cloudflare Workers, D1 as the authority store, Stripe Checkout with **dynamic** `price_data.unit_amount`. There is no Stripe Product or Price catalog. Each bid is one ad-hoc line item in integer cents. Package manager is **pnpm**.

## Local setup

```bash
git clone <this-repo>
cd youbid
pnpm install
cp .dev.vars.example .dev.vars
pnpm exec wrangler d1 migrations apply youbid-lol --local
pnpm dev
```

Open `http://localhost:3000`. Keep `APP_URL="http://localhost:3000"` in `.dev.vars` so mock checkout stays local. Fill secret **names** from the example file; never commit real keys.

```bash
pnpm typecheck
pnpm test
```

`wrangler.jsonc` binds `DB` to D1 database `youbid-lol`. Schema is in `migrations/`. Apply a new file the same way (`--local` for Vite, `--remote` for production).

## Local vs production

The board is paid D1 rows only, locally and on [youbid.lol](https://youbid.lol). An empty board is correct until a live payment settles. Mock checkout and `POST /api/mock/settle` run only when `APP_URL` is localhost.

## Deploy

```bash
pnpm exec wrangler d1 migrations apply youbid-lol --remote
pnpm run deploy
```

Set production secrets with `pnpm exec wrangler secret put` (`OWNER_COOKIE_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`). Do not commit `.dev.vars`.

## Automatic deploys

This is **Workers Builds**, not Pages. On the existing Worker `youbid-lol`: **Settings → Builds → Connect**. The dashboard Worker name must match `name` in `wrangler.jsonc` (`youbid-lol`).

Workers Builds does **not** honor a `[build]` block in Wrangler. Commit `pnpm-lock.yaml` so the build image installs with pnpm. Fill **Settings → Build**:

| Field | Value |
| --- | --- |
| Git branch | `main` |
| Root directory | leave empty (repo root) |
| Build command | `pnpm run build` |
| Deploy command | `pnpm exec wrangler deploy` |
| Non-production branch deploy command | `pnpm exec wrangler versions upload` (only if you enable non-production branch builds) |
| API token | leave the auto-created token |

There is **no install command**. The image installs from `pnpm-lock.yaml`. Do not set `pnpm run deploy` as the deploy command: that script already runs `vite build`, so you would build twice.

Do not put Stripe keys, webhook secrets, or `OWNER_COOKIE_SECRET` in **Build variables**. Those are runtime secrets: **Settings → Variables & Secrets**, or `pnpm exec wrangler secret put`. `APP_URL` is already a Wrangler `vars` value (`https://youbid.lol`). Build vars are not available at runtime.

D1 migrations are not part of `wrangler deploy`. After a schema change, run `pnpm exec wrangler d1 migrations apply youbid-lol --remote` yourself (idempotent), or prepend that command to the deploy command if you want it on every push.

Docs: [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

## Stripe

Hosted Checkout builds one line item from the reserved bid cents:

```ts
price_data: { currency: 'usd', unit_amount: reservedBidCents, product_data: { name, description } }
```

Live webhook: `https://youbid.lol/api/webhooks/stripe`

Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`.

Success URL is `/receipts/$intentId?session_id={CHECKOUT_SESSION_ID}`. Cancel URL is `/?checkout=cancelled`. No publishable key; Checkout is hosted.

## Routes

| Path | Role |
| --- | --- |
| `/` | Public board and bid form |
| `/stats` | Live public facts |
| `/rules` | Ranking contract |
| `/receipts/$intentId` | Checkout return |
| `/go/$listingId` | Sponsored outbound + click |
| `/api/resolve` | Normalize identity and scrape metadata |
| `/api/checkout` | Reserve intent, then Stripe or local mock |
| `/api/mock/settle` | Local paid planner only |
| `/api/webhooks/stripe` | Verified paid and refund settlement |
| `/api/stats` | Public stats JSON |

## Docs

Product truth: `docs/product/youbid.md`. Settlement decision: `docs/decisions/0001-d1-payment-settlement.md`.

## License

MIT. See `LICENSE`.
