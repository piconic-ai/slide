import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { reports } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const base = testEnv(platform.env)
/** The management budget is spent for every client. */
const env = {
  ...base,
  MANAGEMENT_RATE_LIMITER: { limit: async () => ({ success: false }) },
} as unknown as Env
const slide = '/@owner/talk'
let reader = ''

beforeAll(async () => {
  await applyMigrations(database)
  await resetTables(database)
  reader = await signIn(base)
  await seedPublic(database, 'talk', 1, 'Talk')
})
afterAll(() => platform.dispose())

const headers = {
  Origin: TEST_ORIGIN,
  'CF-Connecting-IP': '192.0.2.50',
}

test('Given a client over the management budget, When it opens the report form, Then it is refused before the page is built', async () => {
  const response = await server.fetch(
    new Request(
      `${TEST_ORIGIN}/reports/new?slide=${encodeURIComponent(slide)}`,
      {
        headers: {
          'CF-Connecting-IP': headers['CF-Connecting-IP'],
          Cookie: reader,
        },
      },
    ),
    env,
  )

  expect(response.status).toBe(429)
  expect(response.headers.get('Retry-After')).toBe('60')
})

test('Given a client over the management budget, When it posts a report, Then it is refused and nothing is saved', async () => {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/reports`, {
      method: 'POST',
      headers: { ...headers, Cookie: reader },
      body: new URLSearchParams({ slide, reason: 'nuisance', note: '' }),
    }),
    env,
  )

  expect(response.status).toBe(429)
  expect(await drizzle(database).select().from(reports)).toEqual([])
})

test('Given a client within the budget, When it posts the same report, Then it is saved', async () => {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/reports`, {
      method: 'POST',
      headers: { ...headers, Cookie: reader },
      body: new URLSearchParams({ slide, reason: 'nuisance', note: '' }),
    }),
    base,
  )

  expect(response.status).toBe(303)
  expect(await drizzle(database).select().from(reports)).toHaveLength(1)
})
