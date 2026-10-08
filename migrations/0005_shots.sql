-- Static previews: a screenshot of each isle, taken after it's published (shots/<isle>/v<version>.webp in R2)
ALTER TABLE isles ADD COLUMN shot_version INTEGER;
ALTER TABLE isles ADD COLUMN shot_at INTEGER;
