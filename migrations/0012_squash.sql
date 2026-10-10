-- History can be rewritten (versions squashed together and renumbered), so a remix keeps the parent's
-- version it was made from as a number that a squash updates, instead of working it out by time.
ALTER TABLE isles ADD COLUMN parent_version INTEGER;
UPDATE isles SET parent_version = (
  SELECT CASE WHEN p.updated_at <= isles.created_at THEN p.version
    ELSE COALESCE((SELECT MAX(v.version) FROM isle_versions v WHERE v.isle_id = p.id AND v.created_at <= isles.created_at), 1) END
  FROM isles p WHERE p.id = isles.parent_id
) WHERE parent_id IS NOT NULL;
-- How many times its history was squashed: version numbers come back after one, so the picture's URL names this too.
ALTER TABLE isles ADD COLUMN squashes INTEGER NOT NULL DEFAULT 0;
