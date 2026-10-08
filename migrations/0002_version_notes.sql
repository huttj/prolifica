-- An update's note describes the version it made, so it belongs to that version.
-- Until now it was stored on the row for the version before; shift every note up by one.
ALTER TABLE isles ADD COLUMN note TEXT;

UPDATE isles SET note = (
  SELECT v.note FROM isle_versions v WHERE v.isle_id = isles.id AND v.version = isles.version - 1
);

CREATE TABLE version_notes_shift AS
  SELECT isle_id, version + 1 AS version, note FROM isle_versions;

UPDATE isle_versions SET note = (
  SELECT s.note FROM version_notes_shift s WHERE s.isle_id = isle_versions.isle_id AND s.version = isle_versions.version
);

DROP TABLE version_notes_shift;
