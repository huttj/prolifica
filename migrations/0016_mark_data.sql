-- Images pasted into a comment are the commenter's data. Whoever can see the comment can see them,
-- without the data going public.
CREATE TABLE IF NOT EXISTS mark_data (
  mark_id TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  PRIMARY KEY (mark_id, dataset_id)
);
CREATE INDEX IF NOT EXISTS mark_data_dataset ON mark_data (dataset_id);
