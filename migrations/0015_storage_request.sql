-- When a person asked for more storage (the button by their storage bar); cleared when an admin sets their limit.
ALTER TABLE users ADD COLUMN quota_requested_at INTEGER;
