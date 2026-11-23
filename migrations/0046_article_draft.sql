-- A published article is edited as a draft of its own, which readers do not
-- see until the author updates the publication (decision D-42, changed on
-- 2026-11-23). `draft_body` holds that edit and is NULL for an article that
-- is a draft itself or has nothing pending. `revision` grows with every write,
-- so a save made from an out-of-date screen is found and refused. Existing
-- articles keep their text and have no pending draft.
ALTER TABLE articles ADD COLUMN draft_body TEXT
  CHECK (draft_body IS NULL OR length(draft_body) <= 50000);
ALTER TABLE articles ADD COLUMN revision INTEGER NOT NULL DEFAULT 0
  CHECK (revision >= 0);
