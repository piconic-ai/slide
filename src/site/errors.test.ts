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
  } as Env)

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
  app.get('/denied', () => {
    throw new HTTPException(401, { message: 'Sign in' })
  })
  return app
}

test('Given an unexpected error, When it is handled, Then a 500 page is shown and the message is not logged', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const response = await failing().request('/boom')
  expect(response.status).toBe(500)
  expect(await response.text()).toContain('エラーが発生しました')
  expect(JSON.stringify(log.mock.calls)).not.toContain('secret request detail')
  const api = await failing().request('/api/boom')
  expect(await api.json()).toEqual({
    error: 'Internal error; retry later',
    code: 'server_error',
  })
  log.mockRestore()
})

test('Given a deliberate HTTP error, When it is handled, Then its own response is kept', async () => {
  const response = await failing().request('/denied')
  expect(response.status).toBe(401)
  expect(await response.text()).toBe('Sign in')
})
