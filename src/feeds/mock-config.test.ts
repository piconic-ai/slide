import { readFile } from 'node:fs/promises'
import { afterAll, afterEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { lumaTransport } from './luma-client'
import { mockTransport } from './mock-routes'
import { feedTransportOf } from './reader-routes'

const platform = await getPlatformProxy<Env>({ persist: false })
afterAll(() => platform.dispose())
afterEach(() => {
  vi.restoreAllMocks()
})

/** The checked-in Worker configuration's values, comments removed. */
async function productionVars() {
  const text = await readFile('wrangler.jsonc', 'utf8')
  const json = text.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')
  return (JSON.parse(json) as { vars: Record<string, unknown> }).vars
}

const FEED_PATH = '/__mock/luma/ics/get?entity=calendar&id=cal-kpm'
const ask = (env: Env, origin: string, path = FEED_PATH) =>
  server.fetch(new Request(`${origin}${path}`), env)

test('F33-AC15: Given the checked-in configuration, When it is read, Then it has no switch for the local feed, and its requests go to Luma', async () => {
  const vars = await productionVars()
  expect(Object.keys(vars)).not.toContain('LUMA_FEED_MOCK')
  expect(JSON.stringify(vars)).not.toMatch(/mock/iu)
  const production = { ...platform.env, ...vars } as unknown as Env
  expect(feedTransportOf(production)).toBe(lumaTransport)
})

test('F33-AC15: Given the production settings, even with LUMA_FEED_MOCK set, When the local feed is asked for, Then it does not exist', async () => {
  const vars = await productionVars()
  for (const mock of [undefined, 'on']) {
    const production = {
      ...platform.env,
      ...vars,
      LUMA_FEED_MOCK: mock,
    } as unknown as Env
    const response = await ask(production, 'https://slide.community')
    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain('BEGIN:VCALENDAR')
  }
  expect(
    feedTransportOf({
      ...platform.env,
      ...vars,
      LUMA_FEED_MOCK: 'on',
    } as unknown as Env),
  ).toBeNull()
})

test('F33-AC15: Given a local start with the local feed on, When it is asked for, Then it answers the fixed feed, and the reader goes to it', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const local = {
    ...platform.env,
    PUBLIC_ORIGIN: 'http://localhost:8770',
    CONTENT_ORIGIN: 'http://localhost:8770',
    LUMA_FEED_MOCK: 'on',
  } as unknown as Env
  const response = await ask(local, 'http://localhost:8770')
  expect(response.status).toBe(200)
  expect(response.headers.get('ETag')).toBe('"slide-mock-v1"')
  expect(await response.text()).toContain('URL:https://lu.ma/slide-mock-one')
  const limited = await ask(
    local,
    'http://localhost:8770',
    '/__mock/luma/ics/get?entity=calendar&id=cal-mock429',
  )
  expect(limited.status).toBe(429)
  expect(limited.headers.get('Retry-After')).toBe('7200')
  expect(feedTransportOf(local)).toBe(mockTransport)
})

test('F33-AC15: Given a local start without the switch, When the local feed is asked for, Then it does not exist and nothing is read', async () => {
  const bare = {
    ...platform.env,
    PUBLIC_ORIGIN: 'http://localhost:8770',
    CONTENT_ORIGIN: 'http://localhost:8770',
  } as unknown as Env
  expect((await ask(bare, 'http://localhost:8770')).status).toBe(404)
  expect(feedTransportOf(bare)).toBeNull()
})
