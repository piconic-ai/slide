-- Migration number: 0064 	 2026-11-26T12:00:00.000Z
-- Two indexes for counting, for the limits on opening sign-up (F42,
-- docs/dev/f42-open-signup.md). Both only add an index, so no table or
-- column changes.
--   login_code_requests_total  how many login codes were asked for from every
--                              address within the window, for the total cap
--                              on login mail (D-127): the count by kind and
--                              time, whoever asked
--   accounts_created           how many people registered within a window,
--                              for the surge alert and the operator page's
--                              counts of new sign-ups (D-128)
CREATE INDEX login_code_requests_total ON login_code_requests (kind, requested_at);
CREATE INDEX accounts_created ON accounts (created_at);
