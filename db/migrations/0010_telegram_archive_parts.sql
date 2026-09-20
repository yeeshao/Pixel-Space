-- Store Telegram archive parts for originals larger than the Telegram getFile download limit.
CREATE TABLE IF NOT EXISTS telegram_archive_parts (
  image_key TEXT NOT NULL,
  part_index INTEGER NOT NULL,
  total_parts INTEGER NOT NULL,
  tg_file_id TEXT NOT NULL,
  tg_message_id INTEGER NOT NULL,
  tg_chat_id TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (image_key, part_index),
  FOREIGN KEY (image_key) REFERENCES images(key) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_telegram_archive_parts_key ON telegram_archive_parts(image_key, part_index);
