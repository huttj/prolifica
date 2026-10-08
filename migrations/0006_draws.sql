-- Where a version drew from besides its own past: changes pulled in from another isle (a sibling
-- remix, a newer version of the original). JSON [{isle, version, note}], on the version that pulled them.
ALTER TABLE isles ADD COLUMN draws TEXT;
ALTER TABLE isle_versions ADD COLUMN draws TEXT;
-- What a version changed, part by part: JSON [{part, what}], part being a component of the page
-- (ideally its data-pid). Lets a family's history be followed for one component across isles.
ALTER TABLE isles ADD COLUMN changes TEXT;
ALTER TABLE isle_versions ADD COLUMN changes TEXT;
