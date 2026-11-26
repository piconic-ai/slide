import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server, { app } from '../app/routes'
import { HELP_CATALOG } from '../help/default-catalog'
import { helpAimPath } from '../help/paths'
import { testEnv, TEST_ORIGIN } from '../publication/test-support'
import { maintenance } from './maintenance-middleware'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)
afterAll(() => platform.dispose())

const NOW = new Date('2026-12-01T01:00:00Z')
beforeAll(() => {
  // Only the date is faked: the platform proxy needs its timers.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.setSystemTime(NOW))
afterAll(() => vi.useRealTimers())

/** A binding that fails the test the moment anything touches it. */
const forbidden = (name: string) =>
  new Proxy(
    {},
    {
      get() {
        throw new Error(`${name} was used while the service is held`)
      },
    },
  )

/** The environment with no D1 and no R2 to read. */
const withoutData = (overrides: Record<string, string>) =>
  ({
    ...env,
    DB: forbidden('D1'),
    UPLOADS: forbidden('R2'),
    ...overrides,
  }) as unknown as Env

const get = (path: string, target: Env, headers: HeadersInit = {}) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`, { headers }), target)

const END = '2026-12-01T03:00:00Z'
const HELD = `on;until=${END};reason=database`

test('F38-AC9 F38-AC13: Given an end two hours ahead, When a page is asked for, Then a 503 says the end, the reason and the links, and Retry-After is 7200', async () => {
  const response = await get('/my/slides', withoutData({ MAINTENANCE: HELD }))
  expect(response.status).toBe(503)
  expect(response.headers.get('Retry-After')).toBe('7200')
  expect(response.headers.get('Cache-Control')).toBe('no-store, no-transform')
  expect(response.headers.get('Content-Security-Policy')).toContain(
    "default-src 'none'",
  )
  const page = await response.text()
  expect(page).toContain('メンテナンス中です')
  expect(page).toContain('2026年12月1日 12:00')
  expect(page).toContain('2026-12-01 03:00 UTC')
  expect(page).toContain('データベースの保守のため')
  for (const href of ['/help', '/terms', '/privacy', '/contact'])
    expect(page).toContain(`href="${href}"`)
})

test('F38-AC15: Given the value on, When a page is asked for, Then it answers as it did before: 503, 300 seconds, no time', async () => {
  const response = await get('/my/slides', withoutData({ MAINTENANCE: 'on' }))
  expect(response.status).toBe(503)
  expect(response.headers.get('Retry-After')).toBe('300')
  const page = await response.text()
  expect(page).toContain('メンテナンス中です')
  expect(page).not.toContain('<time')
})

test.each([
  ['an end that has passed', 'on;until=2026-12-01T00:30:00Z'],
  ['no end', 'on;reason=update'],
  ['an end that cannot be read', 'on;until=sometime'],
  ['a value that cannot be read at all', '???'],
])(
  'F38-AC14 F38-AC16: Given %s, When a page is asked for, Then Retry-After is 300 and no end is shown',
  async (_, value) => {
    const response = await get(
      '/my/slides',
      withoutData({ MAINTENANCE: value }),
    )
    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('300')
    expect(await response.text()).not.toContain('<time')
  },
)

test('F38-AC28: Given the English screen, When a page is asked for, Then the maintenance page is in English', async () => {
  const response = await get(
    '/my/slides?lang=en',
    withoutData({ MAINTENANCE: HELD }),
  )
  expect(response.status).toBe(503)
  const page = await response.text()
  expect(page).toContain('Under maintenance')
  expect(page).toContain('Dec 1, 2026, 12:00 JST')
  expect(page).toContain('The service is stopped for database maintenance.')
})

test('F38-AC13 F38-AC23: Given the API, When it is asked for, Then the 503 is JSON with the end and the reason, and the same headers', async () => {
  const response = await get('/api/slides', withoutData({ MAINTENANCE: HELD }))
  expect(response.status).toBe(503)
  expect(response.headers.get('Retry-After')).toBe('7200')
  expect(await response.json()).toEqual({
    error: 'Under maintenance; retry later',
    code: 'maintenance',
    until: END,
    reason: 'database',
  })
})

test('F38-AC23: Given maintenance, When any origin answers 503, Then it carries the mark of intent and the maintenance mark with the end', async () => {
  const content = await server.fetch(
    new Request('https://other.content.example/'),
    withoutData({
      MAINTENANCE: HELD,
      CONTENT_ORIGIN: 'https://content.example',
    }),
  )
  const management = await get('/', withoutData({ MAINTENANCE: HELD }))
  for (const response of [content, management]) {
    expect(response.status).toBe(503)
    expect(response.headers.get('X-Slide-Intended')).toBe('maintenance')
    expect(response.headers.get('X-Slide-Maintenance')).toBe(`on;until=${END}`)
    expect(response.headers.get('Retry-After')).toBe('7200')
  }
})

test('F38-AC23: Given a 503 that is not maintenance, When it is answered, Then it carries no maintenance mark', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const response = await server.fetch(
      new Request(`${TEST_ORIGIN}/my/slides`, { headers: { Cookie: 'x=y' } }),
      { ...env, DB: undefined } as unknown as Env,
    )
    expect(response.headers.has('X-Slide-Maintenance')).toBe(false)
  } finally {
    log.mockRestore()
  }
})

test('F38-AC13: Given maintenance, When a deployment origin is asked for, Then it is held with the same wait', async () => {
  const id = '0b6f0b55-8c43-4d0e-9a51-3c6a3f0f6a10'
  const response = await server.fetch(
    new Request(`https://d-${id}.content.example/index.html`),
    withoutData({
      MAINTENANCE: HELD,
      CONTENT_ORIGIN: 'https://content.example',
    }),
  )
  expect(response.status).toBe(503)
  expect(response.headers.get('Retry-After')).toBe('7200')
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
})

