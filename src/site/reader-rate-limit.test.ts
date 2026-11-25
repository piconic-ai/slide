import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy, unstable_readConfig } from 'wrangler'
import server from '../app/routes'
import { DECKS_SHOWN } from '../citations/citing'
import { MAX_SHOT_PAGE } from '../covers/shot'
import { MAX_FILES_SETTING } from '../uploads/limits'
import { SECTION_TALKS } from '../share/viewer-talks'
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
 * The viewer's own requests counted per reader: the share URL and the
 * header's `/api/session`, the covers of the slides it cites and is cited by,
 * and those of the two sections of other talks. The viewer shows the deck
 * itself, not its cover.
 */
const VIEWER_CARDS = 2 * DECKS_SHOWN + 2 * SECTION_TALKS
const VIEWER_OWN = 2 + VIEWER_CARDS
/** Other slides an article shows pages of (F26-AC102), one page each. */
const OTHER_DECKS = 40
/**
 * The images of an article, which Chromium loads at once: every page the
 * service takes of its own slides, the cover that pages past those show, and
 * a page of each other slides.
 */
const ARTICLE_IMAGES = MAX_SHOT_PAGE + 1 + OTHER_DECKS
/** Covers a deck names are files of its version: the viewer's cards and 41 in an article. */
const COVER_FILES = VIEWER_CARDS + 1 + OTHER_DECKS

const budgets = () => {
  const { ratelimits } = unstable_readConfig({ config: 'wrangler.jsonc' })
  return (name: string) =>
    ratelimits?.find((binding: { name: string }) => binding.name === name)
      ?.simple
}

test('F03-AC154: Given the Worker configuration, When the reader budgets are read, Then ten thousand readers behind one address each fit in a minute', () => {
  const limitOf = budgets()
  const viewer = limitOf('VIEWER_RATE_LIMITER')
  const content = limitOf('CONTENT_RATE_LIMITER')
  expect(viewer?.period).toBe(60)
  expect(content?.period).toBe(60)
  expect(viewer?.limit).toBeGreaterThanOrEqual(
    READERS * (VIEWER_OWN + ARTICLE_IMAGES),
  )
  // Each reader loads every file of the version, as many as it may hold.
  expect(content?.limit).toBeGreaterThanOrEqual(
    READERS * (MAX_FILES_SETTING + COVER_FILES),
  )
})

test('F03-AC155: Given the Worker configuration, When the other budgets are read, Then sign-in, uploads, owner pages and new page images keep their budgets', () => {
  const limitOf = budgets()
  expect(limitOf('AUTH_RATE_LIMITER')).toEqual({ limit: 30, period: 60 })
  expect(limitOf('UPLOAD_RATE_LIMITER')).toEqual({ limit: 600, period: 60 })
  expect(limitOf('MANAGEMENT_RATE_LIMITER')).toEqual({
    limit: 120,
    period: 60,
  })
  expect(limitOf('PAGE_SHOT_RATE_LIMITER')).toEqual({ limit: 6, period: 60 })
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
