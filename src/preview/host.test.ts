import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { applyMigrations } from '../db/test-migrations'
import { testEnv, TEST_ORIGIN } from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env
beforeAll(() => applyMigrations(platform.env.DB))
afterAll(() => platform.dispose())

const id = '0b6f0b55-8c43-4d0e-9a51-3c6a3f0f6a10'

test('Given a content origin, When management routes are requested on it, Then they are not served', async () => {
  for (const url of [
    `https://d-${id}.content.example/api/decks`,
    `https://d-${id}.content.example/auth/github`,
    `https://d-${id}.content.example/decks`,
    'https://other.content.example/decks',
    'https://content.example/decks',
    `https://d-${id}.content.example./decks`,
  ]) {
    const response = await server.fetch(new Request(url), env)
    expect(response.status).toBe(404)
  }
})

test('Given a deployment origin, When anything is requested, Then the response is private and not indexed', async () => {
  const response = await server.fetch(
    new Request(`https://d-${id}.content.example/index.html`),
    env,
  )
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
  expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
})

test('Given the management origin, When requested, Then the management app still answers', async () => {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/auth/owner`),
    env,
  )
  expect(response.status).toBe(401)
})

test('Given an invalid content origin, When the management app is used, Then it still answers', async () => {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/auth/owner`),
    { ...env, CONTENT_ORIGIN: 'http://content.example' } as unknown as Env,
  )
  expect(response.status).toBe(401)
})
