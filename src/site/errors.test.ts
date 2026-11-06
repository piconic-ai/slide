import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { afterAll, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { testEnv, TEST_ORIGIN } from '../publication/test-support'
import { notFound, onError } from './errors'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)
afterAll(() => platform.dispose())

const get = (path: string, overrides: Partial<Env> = {}) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`), {
    ...env,
    ...overrides,
  } as unknown as Env)

test('Given an unknown page, When requested, Then a strict, uncached 404 page is shown', async () => {
  const response = await get('/no-such-page')
  expect(response.status).toBe(404)
  expect(response.headers.get('Content-Type')).toMatch(/^text\/html/)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('Content-Security-Policy')).toContain(
    "default-src 'none'",
  )
  expect(await response.text()).toContain('ページが見つかりません')
})

test('Given an unknown API path, When requested, Then the 404 is JSON', async () => {
  const response = await get('/api/no-such-thing')
  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({
    error: 'Not found',
    code: 'not_found',
  })
})

test('Given maintenance is on, When a page or the API is requested, Then 503 asks to retry later', async () => {
  const page = await get('/decks', { MAINTENANCE: 'on' })
  expect(page.status).toBe(503)
  expect(page.headers.get('Retry-After')).toBe('300')
  expect(page.headers.get('X-Frame-Options')).toBe('DENY')
  expect(await page.text()).toContain('メンテナンス中です')
  expect(page.headers.get('Cache-Control')).toBe('no-store')
  expect(page.headers.get('Content-Security-Policy')).toContain(
    "default-src 'none'",
  )
  for (const path of ['/', '/auth/github', '/api/decks', '/missing'])
    expect((await get(path, { MAINTENANCE: 'on' })).status).toBe(503)
  const robots = await get('/robots.txt', { MAINTENANCE: 'on' })
  expect(robots.status).toBe(200)
  const api = await get('/api/uploads/x', { MAINTENANCE: 'on' })
  expect(api.status).toBe(503)
  expect(await api.json()).toMatchObject({ code: 'maintenance' })
})

test('Given maintenance is off, When a page is requested, Then it answers as usual', async () => {
  expect((await get('/', { MAINTENANCE: 'off' })).status).toBe(200)
  expect((await get('/')).status).toBe(200)
})

const failing = () => {
  const app = new Hono()
  app.notFound(notFound)
  app.onError(onError)
  app.get('/boom', () => {
    throw new Error('secret request detail')
  })
  app.get('/api/boom', () => {
    throw new Error('secret request detail')
  })
  app.get('/denied', (c) => {
    c.header('WWW-Authenticate', 'Bearer')
    throw new HTTPException(401, { message: 'Sign in' })
  })
  return app
}

test('Given an unexpected error, When it is handled, Then a 500 page hides the cause and the log keeps a bounded message', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const response = await failing().request('/boom')
    expect(response.status).toBe(500)
    const body = await response.text()
    expect(body).toContain('エラーが発生しました')
    expect(body).not.toContain('secret request detail')
    const api = await failing().request('/api/boom')
    expect(await api.json()).toEqual({
      error: 'Internal error; retry later',
      code: 'server_error',
    })
    const entry = JSON.parse(String(log.mock.calls[0]?.[0]))
    expect(entry).toMatchObject({
      event: 'unhandled_error',
      path: '/boom',
      name: 'Error',
    })
    expect(entry.message.length).toBeLessThanOrEqual(200)
  } finally {
    log.mockRestore()
  }
})

test('Given a management route that fails, When requested through the server, Then the 500 page is shown', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    // A signed-in request reaches D1, which is missing here.
    const response = await server.fetch(
      new Request(`${TEST_ORIGIN}/decks`, {
        headers: { Cookie: `__Host-slide_owner=${'T'.repeat(43)}` },
      }),
      { ...env, DB: undefined } as unknown as Env,
    )
    expect(response.status).toBe(500)
    expect(response.headers.get('Content-Security-Policy')).toContain(
      "default-src 'none'",
    )
    expect(await response.text()).toContain('エラーが発生しました')
  } finally {
    log.mockRestore()
  }
})

test('Given a deliberate HTTP error, When it is handled, Then its own response is kept', async () => {
  const response = await failing().request('/denied')
  expect(response.status).toBe(401)
  expect(response.headers.get('WWW-Authenticate')).toBe('Bearer')
  expect(await response.text()).toBe('Sign in')
})

test('Given maintenance is on, When a deployment origin is requested, Then content delivery stops too', async () => {
  const id = '0b6f0b55-8c43-4d0e-9a51-3c6a3f0f6a10'
  const overrides = {
    CONTENT_ORIGIN: 'https://content.example',
    MAINTENANCE: 'on',
  }
  for (const url of [
    `https://d-${id}.content.example/index.html`,
    'https://other.content.example/',
  ]) {
    const response = await server.fetch(new Request(url), {
      ...env,
      ...overrides,
    } as unknown as Env)
    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('300')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  }
})

test('Given maintenance is on, When the cron fires, Then no sweep touches the data', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const waited: Promise<unknown>[] = []
  try {
    await server.scheduled(
      { scheduledTime: Date.now(), cron: '17 * * * *', noRetry() {} },
      {
        ...env,
        DB: undefined,
        UPLOADS: undefined,
        MAINTENANCE: 'on',
      } as unknown as Env,
      {
        waitUntil: (promise: Promise<unknown>) => waited.push(promise),
        passThroughOnException() {},
        props: {},
      } as unknown as ExecutionContext,
    )
    expect(waited).toHaveLength(0)
    expect(JSON.stringify(log.mock.calls)).toContain(
      'scheduled_skipped_maintenance',
    )
  } finally {
    log.mockRestore()
  }
})
