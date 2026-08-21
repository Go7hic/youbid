PRAGMA foreign_keys = ON;

CREATE TABLE traffic_facts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('board', 'stats')),
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  country_code TEXT CHECK (country_code IS NULL OR length(country_code) = 2)
) STRICT;

CREATE INDEX traffic_facts_kind_time ON traffic_facts(kind, occurred_at DESC);
