-- Short-lived keys: an agent with a shell asks for one over MCP (api_key) to send files from disk
-- with curl. NULL: a personal key, which lasts until it is revoked.
ALTER TABLE api_tokens ADD COLUMN expires_at INTEGER;
