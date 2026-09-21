-- Store one entry/exit interval per IP in visitor_presence.
-- Timestamps are UTC ISO strings; the admin UI displays Asia/Shanghai.
ALTER TABLE visitor_presence ADD COLUMN entered_at TEXT;
ALTER TABLE visitor_presence ADD COLUMN left_at TEXT;

-- Keep existing records usable after the migration.
UPDATE visitor_presence
SET entered_at = COALESCE(entered_at, first_seen_at)
WHERE entered_at IS NULL;

UPDATE visitor_presence
SET left_at = COALESCE(left_at, last_seen_at)
WHERE left_at IS NULL;
