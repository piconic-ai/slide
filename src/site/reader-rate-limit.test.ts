import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy, unstable_readConfig } from 'wrangler'
import server from '../../server'
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

test('Given the Worker configuration, When reader budgets are read, Then deployment origins get the largest budget', () => {
  const { ratelimits } = unstable_readConfig({ config: 'wrangler.jsonc' })
  const limitOf = (name: string) =>
    ratelimits?.find((binding: { name: string }) => binding.name === name)
      ?.simple
  expect(limitOf('CONTENT_RATE_LIMITER')).toEqual({ limit: 3000, period: 60 })
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
