import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import { accounts, profiles } from '../db/schema'
import {
  emailOf,
  lastCode,
  OWNER_ID,
  seedPerson,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)
beforeAll(() => applyMigrations(platform.env.DB))
afterAll(() => platform.dispose())

const form = (path: string, fields: Record<string, string>, cookie = '') =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields),
    }),
    env,
  )

/**
 * Runs the sign-in started with `to` through the login and welcome pages, and
 * returns the path it ends on.
 */
async function signInFrom(to: string): Promise<string | null> {
  const email = emailOf('owner')
  await seedPerson(platform.env.DB, OWNER_ID, 'owner')
  await drizzle(platform.env.DB)
    .insert(accounts)
    .values({ user_id: OWNER_ID, handle: 'owner', created_at: 1 })
    .onConflictDoNothing()
  await drizzle(platform.env.DB)
    .insert(profiles)
    .values({ user_id: OWNER_ID, name: 'Owner' })
    .onConflictDoNothing()
  await (await form('/login', { email, to })).text()
  const code = await lastCode(platform.env.DB, email)
  const entered = await form('/login/code', { email, code, to })
  const cookie =
    entered.headers
      .getSetCookie()
      .find((value) => value.startsWith('__Host-slide_owner='))
      ?.split(';')[0] ?? ''
  const welcome = await server.fetch(
    new Request(new URL(entered.headers.get('location') ?? '', TEST_ORIGIN), {
      headers: { Cookie: cookie },
    }),
    env,
  )
  const location = welcome.headers.get('location')
  return location && new URL(location, TEST_ORIGIN).pathname
}

test.each(['/@owner/talk', '/@owner/talk/3'])(
  'F17-AC18: Given sign-in started from the slide %s, When the sign-in completes, Then the reader is back on that slide',
  async (slide) => {
    expect(await signInFrom(slide)).toBe(slide)
  },
)

test.each([
  'https://elsewhere.example/@owner/talk',
  '//elsewhere.example',
  '/@Owner',
])(
  'F17-AC18: Given sign-in started with %s, When the sign-in completes, Then it ends on the decks page',
  async (to) => {
    expect(await signInFrom(to)).toBe('/my/slides')
  },
)

test('F21-AC1: Given sign-in started from the profile /@owner, When the sign-in completes, Then the reader is back on that profile', async () => {
  expect(await signInFrom('/@owner')).toBe('/@owner')
})
