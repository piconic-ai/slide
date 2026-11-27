import { expect, test } from 'vitest'

/**
 * The names scope 4 adds to `Env` (D-08). Each must be optional, so a Worker
 * without the binding, secret or var still type-checks and starts. Assigning
 * an empty object compiles only while every name stays optional. The bindings
 * `wrangler.jsonc` names (`ANALYTICS`, `UPLOADS_BACKUP`) are declared present
 * by `wrangler types`, so they are not here; the code still treats them as
 * possibly absent, which `src/app/scope4-unset.test.ts` runs without them.
 */
const none: Pick<
  Env,
  | 'ANALYTICS_ACCOUNT_ID'
  | 'ANALYTICS_READ_TOKEN'
  | 'DISCORD_WEBHOOK_URL'
  | 'ALERT_MAIL_TO'
  | 'ALERT_THRESHOLDS'
  | 'OPEN_SIGNUP'
> = {}

test('Given none of the scope 4 settings, When they are read, Then each is undefined', () => {
  expect(Object.values(none)).toEqual([])
})
