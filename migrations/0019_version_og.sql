-- When the og picture of an older version was last asked for (worker/shots.ts shootOldVersion), so a
-- burst of link previews takes one picture, not many.
ALTER TABLE isle_versions ADD COLUMN og_at INTEGER;
