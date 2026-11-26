import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import { TEST_ORIGIN, testEnv } from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env
const ID = '2f1b2e84-8f7e-4f3a-9a53-0d0c3a2a1b11'

beforeAll(() => applyMigrations(platform.env.DB))
afterAll(() => platform.dispose())

const get = (path: string) =>
  server.fetch(new Request(`https://d-${ID}.content.example${path}`), env)

test('F37-AC18: Given a version origin, When its worker is asked for, Then the built worker comes with a scope of the whole origin and a CSP that lets it ask only the origin', async () => {
  const response = await get('/_preview/sw.js')
  expect(response.status).toBe(200)
  expect(response.headers.get('Content-Type')).toMatch(/^text\/javascript/)
  expect(response.headers.get('Service-Worker-Allowed')).toBe('/')
  expect(response.headers.get('Cache-Control')).toBe('no-cache')
  expect(response.headers.get('Content-Security-Policy')).toBe(
    "default-src 'none'; connect-src 'self'",
  )
  expect(await response.text()).toContain('/_preview/sw.js')
})

test('Given a version origin, When the frame script is asked for, Then it is the built module', async () => {
  const response = await get('/_preview/offline.js')
  expect(response.status).toBe(200)
  expect(response.headers.get('Content-Type')).toMatch(/^text\/javascript/)
  expect(await response.text()).toContain('startFrame')
})

test('Given a version origin, When the eviction page is asked for, Then only the viewer may frame it and its one script is named by a nonce', async () => {
  const response = await get('/_preview/evict')
  const nonce = /'nonce-([^']+)'/.exec(
    response.headers.get('Content-Security-Policy') ?? '',
  )?.[1]
  expect(nonce).toBeTruthy()
  expect(response.headers.get('Content-Security-Policy')).toBe(
    `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors ${TEST_ORIGIN}`,
  )
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  const page = await response.text()
  expect(page).toContain(`nonce="${nonce}"`)
  expect(page).toContain('getRegistrations')
  expect(page).toContain('slide:offline-evicted')
  expect(page).toContain(`'${TEST_ORIGIN}'`)
})

test.each(['/_preview/sw.js', '/_preview/offline.js', '/_preview/evict'])(
  'Given a version origin, When %s is asked with a method that is not GET, Then nothing answers',
  async (path) => {
    const response = await server.fetch(
      new Request(`https://d-${ID}.content.example${path}`, { method: 'POST' }),
      env,
    )
    expect(response.status).toBe(404)
  },
)

test('Given the management origin, When the worker path of a version is asked for there, Then the service answers as for any other path', async () => {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/_preview/sw.js`),
    env,
  )
  expect(response.headers.get('Service-Worker-Allowed')).toBeNull()
})
