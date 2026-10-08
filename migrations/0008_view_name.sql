-- What kind of page an isle is, in a few words ("Discourse map", "City guide"): the format, not the
-- content. The map names each group of same-view isles with it. A rebind inherits its parent's.
ALTER TABLE isles ADD COLUMN view_name TEXT;
