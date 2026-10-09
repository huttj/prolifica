-- When this person's AI last reached /mcp (any client, OAuth or a personal key). Lets the app tell
-- whether they've connected one before handing them off to it.
ALTER TABLE users ADD COLUMN mcp_seen_at INTEGER;