/** Every page that stays readable, with the text that shows it is the page. */
const READABLE = [
  ['/terms', '利用規約'],
  ['/privacy', 'プライバシーポリシー'],
  ['/privacy/external', '外部への送信'],
  ['/help', 'ヘルプ'],
  ['/help?q=zip', 'ヘルプ'],
  ['/help/bot', 'Luma'],
] as const

test.each(READABLE)(
  'F38-AC17 F38-AC18: Given maintenance and no D1 and no R2, When %s is asked for, Then it opens',
  async (path, title) => {
    for (const value of ['on', HELD]) {
      const response = await get(path, withoutData({ MAINTENANCE: value }))
      expect(response.status).toBe(200)
      expect(await response.text()).toContain(title)
    }
  },
)

test('F38-AC17 F38-AC18: Given maintenance and no D1, When an aim of the help and each of its articles are asked for, Then they open, in both languages', async () => {
  const held = withoutData({ MAINTENANCE: HELD })
  const entries = HELP_CATALOG.slice(0, 6)
  expect(entries.length).toBeGreaterThan(0)
  for (const lang of ['ja', 'en']) {
    for (const entry of entries) {
      for (const path of [helpAimPath(entry.aim), entry.path]) {
        const response = await get(`${path}?lang=${lang}`, held)
        expect(response.status, path).toBe(200)
      }
    }
  }
})

test('F38-AC17 F38-AC18: Given maintenance and no D1, When the help is searched, Then the results open', async () => {
  const held = withoutData({ MAINTENANCE: HELD })
  for (const word of ['zip', 'メンテナンス', 'zzzzzz-no-such-word']) {
    const response = await get(`/help?q=${encodeURIComponent(word)}`, held)
    expect(response.status, word).toBe(200)
  }
})

test('F38-AC17 F38-AC18: Given maintenance and no D1, When the contact page and robots.txt are asked for, Then they open', async () => {
  const held = withoutData({ MAINTENANCE: HELD })
  const contact = await get('/contact', held)
  expect(contact.status).toBe(200)
  const robots = await get('/robots.txt', held)
  expect(robots.status).toBe(200)
  expect(await robots.text()).toContain('User-agent')
})

test('F38-AC18: Given maintenance and no D1, When the maintenance page is drawn in either language, Then no binding is touched', async () => {
  for (const path of [
    '/',
    '/my/slides',
    '/@someone/slide',
    '/settings?lang=en',
  ])
    expect((await get(path, withoutData({ MAINTENANCE: HELD }))).status).toBe(
      503,
    )
})

test('F38-AC17: Given the routes, When the pages of the help are listed, Then every one of them is mounted before maintenance holds the rest, so that a help page added later cannot be held, or read D1 through the middleware that follows', () => {
  const held = app.routes.findIndex((route) => route.handler === maintenance)
  expect(held).toBeGreaterThan(0)
  const help = app.routes
    .map((route, index) => ({ ...route, index }))
    .filter(
      (route) =>
        route.method === 'GET' &&
        /^\/(help|terms|privacy|contact)(\/|$)/.test(route.path),
    )
  expect(help.length).toBeGreaterThanOrEqual(4)
  for (const route of help) expect(route.index).toBeLessThan(held)
})
