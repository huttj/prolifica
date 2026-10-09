-- A storage limit for one person, in bytes, overriding the default (and the admins') when set.
ALTER TABLE users ADD COLUMN quota_bytes INTEGER;
