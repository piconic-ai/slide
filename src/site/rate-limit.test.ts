import { afterAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { testEnv, TEST_ORIGIN } from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)
afterAll(() => platform.dispose())

const AUTH_LIMIT = 30

const get = (path: string, ip?: string) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      headers: ip ? { 'CF-Connecting-IP': ip } : {},
    }),
    env,
  )

async function exhaust(path: string, ip: string, count: number) {
  for (let i = 0; i < count; i++) await get(path, ip)
}

test('Given one IP over the login budget, When it requests again, Then it is refused with a retry hint', async () => {
  await exhaust('/auth/owner', '192.0.2.1', AUTH_LIMIT)
  const response = await get('/auth/owner', '192.0.2.1')
  expect(response.status).toBe(429)
  expect(response.headers.get('Retry-After')).toBe('60')
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('X-Frame-Options')).toBe('DENY')
})

test('Given one IP over the login budget, When another IP logs in, Then it is not affected', async () => {
  await exhaust('/auth/owner', '192.0.2.2', AUTH_LIMIT + 1)
  const response = await get('/auth/owner', '192.0.2.3')
  expect(response.status).toBe(401)
})

test('Given one IP over the login budget, When it uses another group, Then that group has its own budget', async () => {
  await exhaust('/auth/owner', '192.0.2.4', AUTH_LIMIT + 1)
  const response = await get('/api/decks', '192.0.2.4')
  expect(response.status).toBe(401)
})

test('Given one IP over the API budget, When it calls the API, Then the refusal is JSON', async () => {
  await exhaust('/api/decks', '192.0.2.5', 120)
  const response = await get('/api/decks', '192.0.2.5')
  expect(response.status).toBe(429)
  expect(await response.json()).toEqual({
    error: 'Too many requests; retry later',
    code: 'rate_limited',
  })
})

test('Given an unlimited path, When requested many times, Then it is never refused', async () => {
  await exhaust('/', '192.0.2.6', AUTH_LIMIT + 1)
  expect((await get('/', '192.0.2.6')).status).toBe(200)
})

test('Given no client IP, When requested over the budget, Then it is not counted', async () => {
  await exhaust('/auth/owner', '', AUTH_LIMIT + 1)
  expect((await get('/auth/owner')).status).toBe(401)
})
