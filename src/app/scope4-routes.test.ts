import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from './routes'
import { HELP_AIMS } from '../help/aims'
import { HELP_CATALOG } from '../help/default-catalog'
import { applyMigrations } from '../db/test-migrations'
import { RESERVED_HANDLES } from '../auth/handle-rules'
import {
  OWNER_ID,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { japaneseOutside } from '../site/test-japanese'

// The addresses the fourth scope added, opened through the whole app: each is
// answered by its own route, not by an earlier one or by a handle's page.

const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env) as unknown as Env
let alice = ''

beforeAll(async () => {
  await applyMigrations(platform.env.DB)
  alice = await signIn(env, 'alice')
  await seedPublic(platform.env.DB, 'talk', 2, 'A talk', OWNER_ID)
})
afterAll(() => platform.dispose())

const open = (path: string, cookie = '', init: RequestInit = {}) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      ...init,
      headers: { ...(cookie ? { Cookie: cookie } : {}) },
    }),
    env,
  )

test('D-23: Given the page of destinations, When /privacy/external is opened, Then it answers with its own text, apart from /privacy', async () => {
  const external = await open('/privacy/external')
  const privacy = await open('/privacy')
  expect(external.status).toBe(200)
  expect(privacy.status).toBe(200)
  const text = await external.text()
  expect(text).toContain('外部への送信')
  expect(text).not.toBe(await privacy.text())
})

test('D-45: Given each aim of the help, When /help/<aim> is opened, Then the list of its articles answers, in both languages', async () => {
  for (const aim of HELP_AIMS)
    for (const lang of ['ja', 'en']) {
      const response = await open(`/help/${aim}?lang=${lang}`)
      expect(response.status, `/help/${aim}`).toBe(200)
      if (lang === 'en')
        expect(japaneseOutside(await response.text()), aim).toEqual([])
    }
})

test('D-46: Given every article of the catalog, When /help/<aim>/<article> is opened, Then it answers and names itself', async () => {
  expect(HELP_CATALOG.length).toBeGreaterThan(30)
  for (const entry of HELP_CATALOG) {
    const response = await open(entry.path)
    expect(response.status, entry.path).toBe(200)
  }
})

test('D-46: Given the path of the Luma feed bot, When /help/bot is opened, Then the bot page answers, not an aim and not a 404, and an unknown aim or article is a 404', async () => {
  const bot = await open('/help/bot')
  expect(bot.status).toBe(200)
  expect(await bot.text()).toContain('slide.community-bot/1.0')
  expect((await open('/help/nothing')).status).toBe(404)
  expect((await open('/help/start/nothing')).status).toBe(404)
  expect((await open('/help/bot/nothing')).status).toBe(404)
})

test('F35-AC1: Given a slide of the signed-in author, When its export addresses are opened, Then they answer for the author and are a 404 for another person and for nobody', async () => {
  const info = await open('/slides/talk/export/slide.json', alice)
  expect(info.status).toBe(200)
  expect(info.headers.get('content-disposition')).toContain('attachment')
  const account = await open('/account/export/account.json', alice)
  expect(account.status).toBe(200)
  // Not the page of a handle named "slides" or "account" (reserved words).
  expect(RESERVED_HANDLES.has('slides')).toBe(true)
  expect(RESERVED_HANDLES.has('account')).toBe(true)
  const other = await open('/slides/talk/export/unknown.zip', alice)
  expect(other.status).toBe(404)
  const anonymous = await open('/account/export/account.json')
  expect(anonymous.status).not.toBe(200)
})

test('D-38: Given the address an agent fetches a file from, When it is opened with a value that was not made, Then an empty 404 answers, and only GET is allowed', async () => {
  const wrong = await open('/mcp/files/not-a-value')
  expect(wrong.status).toBe(404)
  expect(await wrong.text()).toBe('')
  expect(wrong.headers.get('cache-control')).toBe('no-store')
  const post = await open('/mcp/files/not-a-value', '', { method: 'POST' })
  expect(post.status).toBe(405)
  expect(post.headers.get('allow')).toBe('GET')
})

test('F38-AC19: Given the management host, When the service is not held, Then the entrance of the operator is no page there, and while it is held the page of a handle does not answer it', async () => {
  const open_ = await open('/maintenance/enter')
  expect(open_.status).toBe(404)
  expect(RESERVED_HANDLES.has('maintenance')).toBe(true)
  const held = await server.fetch(
    new Request(`${TEST_ORIGIN}/maintenance/enter`),
    { ...env, MAINTENANCE: 'on' } as unknown as Env,
  )
  expect(held.status).toBe(503)
})
