-- How one page differs from another (worker/store.ts pageDeltas), keyed "<hash a>:<hash b>". Pages are
-- content-addressed, so a pair's delta never changes; the family view reads them here and not from R2.
CREATE TABLE page_deltas (
  pair TEXT PRIMARY KEY,
  similarity REAL NOT NULL,
  added INTEGER NOT NULL,
  removed INTEGER NOT NULL
) WITHOUT ROWID;
