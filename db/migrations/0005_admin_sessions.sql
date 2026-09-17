-- Admin password-login sessions. Store only SHA-256 hashes of random session tokens.
CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  email      TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_admin_sessions_expires_at ON admin_sessions (expires_at);
