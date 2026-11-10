import { afterAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { testEnv, TEST_ORIGIN } from '../publication/test-support'
import { japaneseOutside } from './test-japanese'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)
afterAll(() => platform.dispose())

const get = (path: string, headers: Record<string, string> = {}) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`, { headers }), env)

const langOfPage = async (response: Response) =>
  /<html lang="([^"]+)">/.exec(await response.text())?.[1]

test.each([
  [{ 'Accept-Language': 'en' }, 'en'],
  [{ 'Accept-Language': 'en-US,en;q=0.9' }, 'en'],
  [{ 'Accept-Language': 'ja' }, 'ja'],
  [{ 'Accept-Language': 'fr, en;q=0.5' }, 'en'],
  [{ 'Accept-Language': 'fr' }, 'ja'],
  [{ 'Accept-Language': 'en;q=0, ja;q=0.1' }, 'ja'],
  [{}, 'ja'],
])(
  'Given Accept-Language %j and no choice, When a page is opened, Then it is in %s',
  async (headers, lang) => {
    expect(await langOfPage(await get('/terms', headers))).toBe(lang)
  },
)

test.each([
  ['/terms?lang=en', {}, 'en'],
  ['/terms?lang=ja', { 'Accept-Language': 'en' }, 'ja'],
  ['/terms', { Cookie: 'language=en', 'Accept-Language': 'ja' }, 'en'],
  ['/terms?lang=ja', { Cookie: 'language=en' }, 'ja'],
  // An unsupported value is skipped, so the next source decides.
  ['/terms?lang=fr', {}, 'ja'],
  ['/terms?lang=', { 'Accept-Language': 'en' }, 'en'],
  ['/terms', { Cookie: 'language=%E0%A4%A' }, 'ja'],
  ['/terms', { Cookie: 'language=fr', 'Accept-Language': 'en' }, 'en'],
] as const)(
  'Given %s with %j, When opened, Then the page is in %s',
  async (path, headers, lang) => {
    expect(await langOfPage(await get(path, headers))).toBe(lang)
  },
)

test('Given a switch to English, When the page answers, Then the choice is kept in a Lax cookie for the whole site', async () => {
  const response = await get('/terms?lang=en')
  const cookie = response.headers.get('Set-Cookie') ?? ''
  expect(cookie).toMatch(/^language=en;/)
  expect(cookie).toContain('Path=/')
  expect(cookie).toContain('SameSite=Lax')
  expect(cookie).toContain('Secure')
  expect(cookie).toContain('HttpOnly')
  expect(cookie).toMatch(/Max-Age=\d+/)
  expect(cookie).not.toContain('Domain=')
})

test.each([
  ['/terms?lang=EN', 'en'],
  ['/terms?lang=en-US', 'en'],
  ['/terms?lang=ja-JP', 'ja'],
] as const)(
  'Given the switch %s, When the page answers, Then the language shown is the one kept',
  async (path, lang) => {
    const response = await get(path)
    expect(response.headers.get('Set-Cookie')).toMatch(
      new RegExp(`^language=${lang};`),
    )
    expect(await langOfPage(response)).toBe(lang)
  },
)

test('Given a path that reads as another host, When the footer links the other language, Then the link stays on this site', async () => {
  const page = await (await get('//evil.example/x')).text()
  expect(page).toContain('href="/evil.example/x?lang=en"')
  expect(page).not.toContain('href="//')
})

test.each([
  ['/terms', { 'Accept-Language': 'en' }],
  ['/terms', { Cookie: 'language=en' }],
  ['/terms?lang=fr', {}],
  ['/missing', { 'Accept-Language': 'en' }],
] as const)(
  'Given %s with %j and no switch, When answered, Then no cookie is set',
  async (path, headers) => {
    expect((await get(path, headers)).headers.get('Set-Cookie')).toBeNull()
  },
)

test.each(['/terms', '/missing', '/'])(
  'Given the page %s, When answered, Then caches keep each language apart',
  async (path) => {
    const vary = (await get(path)).headers.get('Vary') ?? ''
    expect(vary).toContain('Accept-Language')
    expect(vary).toContain('Cookie')
  },
)

test('Given the top page revalidated, When it answers 304, Then it still varies by language', async () => {
  const first = await get('/')
  const etag = first.headers.get('ETag')
  expect(etag).toBeTruthy()
  const revalidated = await get('/', { 'If-None-Match': etag! })
  expect(revalidated.status).toBe(304)
  expect(revalidated.headers.get('Vary')).toContain('Accept-Language')
})

test('Given an API path, When it answers JSON, Then it does not vary by language', async () => {
  const response = await get('/api/no-such-thing', { 'Accept-Language': 'en' })
  expect(response.headers.get('Vary') ?? '').not.toContain('Accept-Language')
})

test.each(['/terms', '/privacy', '/contact', '/missing'])(
  'Given %s in English, When opened, Then nothing but the Japanese-only text is Japanese',
  async (path) => {
    const page = await (await get(path, { 'Accept-Language': 'en' })).text()
    expect(page).toContain('<html lang="en">')
    expect(japaneseOutside(page)).toEqual([])
  },
)

test('Given a page in Japanese, When the footer is shown, Then it links to the same page in English', async () => {
  const page = await (await get('/terms?x=1')).text()
  expect(page).toContain('href="/terms?x=1&amp;lang=en"')
  expect(page).toMatch(
    /<strong lang="ja" aria-current="true"\s*>日本語<\/strong/,
  )
})
