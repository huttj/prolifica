-- People, sign-in, sessions and personal keys (the desktop.fyi shape).
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  handle TEXT UNIQUE,
  name TEXT,
  bio TEXT,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  next TEXT,
  code_hash TEXT,                -- the 6-digit code in the same email, for signing in where you asked
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS login_tokens_email ON login_tokens(email, created_at);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS api_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  prefix TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS api_tokens_user ON api_tokens(user_id, created_at);

CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL,
  followee_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX IF NOT EXISTS follows_followee ON follows(followee_id);

-- Content-addressed bytes in R2 (key blobs/<hash>). A person's usage is the
-- size of the distinct blobs their data and isles point at, so a rebind
-- (same page, new data) costs nothing.
CREATE TABLE IF NOT EXISTS blobs (
  hash TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Data: any file a person keeps, in folders by path ("tweets/2024.csv").
CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,            -- csv | json | text | markdown | image | binary
  content_type TEXT NOT NULL,
  blob TEXT NOT NULL,
  size INTEGER NOT NULL,
  description TEXT,
  transform TEXT,                -- how it was derived, when it was
  public INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS datasets_path ON datasets(owner_id, path) WHERE deleted_at IS NULL;

-- Isles: one self-contained HTML page with named data slots, bound to data.
CREATE TABLE IF NOT EXISTS isles (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  source_blob TEXT NOT NULL,
  slots TEXT NOT NULL DEFAULT '{}',     -- {name: {kind, description}}
  bindings TEXT NOT NULL DEFAULT '{}',  -- {name: datasetId}
  parent_id TEXT,
  relation TEXT,                         -- remix | rebind | restyle (to parent)
  visibility TEXT NOT NULL DEFAULT 'public', -- public | unlisted | private
  version INTEGER NOT NULL DEFAULT 1,
  star_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS isles_owner ON isles(owner_id, updated_at);
CREATE INDEX IF NOT EXISTS isles_parent ON isles(parent_id);
CREATE INDEX IF NOT EXISTS isles_recent ON isles(visibility, updated_at);

CREATE TABLE IF NOT EXISTS isle_versions (
  isle_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  owner_id TEXT NOT NULL,
  source_blob TEXT NOT NULL,
  bindings TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (isle_id, version)
);

-- The lineage graph, both trees in one table.
--   dataset -derived-> dataset   isle -binds-> dataset   isle -uses-> isle
-- (isle -> parent isle lives on isles.parent_id/relation)
CREATE TABLE IF NOT EXISTS edges (
  src_kind TEXT NOT NULL,
  src_id TEXT NOT NULL,
  rel TEXT NOT NULL,
  dst_kind TEXT NOT NULL,
  dst_id TEXT NOT NULL,
  meta TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (src_kind, src_id, rel, dst_kind, dst_id)
);
CREATE INDEX IF NOT EXISTS edges_dst ON edges(dst_kind, dst_id, rel);

-- Stars, reactions and comments, on a whole isle or one element in it.
-- anchor_key is '' for the whole page, else the element's selector.
CREATE TABLE IF NOT EXISTS marks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  isle_id TEXT NOT NULL,
  anchor_key TEXT NOT NULL DEFAULT '',
  anchor TEXT,                   -- {selector, label, tag, text}
  snippet TEXT,                  -- the element's markup when it was marked
  kind TEXT NOT NULL,            -- star | react | comment
  emoji TEXT,
  body TEXT,
  parent_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS marks_isle ON marks(isle_id, created_at);
CREATE INDEX IF NOT EXISTS marks_user ON marks(user_id, kind, created_at);
