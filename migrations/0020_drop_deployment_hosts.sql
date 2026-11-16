-- Migration number: 0020 	 2026-11-16T13:00:00.000Z
-- The list of hosts a slide was reported to reach is no longer shown or
-- kept: a reader could do nothing with it, and no threat it answers was
-- named. See issue #139.
DROP TABLE deployment_hosts;
