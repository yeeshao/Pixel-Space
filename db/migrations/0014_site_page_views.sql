-- Site-wide page-view counter and visitor presence improvements.
-- page_views counts public webpage navigations, not individual photo views.
CREATE TABLE IF NOT EXISTS site_stats (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  page_views INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO site_stats (id, page_views) VALUES (1, 0);
