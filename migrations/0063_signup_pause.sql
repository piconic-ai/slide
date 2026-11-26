-- Migration number: 0063 	 2026-11-26T12:10:00.000Z
-- The operator's "stop new sign-ups" and "resume" (D-129, F42-AC12 to AC15,
-- docs/dev/f42-open-signup.md). One row each time the operator presses one of
-- the two buttons, so that the operations are kept, and the state now is the
-- newest row's. With no row, sign-up is not stopped. A row holds what was
-- pressed (paused is 1 for stopping, 0 for resuming), when in seconds, and
-- who: the operator's address as Cloudflare Access verified it, which the
-- takedowns and suspensions keep in the same way.
CREATE TABLE signup_pause_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  paused INTEGER NOT NULL CHECK (paused IN (0, 1)),
  changed_at INTEGER NOT NULL,
  changed_by TEXT NOT NULL CHECK (length(changed_by) BETWEEN 1 AND 320)
);
