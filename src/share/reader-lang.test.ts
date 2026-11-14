import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { applyMigrations } from '../db/test-migrations'
import { japaneseOutside } from '../site/test-japanese'
import {
  resetTables,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  // Signing in records the handle "owner" from the stubbed GitHub login.
  await signIn(env)
  await seedPublic(db, 'talk', 100, 'My talk')
})
afterAll(() => platform.dispose())

const english = { 'Accept-Language': 'en' }
const get = (path: string, headers: Record<string, string> = {}) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`, { headers }), env)

test('Given a public deck, When its viewer opens in English, Then the controls are English and the copy notice is too', async () => {
  const response = await get('/@owner/talk', english)
  expect(response.status).toBe(200)
  const page = await response.text()
  expect(page).toContain('<html lang="en">')
  expect(page).toContain('data-copied="Copied"')
  expect(page).toContain('href="/@owner/talk?lang=ja"')
  expect(japaneseOutside(page)).toEqual([])
})

test('Given a public deck, When its viewer opens in Japanese, Then the controls are Japanese', async () => {
  const page = await (await get('/@owner/talk')).text()
  expect(page).toContain('<html lang="ja">')
  expect(page).toContain('リンクをコピー')
  expect(page).toContain('data-copied="コピーしました"')
})

test("Given an author's profile, When opened in English, Then its headings and dates are English", async () => {
  const page = await (await get('/@owner', english)).text()
  expect(page).toContain('<html lang="en">')
  expect(page).toContain('Published slides')
  expect(page).toMatch(/>\s*Jan 1, 1970\s*</)
  expect(japaneseOutside(page)).toEqual([])
})

test('Given the author signed in, When their profile opens in English, Then the way to manage decks is English too', async () => {
  const cookie = await signIn(env)
  const page = await (
    await get('/@owner', { ...english, Cookie: cookie })
  ).text()
  expect(page).toContain('Manage your decks')
  expect(japaneseOutside(page)).toEqual([])
})

test.each(['/@owner/missing', '/@nobody'])(
  'Given %s, which is not available, When opened in English, Then the page says so in English',
  async (path) => {
    const response = await get(path, english)
    expect(response.status).toBe(404)
    const page = await response.text()
    expect(page).toContain('These slides are not available')
    expect(page).toContain('href="/terms"')
    expect(japaneseOutside(page)).toEqual([])
  },
)

test.each(['/', '/@owner', '/@owner/talk'])(
  'Given the public page %s, When answered, Then it names the page in each language for search engines',
  async (path) => {
    const link = (await get(path)).headers.get('Link') ?? ''
    const page = `${TEST_ORIGIN}${path}`
    expect(link).toContain(`<${page}?lang=ja>; rel="alternate"; hreflang="ja"`)
    expect(link).toContain(`<${page}?lang=en>; rel="alternate"; hreflang="en"`)
    expect(link).toContain(`<${page}>; rel="alternate"; hreflang="x-default"`)
  },
)

test.each([
  ['/@Owner/talk?lang=en', '/@owner/talk?lang=en'],
  ['/@Owner/talk?lang=EN&utm_source=x', '/@owner/talk?lang=en'],
  ['/@Owner/talk', '/@owner/talk'],
  ['/@Owner/talk?lang=fr', '/@owner/talk'],
])(
  'Given %s, When redirected to the canonical spelling, Then it moves to %s',
  async (path, location) => {
    const response = await get(path)
    expect(response.status).toBe(301)
    expect(
      new URL(response.headers.get('Location') ?? '', TEST_ORIGIN).pathname +
        new URL(response.headers.get('Location') ?? '', TEST_ORIGIN).search,
    ).toBe(location)
    expect(response.headers.get('Link')).toBeNull()
  },
)

test.each(['/@nobody', '/@owner/missing', '/@owner/%00'])(
  'Given %s, which is not available, Then it names no alternates',
  async (path) => {
    expect((await get(path)).headers.get('Link')).toBeNull()
  },
)

test.each(['/@owner/talk', '/@owner/missing'])(
  'Given %s, When answered, Then caches keep each language apart, and a deck frame’s request apart from a reader’s',
  async (path) => {
    expect((await get(path)).headers.get('Vary')).toBe(
      'Sec-Fetch-Dest, Accept-Language, Cookie',
    )
  },
)

test('Given ?lang=en and no browser language, When the viewer opens, Then it is English; a plain visit sets no cookie', async () => {
  const chosen = await get('/@owner/talk?lang=en')
  expect(await chosen.text()).toContain('<html lang="en">')
  const plain = await get('/@owner/talk')
  expect(plain.headers.get('Set-Cookie')).toBeNull()
  expect(await plain.text()).toContain('href="/@owner/talk?lang=en"')
})
