CREATE TABLE follows (
  follower_user_id TEXT NOT NULL,
  followee_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (follower_user_id, followee_user_id),
  CONSTRAINT follow_other_user CHECK (follower_user_id <> followee_user_id)
);
CREATE INDEX follows_followee ON follows (followee_user_id);

ALTER TABLE decks ADD COLUMN first_published_at INTEGER;
UPDATE decks SET first_published_at = (
  SELECT deployments.ready_at FROM deployments
  WHERE deployments.id = coalesce(decks.public_deployment_id, decks.resume_deployment_id)
) WHERE public_deployment_id IS NOT NULL OR resume_deployment_id IS NOT NULL;
