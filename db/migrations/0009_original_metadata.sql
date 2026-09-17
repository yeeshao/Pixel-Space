-- Store original file size and original pixel dimensions separately from the compressed WebP preview.
ALTER TABLE images ADD COLUMN original_bytes INTEGER;
ALTER TABLE images ADD COLUMN original_width INTEGER;
ALTER TABLE images ADD COLUMN original_height INTEGER;
