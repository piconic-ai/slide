import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import { TEST_ORIGIN, testEnv } from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)
beforeAll(() => applyMigrations(platform.env.DB))
afterAll(() => platform.dispose())

const open = (path: string, headers: Record<string, string> = {}) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`, { headers }), env)
const NOINDEX = 'noindex, nofollow'

test("F45-AC34: Given the footer's switch of a /link/ page, When followed, Then the choice is kept in the cookie and the reader is sent back to the page", async () => {
  const response = await open(
    `/link?to=${encodeURIComponent('/link/example.com/a?b=1&lang=ja')}&lang=en`,
  )
  expect(response.status).toBe(302)
  expect(response.headers.get('Location')).toBe(
    '/link/example.com/a?b=1&lang=ja',
  )
  expect(response.headers.get('Set-Cookie')).toMatch(/^language=en;/)
})

test.each([
  '',
  '?lang=en',
  '?to=',
  '?to=/',
  '?to=/link',
  '?to=/link/',
  '?to=/linker/example.com',
  '?to=//evil.example/link/a',
  '?to=https://evil.example/link/a',
  '?to=/link/../my/slides',
  '?to=/link/javascript:alert(1)',
  '?to=/link/user@evil.example',
  '?to=%5C%5Cevil.example',
])(
  'F45-AC34: Given /link%s, which names no page of links to go back to, When opened, Then it is not found and leads nowhere',
  async (query) => {
    const response = await open(`/link${query}`)
    expect(response.status).toBe(404)
    expect(response.headers.get('Location')).toBeNull()
    expect(response.headers.get('X-Robots-Tag')).toBe(NOINDEX)
  },
)

test.each([
  ['/link///evil.example/a', '/link/evil.example/a'],
  ['/link/%5C%5Cevil.example%5Ca', '/link/evil.example/a'],
  ['/link/https://evil.example', '/link/evil.example/'],
  ['/link/%2F%2Fevil.example', '/link/evil.example/'],
])(
  'F45-AC34: Given /link?to=%s, written to pass for a way out, When opened, Then the reader stays on this site, at the page of links of that address',
  async (to, location) => {
    const response = await open(`/link?to=${to}`)
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe(location)
  },
)

test('F30-AC74: Given /@link, When opened, Then no profile answers there', async () => {
  expect((await open('/@link')).status).toBe(404)
})
