ALTER TABLE traffic_facts ADD COLUMN visitor_key TEXT;

CREATE INDEX traffic_facts_visitor
  ON traffic_facts(kind, occurred_at DESC, visitor_key);
