-- Photo view/download counters.
ALTER TABLE images ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE images ADD COLUMN download_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_images_view_count ON images(view_count DESC);
CREATE INDEX IF NOT EXISTS idx_images_download_count ON images(download_count DESC);
