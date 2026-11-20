-- The author's GitHub bio, shown on their profile as text. Authors who synced
-- before this have none until they sign in or sync again.
ALTER TABLE profiles ADD COLUMN bio TEXT;
