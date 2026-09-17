-- Add folder-level public/private visibility.
-- Existing folders default to public so this migration does not change their current visibility behavior.
ALTER TABLE folders ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_folders_is_public ON folders(is_public);
