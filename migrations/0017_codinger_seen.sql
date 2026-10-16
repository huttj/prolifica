-- When this person's Codinger (the OAuth client named Codinger) last called Prolifica: the Ask
-- menu offers Codinger only to people who have it.
ALTER TABLE users ADD COLUMN codinger_seen_at INTEGER;
