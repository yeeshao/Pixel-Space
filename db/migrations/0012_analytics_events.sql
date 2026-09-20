-- Detailed analytics events. IP/User-Agent are admin-only data.
CREATE TABLE IF NOT EXISTS analytics_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  image_key  TEXT NOT NULL,
  event      TEXT NOT NULL CHECK (event IN ('view', 'download')),
  ip         TEXT NOT NULL DEFAULT 'unknown',
  user_agent TEXT,
  cf_ray     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (image_key) REFERENCES images(key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_image_key ON analytics_events(image_key, created_at DESC);
