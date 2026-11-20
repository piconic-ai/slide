-- Migration number: 0030 	 2026-11-20T00:00:00.000Z
-- The trial of posts from X and Bluesky beside a deck, and of the events a
-- deck was presented at, is over. Their tables go with every row in them.
-- Citations between decks stay as they are.

-- A talk names its event, and an event its community, so they go in this
-- order.
DROP TABLE event_talks;
DROP TABLE events;
DROP TABLE communities;
DROP TABLE reaction_posts;
