-- D1 runs each statement in its own transaction, so PRAGMA defer_foreign_keys
-- cannot cover a later DROP. Move child tables aside first, then rebuild the
-- intent table with CHECK (target_amount_cents >= 50).

CREATE TABLE checkout_intents_new (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id),
  listing_id TEXT REFERENCES listings(id),
  request_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  canonical_identity TEXT NOT NULL,
  target_amount_cents INTEGER NOT NULL CHECK (target_amount_cents >= 50),
  kind TEXT NOT NULL CHECK (kind IN ('rank', 'takeover')),
  state TEXT NOT NULL CHECK (state IN (
    'creating', 'checkout-uncertain', 'awaiting-payment', 'paid', 'expired', 'needs-support'
  )),
  provider_checkout_id TEXT UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  listing_title TEXT NOT NULL DEFAULT '',
  listing_description TEXT NOT NULL DEFAULT '',
  listing_image_url TEXT,
  UNIQUE (owner_id, request_id)
) STRICT;

INSERT INTO checkout_intents_new (
  id, owner_id, listing_id, request_id, payload_hash, canonical_identity,
  target_amount_cents, kind, state, provider_checkout_id, expires_at, created_at,
  listing_title, listing_description, listing_image_url
)
SELECT
  id, owner_id, listing_id, request_id, payload_hash, canonical_identity,
  target_amount_cents, kind, state, provider_checkout_id, expires_at, created_at,
  listing_title, listing_description, listing_image_url
FROM checkout_intents;

CREATE TABLE provider_orders_hold (
  provider_order_id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL UNIQUE,
  provider_status TEXT NOT NULL,
  principal_paid_cents INTEGER NOT NULL CHECK (principal_paid_cents >= 0),
  principal_refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK (
    principal_refunded_cents >= 0 AND principal_refunded_cents <= principal_paid_cents
  ),
  snapshot_hash TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

INSERT INTO provider_orders_hold
SELECT * FROM provider_orders;

CREATE TABLE takeover_leases_hold (
  id TEXT PRIMARY KEY,
  singleton_key INTEGER NOT NULL DEFAULT 1 CHECK (singleton_key = 1),
  intent_id TEXT NOT NULL UNIQUE,
  listing_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'ended', 'needs-refund'))
) STRICT;

INSERT INTO takeover_leases_hold
SELECT * FROM takeover_leases;

DROP TABLE takeover_leases;
DROP TABLE provider_orders;
DROP TABLE checkout_intents;
ALTER TABLE checkout_intents_new RENAME TO checkout_intents;

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

INSERT INTO provider_orders
SELECT * FROM provider_orders_hold;
DROP TABLE provider_orders_hold;

CREATE TABLE takeover_leases (
  id TEXT PRIMARY KEY,
  singleton_key INTEGER NOT NULL DEFAULT 1 CHECK (singleton_key = 1),
  intent_id TEXT NOT NULL UNIQUE REFERENCES checkout_intents(id),
  listing_id TEXT NOT NULL REFERENCES listings(id),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'ended', 'needs-refund'))
) STRICT;

INSERT INTO takeover_leases
SELECT * FROM takeover_leases_hold;
DROP TABLE takeover_leases_hold;

CREATE UNIQUE INDEX one_open_top_up_per_listing
  ON checkout_intents(listing_id)
  WHERE listing_id IS NOT NULL AND state IN ('creating', 'checkout-uncertain', 'awaiting-payment');

CREATE UNIQUE INDEX one_active_takeover
  ON takeover_leases(singleton_key)
  WHERE status = 'active';
