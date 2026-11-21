import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import { signIn, TEST_ORIGIN, testEnv } from '../publication/test-support'
import { japaneseOutside } from './test-japanese'
import { seedIntegration } from './test-integration'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env) as unknown as Env
let owner = ''
let newcomer = ''

beforeAll(async () => {
  await applyMigrations(platform.env.DB)
  ;({ owner } = await seedIntegration(env))
  newcomer = await signIn(env, 'rina', { id: '5000', welcomed: false })
})
afterAll(() => platform.dispose())

const open = async (path: string, lang: string, cookie: string) => {
  const response = await server.fetch(
    new Request(
      `${TEST_ORIGIN}${path}${path.includes('?') ? '&' : '?'}lang=${lang}`,
      {
        headers: cookie ? { Cookie: cookie } : {},
      },
    ),
    env,
  )
  expect(response.status, path).toBe(200)
  return response.text()
}

// The screens the second scope made or changed: login, welcome, settings,
// the article and its editor, related links, the profile and its lists, the
// viewer with its article and links, and the help.
const screens: ReadonlyArray<readonly [string, 'owner' | 'newcomer' | 'none']> =
  [
    ['/login', 'none'],
    ['/welcome', 'newcomer'],
    ['/settings', 'owner'],
    ['/slides/talk', 'owner'],
    ['/slides/talk/article', 'owner'],
    ['/@owner', 'none'],
    ['/@owner/cited', 'none'],
    ['/@owner/citing', 'none'],
    ['/@owner/following', 'none'],
    ['/@owner/followers', 'none'],
    ['/@owner/talk', 'none'],
    ['/notifications', 'owner'],
    ['/help', 'none'],
  ]

const cookieOf = (who: 'owner' | 'newcomer' | 'none') =>
  who === 'owner' ? owner : who === 'newcomer' ? newcomer : ''

test.each(screens)(
  'Given the screen %s, When it opens in English, Then no Japanese is left but the switcher label',
  async (path, who) => {
    expect(japaneseOutside(await open(path, 'en', cookieOf(who)))).toEqual([])
  },
)

test.each(screens)(
  'Given the screen %s, When it opens in Japanese, Then it says it is Japanese and carries Japanese text',
  async (path, who) => {
    const html = await open(path, 'ja', cookieOf(who))
    expect(html).toContain('<html lang="ja">')
    expect(html).toMatch(/[぀-ヿ一-鿿]/)
  },
)
