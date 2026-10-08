-- How a dataset was collected: where from, by what method, when, and the code that did it.
-- The code is a content-addressed blob, so data gathered by the same collector shares one hash.
ALTER TABLE datasets ADD COLUMN source_url TEXT;
ALTER TABLE datasets ADD COLUMN source_method TEXT;
ALTER TABLE datasets ADD COLUMN source_notes TEXT;
ALTER TABLE datasets ADD COLUMN collected_at INTEGER;
ALTER TABLE datasets ADD COLUMN source_code TEXT;
ALTER TABLE datasets ADD COLUMN source_code_lang TEXT;
CREATE INDEX IF NOT EXISTS datasets_source_code ON datasets(source_code) WHERE source_code IS NOT NULL;
