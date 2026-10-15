-- 1: the data is public only because a public or unlisted isle showed it (or showed data made from it),
-- so it goes private again when no such isle shows it any more. 0: public by its owner's own choice.
ALTER TABLE datasets ADD COLUMN public_auto INTEGER NOT NULL DEFAULT 0;

-- Public data that an isle shows, or that data an isle shows was made from: public through isles.
UPDATE datasets SET public_auto = 1 WHERE public = 1 AND id IN (
  WITH RECURSIVE up(id) AS (
    SELECT dst_id FROM edges WHERE src_kind = 'isle' AND rel = 'binds' AND dst_kind = 'dataset'
    UNION
    SELECT e.dst_id FROM up JOIN edges e ON e.src_kind = 'dataset' AND e.src_id = up.id AND e.rel = 'derived' AND e.dst_kind = 'dataset'
  )
  SELECT id FROM up
);
