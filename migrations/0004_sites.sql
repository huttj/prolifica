-- The site each dataset came from (see shared/site.ts), so data and collectors group by site.
-- Existing rows are filled in by the worker the next time their source changes; at the time
-- of this migration almost none had a source url.
ALTER TABLE datasets ADD COLUMN source_site TEXT;
CREATE INDEX IF NOT EXISTS datasets_site ON datasets(source_site, updated_at) WHERE source_site IS NOT NULL;
