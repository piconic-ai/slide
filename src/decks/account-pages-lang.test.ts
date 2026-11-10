import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
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
  ['GET', '/decks', undefined],
  ['GET', '/decks/new', undefined],
  ['GET', '/decks/talk', undefined],
  ['POST', '/decks/talk/publication', 'action=pause&expectedRevision=0'],
])(
  'Given no session, When %s %s is answered in English, Then the sign-in prompt is English',
  async (method, path, body) => {
    const page = await expectEnglish(await request(method, path, {}, body), 401)
    expect(page).toContain('Sign in with GitHub')
    expect(page).toContain('<title>Sign in - Slide</title>')
  },
)

test('Given decks, When the deck list opens in English, Then it is English', async () => {
  const cookie = await signIn(env)
  await seedDeck(db, 'talk')
  const page = await expectEnglish(
    await request('GET', '/decks', { Cookie: cookie }),
    200,
  )
  expect(page).toContain('Allowed branches')
  expect(page).toContain('Delete account')
})

test('Given no decks, When the deck list opens in English, Then the empty list is English', async () => {
  const cookie = await signIn(env)
  const page = await expectEnglish(
    await request('GET', '/decks', { Cookie: cookie }),
    200,
  )
  expect(page).toContain('No decks yet.')
})

test('Given a handle, When the connect page opens in English, Then the steps and the workflow comment are English', async () => {
  const cookie = await signIn(env)
  const page = await expectEnglish(
    await request('GET', '/decks/new', { Cookie: cookie }),
    200,
  )
  expect(page).toContain('Register a deck and its repository')
  expect(page).toContain('# Build your slides here if needed.')
  expect(page).toContain('<code>/@owner/deck-id</code>')
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

test('Given a handle, When the connect page opens in Japanese, Then the share path keeps its Japanese placeholder', async () => {
  const cookie = await signIn(env)
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/decks/new`, { headers: { Cookie: cookie } }),
    env,
  )
  const page = await response.text()
  expect(page).toContain('<code>/@owner/デッキ ID</code> で誰でも')
  expect(page).toContain('# 必要ならここでスライドをビルドする。')
})

test('Given no handle yet, When the connect page opens in English, Then it points at the share link in English', async () => {
  const cookie = await signIn(env)
  await drizzle(db).delete(accounts)
  const page = await expectEnglish(
    await request('GET', '/decks/new', { Cookie: cookie }),
    200,
  )
  expect(page).toContain(
    'open the deck from <a href="/decks">your deck list</a>',
  )
})
