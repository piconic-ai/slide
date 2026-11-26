import { afterAll, afterEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from './routes'
import { TEST_ORIGIN, testEnv } from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
afterAll(() => platform.dispose())
afterEach(() => vi.restoreAllMocks())

const refusing = { limit: async () => ({ success: false }) }
const deployment =
  'https://d-9a093341-8da7-45ac-89be-db566fecb5a4.content.example'

const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
  AUTH_RATE_LIMITER: refusing,
  CONTENT_RATE_LIMITER: refusing,
} as unknown as Env

function lines() {
  const logged: Record<string, unknown>[] = []
  const keep = (text: unknown) => {
    try {
      logged.push(JSON.parse(String(text)))
    } catch {
      // Not a line of ours.
    }
  }
  vi.spyOn(console, 'log').mockImplementation(keep)
  vi.spyOn(console, 'error').mockImplementation(keep)
  return () =>
    logged.filter(
      (line) => line.event === 'http_5xx' || line.event === 'http_limited',
    )
}

const request = (url: string) =>
  server.fetch(
    new Request(url, { headers: { 'CF-Connecting-IP': '192.0.2.9' } }),
    env,
  )

test('D-62: Given the login limit spent, When a request on the management origin is refused, Then one http_limited line names the origin and the kind of limit', async () => {
  const seen = lines()
  const response = await request(`${TEST_ORIGIN}/auth/owner`)
  expect(response.status).toBe(429)
  expect(seen()).toEqual([
    { event: 'http_limited', origin: 'management', group: 'auth', status: 429 },
  ])
})

test('D-62: Given the content limit spent, When a request on a deployment origin is refused, Then the line says the content origin and the content limit', async () => {
  const seen = lines()
  const response = await request(`${deployment}/index.html`)
  expect(response.status).toBe(429)
  expect(seen()).toEqual([
    { event: 'http_limited', origin: 'content', group: 'content', status: 429 },
  ])
})

test('D-62: Given an answer that is neither a 5xx nor a 429, When it is sent, Then no such line is logged', async () => {
  const seen = lines()
  expect((await request(`${TEST_ORIGIN}/robots.txt`)).status).toBe(200)
  expect(seen()).toEqual([])
})

test('D-62: Given D1 that fails on a page, When a request is answered with a 500, Then one http_5xx line names the origin and the status and holds no path', async () => {
  const seen = lines()
  const broken = { ...env, DB: undefined } as unknown as Env
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/@someone/some-slide`),
    broken,
  )
  expect(response.status).toBe(500)
  expect(seen()).toEqual([
    { event: 'http_5xx', origin: 'management', status: 500 },
  ])
})
