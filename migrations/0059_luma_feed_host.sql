-- Migration number: 0059 	 2026-11-26T09:00:00.000Z
-- Luma hands out its calendar feeds under api.luma.com, and the service now
-- asks only that host (docs/features/f33-luma-feeds.md). A Luma link saved
-- under the older api.lu.ma is moved to the same address under api.luma.com,
-- unless the community already has that one.
UPDATE community_links
SET url = 'https://api.luma.com/' || substr(url, length('https://api.lu.ma/') + 1)
WHERE kind = 'luma'
  AND url LIKE 'https://api.lu.ma/%'
  AND NOT EXISTS (
    SELECT 1 FROM community_links AS moved
    WHERE moved.url = 'https://api.luma.com/' || substr(community_links.url, length('https://api.lu.ma/') + 1)
  );
-- The record of a feed follows its address. One whose new address has a
-- record already stays behind, read by nothing: the migrations only add and
-- change (D-04), never delete.
UPDATE OR IGNORE luma_feeds
SET url = 'https://api.luma.com/' || substr(url, length('https://api.lu.ma/') + 1)
WHERE url LIKE 'https://api.lu.ma/%';
