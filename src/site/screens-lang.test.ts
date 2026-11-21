import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import {
  authorizationFields,
  connectAgent,
  registerClient,
} from '../mcp/test-connect'
import { applyMigrations } from '../db/test-migrations'
import {
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { japaneseOutside } from './test-japanese'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env) as unknown as Env
let owner = ''
let consent = ''

beforeAll(async () => {
  await applyMigrations(platform.env.DB)
  owner = await signIn(env)
  await seedPublic(platform.env.DB, 'talk', 1, 'A talk')
  await connectAgent(env, owner, 'Agent')
  const clientId = await registerClient(env, 'Another agent')
  consent = new URLSearchParams(await authorizationFields(clientId)).toString()
})
afterAll(() => platform.dispose())

const page = async (path: string, lang: string) => {
  const query = path === '/oauth/authorize' ? `${consent}&` : ''
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}${path}?${query}lang=${lang}`, {
      headers: { Cookie: owner },
    }),
    env,
  )
  expect(response.status).toBe(200)
  return response.text()
}

// The screens a reader or an author meets that no other test reads in both
// languages: each has its text in `ja` and `en`, and neither shows the other.
const screens = [
  '/settings',
  '/notifications',
  '/help',
  '/embed/@owner/talk',
  '/oauth/authorize',
  '/slides',
  '/slides/talk',
]

test.each(screens)(
  'Given the screen %s, When it opens in English, Then no Japanese is left but the switcher label',
  async (path) => {
    expect(japaneseOutside(await page(path, 'en'))).toEqual([])
  },
)

test.each(screens)(
  'Given the screen %s, When it opens in Japanese, Then it says it is Japanese and carries Japanese text',
  async (path) => {
    const html = await page(path, 'ja')
    expect(html).toContain('<html lang="ja">')
    expect(html).toMatch(/[぀-ヿ一-鿿]/)
  },
)
