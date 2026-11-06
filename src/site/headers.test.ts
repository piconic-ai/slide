import { afterAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { testEnv, TEST_ORIGIN } from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as Env
afterAll(() => platform.dispose())

const get = (path: string) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`), env)

test.each(['/', '/auth/owner', '/decks', '/api/decks', '/missing'])(
  'Given the management origin, When %s is requested, Then baseline security headers are set',
  async (path) => {
    const response = await get(path)
    expect(response.headers.get('Strict-Transport-Security')).toMatch(
      /^max-age=\d+; includeSubDomains$/,
    )
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('X-Frame-Options')).toBe('DENY')
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
  },
)

test.each(['/auth/owner', '/decks', '/api/decks', '/uploads/x', '/missing'])(
  'Given a private path, When %s is requested, Then it is marked noindex',
  async (path) => {
    const response = await get(path)
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
  },
)

test('Given the top page, When requested, Then it is not marked noindex', async () => {
  const response = await get('/')
  expect(response.status).toBe(200)
  expect(response.headers.get('X-Robots-Tag')).toBeNull()
})

test('Given robots.txt, When requested, Then private paths are disallowed', async () => {
  const response = await get('/robots.txt')
  expect(response.status).toBe(200)
  expect(response.headers.get('Content-Type')).toMatch(/^text\/plain/)
  expect(await response.text()).toContain('Disallow: /decks')
})

test('Given a page with its own policy, When requested, Then that policy is kept', async () => {
  const response = await get('/uploads/x')
  expect(response.headers.get('Cache-Control')).toBe('no-store')
})

test('Given a deployment origin, When robots.txt is requested, Then the management route is not served', async () => {
  const response = await server.fetch(
    new Request(
      'https://d-0b6f0b55-8c43-4d0e-9a51-3c6a3f0f6a10.content.example/robots.txt',
    ),
    env,
  )
  expect(await response.text()).not.toContain('Disallow: /decks')
})
