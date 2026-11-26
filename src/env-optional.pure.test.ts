import { expect, test } from 'vitest'

/**
 * The names scope 4 adds to `Env` (D-08). Each must be optional, so a Worker
 * without the binding, secret or var still type-checks and starts. Assigning
 * an empty object compiles only while every name stays optional.
 */
const none: Pick<
  Env,
  | 'UPLOADS_BACKUP'
  | 'ANALYTICS'
  | 'ANALYTICS_ACCOUNT_ID'
  | 'ANALYTICS_READ_TOKEN'
  | 'DISCORD_WEBHOOK_URL'
  | 'ALERT_MAIL_TO'
  | 'EMAIL_CIPHER_KEYS'
  | 'EMAIL_CIPHER_CURRENT'
  | 'EMAIL_LOOKUP_KEY'
  | 'OPEN_SIGNUP'
> = {}

test('Given none of the scope 4 settings, When they are read, Then each is undefined', () => {
  expect(Object.values(none)).toEqual([])
})
