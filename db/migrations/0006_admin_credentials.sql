-- Admin account/password managed from the Pixel Space console.
-- Password is intentionally stored as plain text to match the requested ADMIN_PASSWORD_HASH behavior.
-- This is less secure than password hashing and is intended only for private/self-hosted deployments.
CREATE TABLE admin_credentials (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
