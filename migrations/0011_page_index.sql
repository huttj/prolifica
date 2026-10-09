-- Isles running the very same page (same source blob), found by page.
CREATE INDEX IF NOT EXISTS isles_source_blob ON isles (source_blob);
