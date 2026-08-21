ALTER TABLE listings ADD COLUMN drops_off_at TEXT;

-- Live rows without ln() in D1 stay visible until the next settlement writes a real T.
UPDATE listings
SET drops_off_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+400 days')
WHERE principal_paid_cents > principal_refunded_cents AND settled_at IS NOT NULL;

UPDATE listings
SET drops_off_at = settled_at
WHERE drops_off_at IS NULL AND settled_at IS NOT NULL;

CREATE INDEX listings_decay_rank
  ON listings(drops_off_at DESC, settled_at ASC, id ASC);

DROP INDEX IF EXISTS listings_rank;
