CREATE TABLE IF NOT EXISTS telegram_inbox (
  id                 TEXT PRIMARY KEY NOT NULL,
  r2_key             TEXT NOT NULL UNIQUE,
  tg_file_id         TEXT NOT NULL,
  tg_message_id      INTEGER NOT NULL,
  tg_chat_id         TEXT NOT NULL,
  original_filename  TEXT NOT NULL DEFAULT '',
  mime               TEXT NOT NULL,
  width              INTEGER NOT NULL,
  height             INTEGER NOT NULL,
  bytes              INTEGER NOT NULL,
  hash               TEXT NOT NULL,
  caption            TEXT,
  status             TEXT NOT NULL DEFAULT 'pending',
  error              TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_telegram_inbox_status_created ON telegram_inbox(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_inbox_hash ON telegram_inbox(hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_inbox_tg_message ON telegram_inbox(tg_chat_id, tg_message_id);
