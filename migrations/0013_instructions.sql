-- Instructions for agents: markdown on how to use and rebind this one page (which fields drive the wording,
-- what is fixed in the page, its quirks). They go with the page, so each version keeps its own.
ALTER TABLE isles ADD COLUMN instructions TEXT;
ALTER TABLE isle_versions ADD COLUMN instructions TEXT;
