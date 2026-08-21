PRAGMA foreign_keys = ON;

CREATE TABLE owners (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE listings (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id),
  canonical_identity TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  target_url TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  principal_paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (principal_paid_cents >= 0),
  principal_refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK (
    principal_refunded_cents >= 0 AND principal_refunded_cents <= principal_paid_cents
  ),
  settled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE checkout_intents (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id),
  listing_id TEXT REFERENCES listings(id),
  request_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  canonical_identity TEXT NOT NULL,
  target_amount_cents INTEGER NOT NULL CHECK (target_amount_cents >= 200),
  kind TEXT NOT NULL CHECK (kind IN ('rank', 'takeover')),
  state TEXT NOT NULL CHECK (state IN (
    'creating', 'checkout-uncertain', 'awaiting-payment', 'paid', 'expired', 'needs-support'
  )),
  provider_checkout_id TEXT UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (owner_id, request_id)
) STRICT;

CREATE UNIQUE INDEX one_open_top_up_per_listing
  ON checkout_intents(listing_id)
  WHERE listing_id IS NOT NULL AND state IN ('creating', 'checkout-uncertain', 'awaiting-payment');

CREATE TABLE provider_orders (
  provider_order_id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL UNIQUE REFERENCES checkout_intents(id),
  provider_status TEXT NOT NULL,
  principal_paid_cents INTEGER NOT NULL CHECK (principal_paid_cents >= 0),
  principal_refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK (
    principal_refunded_cents >= 0 AND principal_refunded_cents <= principal_paid_cents
  ),
  snapshot_hash TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE webhook_receipts (
  provider_event_id TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  event_type TEXT NOT NULL,
  provider_order_id TEXT,
  disposition TEXT NOT NULL CHECK (disposition IN ('settled', 'replay', 'quarantined', 'ignored')),
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE takeover_leases (
  id TEXT PRIMARY KEY,
  singleton_key INTEGER NOT NULL DEFAULT 1 CHECK (singleton_key = 1),
  intent_id TEXT NOT NULL UNIQUE REFERENCES checkout_intents(id),
  listing_id TEXT NOT NULL REFERENCES listings(id),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'ended', 'needs-refund'))
) STRICT;

CREATE UNIQUE INDEX one_active_takeover
  ON takeover_leases(singleton_key)
  WHERE status = 'active';

CREATE TABLE click_facts (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  referrer_host TEXT,
  country_code TEXT CHECK (country_code IS NULL OR length(country_code) = 2)
) STRICT;

CREATE INDEX listings_rank
  ON listings((principal_paid_cents - principal_refunded_cents) DESC, settled_at ASC, id ASC);
CREATE INDEX click_facts_listing_time ON click_facts(listing_id, occurred_at DESC);
