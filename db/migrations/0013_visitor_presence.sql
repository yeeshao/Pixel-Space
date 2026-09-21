-- Keep one visitor presence record per IP instead of a rapidly growing
-- per-request analytics event log. first_seen_at / last_seen_at represent
-- when the IP was first and most recently seen online.
CREATE TABLE IF NOT EXISTS visitor_presence (
  ip            TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT NOT NULL DEFAULT (datetime('now')),
  user_agent    TEXT,
  cf_ray        TEXT,
  last_event    TEXT NOT NULL CHECK (last_event IN ('view', 'download'))
);

CREATE INDEX IF NOT EXISTS idx_visitor_presence_last_seen
  ON visitor_presence(last_seen_at DESC);
