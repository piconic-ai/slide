import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { drizzle } from 'drizzle-orm/d1'
import { accounts } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { japaneseOutside } from '../site/test-japanese'
import {
  resetTables,
  seedDeck,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = testEnv(platform.env)

beforeAll(() => applyMigrations(db))
beforeEach(() => resetTables(db))
afterAll(() => platform.dispose())

const english = { 'Accept-Language': 'en' }

const request = (
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      method,
      headers: {
        ...english,
        ...headers,
        ...(body === undefined
          ? {}
          : {
              Origin: TEST_ORIGIN,
              'Content-Type': 'application/x-www-form-urlencoded',
            }),
      },
      body,
    }),
    env,
  )

const expectEnglish = async (response: Response, status: number) => {
  expect(response.status).toBe(status)
  const page = await response.text()
  expect(page).toContain('<html lang="en">')
  expect(japaneseOutside(page)).toEqual([])
  return page
}

test.each([
  ['GET', '/slides', undefined],
  ['GET', '/slides/talk', undefined],
  ['POST', '/slides/talk/publication', 'action=pause&expectedRevision=0'],
])(
  'Given no session, When %s %s is answered in English, Then the sign-in prompt is English',
  async (method, path, body) => {
    const page = await expectEnglish(await request(method, path, {}, body), 401)
    expect(page).toContain('Sign in with GitHub')
    expect(page).toContain('<title>Sign in - Slide</title>')
  },
)

test('F03-AC36 F03-AC37: Given decks, When the deck list opens in English, Then it is English, titled Your slides, with Edit and no Manage', async () => {
  const cookie = await signIn(env)
  await seedDeck(db, 'talk')
  const page = await expectEnglish(
    await request('GET', '/slides', { Cookie: cookie }),
    200,
  )
  expect(page).toContain('<h1>Your slides</h1>')
  expect(page).toContain('Drop slides to add them')
  expect(page).toContain('Only you')
  expect(page).toContain('aria-label="Edit talk"')
  expect(page).not.toContain('Manage')
  // Leaving the service is in the settings, not beside the decks.
  expect(page).not.toContain('Delete account')
})

test('Given a signed-in author, When the settings open in English, Then the profile and the account, with the way to leave, are English', async () => {
  const cookie = await signIn(env)
  const page = await expectEnglish(
    await request('GET', '/settings', { Cookie: cookie }),
    200,
  )
  expect(page).toContain('<h1>Settings</h1>')
  expect(page).toContain('<code>@owner</code>')
  expect(page).toContain(
    '<a class="tap-area" href="/@owner">Open your profile</a>',
  )
  expect(page).toContain('action="/auth/logout"')
  expect(page).toContain('action="/account/delete"')
  expect(page).toContain('Delete account')
})

test('Given no decks, When the deck list opens in English, Then the place to drop slides is all there is, in English', async () => {
  const cookie = await signIn(env)
  const page = await expectEnglish(
    await request('GET', '/slides', { Cookie: cookie }),
    200,
  )
  expect(page).toContain('Drop slides to add them')
  expect(page).not.toContain('class="deck-rows"')
})

test('Given a mistyped username, When deleting the account in English, Then the refusal is English', async () => {
  const cookie = await signIn(env)
  const page = await expectEnglish(
    await request(
      'POST',
      '/account/delete',
      { Cookie: cookie },
      'confirm=someone-else',
    ),
    400,
  )
  expect(page).toContain('Nothing was deleted')
})
