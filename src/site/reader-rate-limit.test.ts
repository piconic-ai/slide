import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy, unstable_readConfig } from 'wrangler'
import server from '../app/routes'
import { DECKS_SHOWN } from '../citations/citing'
import { VERSION_LIMITS } from '../uploads/version-limits'
import { applyMigrations } from '../db/test-migrations'
import { TEST_ORIGIN, testEnv } from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
beforeAll(() => applyMigrations(platform.env.DB))
afterAll(() => platform.dispose())

/** A limiter that refuses each key after `limit` requests. */
function countingLimiter(limit: number) {
  const counts = new Map<string, number>()
  return {
    counts,
    async limit({ key }: { key: string }) {
      const count = (counts.get(key) ?? 0) + 1
      counts.set(key, count)
      return { success: count <= limit }
    },
  }
}

const deployment =
  'https://d-9a093341-8da7-45ac-89be-db566fecb5a4.content.example'
const content = countingLimiter(2)
const viewer = countingLimiter(2)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
  CONTENT_RATE_LIMITER: content,
  VIEWER_RATE_LIMITER: viewer,
} as unknown as Env

const get = (url: string, ip?: string) =>
  server.fetch(
    new Request(url, { headers: ip ? { 'CF-Connecting-IP': ip } : {} }),
    env,
  )

/** Readers behind one venue address who must all get in within a minute. */
const READERS = 10_000
/**
 * The viewer's own requests counted per reader: the share URL, the header's
 * `/api/session`, the deck's cover, and the covers of the slides it cites and
 * is cited by.
 */
const VIEWER_OWN = 3 + 2 * DECKS_SHOWN
/** An article written page by page; Chromium loads every image at once. */
const ARTICLE_PAGES = 100

test('F03-AC154: Given the Worker configuration, When the reader budgets are read, Then ten thousand readers behind one address each fit in a minute, and the other budgets are as they were', () => {
  const { ratelimits } = unstable_readConfig({ config: 'wrangler.jsonc' })
  const limitOf = (name: string) =>
    ratelimits?.find((binding: { name: string }) => binding.name === name)
      ?.simple
  const viewer = limitOf('VIEWER_RATE_LIMITER')
  const content = limitOf('CONTENT_RATE_LIMITER')
  expect(viewer?.period).toBe(60)
  expect(content?.period).toBe(60)
  expect(viewer?.limit).toBeGreaterThanOrEqual(
    READERS * (VIEWER_OWN + ARTICLE_PAGES),
  )
  // Each reader loads every file of the version from its origin.
  expect(content?.limit).toBeGreaterThanOrEqual(READERS * VERSION_LIMITS.files)
  expect(limitOf('AUTH_RATE_LIMITER')).toEqual({ limit: 30, period: 60 })
  expect(limitOf('UPLOAD_RATE_LIMITER')).toEqual({ limit: 600, period: 60 })
  expect(limitOf('MANAGEMENT_RATE_LIMITER')).toEqual({
    limit: 120,
    period: 60,
  })
})

test('Given one IP over the content budget, When it requests a deployment origin, Then it is refused before authorization', async () => {
  for (const path of ['/', '/a.js'])
    await get(`${deployment}${path}`, '192.0.2.10')
  const response = await get(`${deployment}/b.png`, '192.0.2.10')
  expect(response.status).toBe(429)
  expect(response.headers.get('Retry-After')).toBe('60')
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  // Another reader is unaffected, and a missing deployment is a plain 404.
  expect((await get(`${deployment}/`, '192.0.2.11')).status).toBe(404)
})

test('Given one IP over the viewer budget, When it opens a share URL, Then it is refused', async () => {
  for (let i = 0; i < 2; i++)
    await get(`${TEST_ORIGIN}/@owner/talk`, '192.0.2.12')
  const response = await get(`${TEST_ORIGIN}/@owner/talk`, '192.0.2.12')
  expect(response.status).toBe(429)
  expect(content.counts.has('192.0.2.12')).toBe(false)
})

test('Given no client IP, When a deployment origin is requested repeatedly, Then it is not counted', async () => {
  for (let i = 0; i < 4; i++)
    expect((await get(`${deployment}/`)).status).toBe(404)
})
