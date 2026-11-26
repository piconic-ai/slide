import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import { TEST_ORIGIN, testEnv } from '../publication/test-support'
import { ACCESS_TOKEN_HEADER } from './access'
import { accessTeam, AUDIENCE, OPERATOR_ORIGIN, TEAM } from './test-support'

const team = await accessTeam()
// The keys come from the stand-in team instead of the network.
vi.mock('./access-client', () => ({ accessKeys: () => team.keys }))

const platform = await getPlatformProxy<Env>({ persist: false })
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
  OPERATOR_ORIGIN,
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUDIENCE,
} as unknown as Env
beforeAll(() => applyMigrations(platform.env.DB))
afterAll(() => platform.dispose())

const get = (url: string, token?: string, with_: Env = env) =>
  server.fetch(
    new Request(url, {
      headers: token ? { [ACCESS_TOKEN_HEADER]: token } : {},
    }),
    with_,
  )
const admin = (path: string, token?: string, with_?: Env) =>
  get(`${OPERATOR_ORIGIN}${path}`, token, with_)

const PAGES = ['/metrics', '/operations']

test.each(PAGES)(
  'Given a verified operator, When %s is opened, Then the page answers with the operator headers and a one-heading body',
  async (path) => {
    const response = await admin(path, await team.sign())
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Security-Policy')).toContain(
      "default-src 'none'",
    )
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const body = await response.text()
    expect(body).toContain('op@example.com')
    expect(body.match(/<h1>/g)).toHaveLength(1)
    expect(body).toContain('href="/operations"')
    expect(body).toContain('href="/metrics"')
  },
)

test.each(PAGES)(
  'Given no token, a forged one or an expired one, When %s is opened, Then the answer is the one a missing page gets',
  async (path) => {
    const token = await team.sign()
    const missing = await admin('/no-such-page', token)
    const expected = { status: missing.status, body: await missing.text() }
    const expired = await team.sign({}, { expiresAt: 1 })
    for (const presented of [undefined, `${token.slice(0, -4)}AAAA`, expired]) {
      const response = await admin(path, presented)
      expect({ status: response.status, body: await response.text() }).toEqual(
        expected,
      )
    }
  },
)

test.each(PAGES)(
  'Given the management origin or a deployment origin, When %s is asked for with a verified token, Then no operator page answers',
  async (path) => {
    const token = await team.sign()
    const management = await get(`${TEST_ORIGIN}${path}`, token)
    expect(await management.text()).not.toContain('op@example.com')
    const deployment = await get(
      `https://d-7ae11c67-633f-4f21-b2b1-80af84107428.content.example${path}`,
      token,
    )
    expect(deployment.status).toBe(404)
  },
)

test.each(PAGES)(
  'Given the operator is not configured, When %s is opened on the operator host, Then it stays closed',
  async (path) => {
    const closed = { ...env, ACCESS_AUD: undefined } as unknown as Env
    expect((await admin(path, await team.sign(), closed)).status).toBe(404)
  },
)

test.each(PAGES)(
  'Given maintenance is on, When %s is opened, Then it answers 503',
  async (path) => {
    const response = await admin(path, await team.sign(), {
      ...env,
      MAINTENANCE: 'on',
    } as unknown as Env)
    expect(response.status).toBe(503)
  },
)

test.each(PAGES)(
  'Given %s, When a change is posted to it, Then it is not a route that changes anything',
  async (path) => {
    const response = await server.fetch(
      new Request(`${OPERATOR_ORIGIN}${path}`, {
        method: 'POST',
        headers: {
          [ACCESS_TOKEN_HEADER]: await team.sign(),
          Origin: OPERATOR_ORIGIN,
        },
      }),
      env,
    )
    expect(response.status).toBe(404)
  },
)

test('Given the operator home, When opened, Then it links to the two new pages and marks itself current', async () => {
  const body = await (await admin('/', await team.sign())).text()
  expect(body).toContain('href="/metrics"')
  expect(body).toContain('href="/operations"')
  expect(body).toMatch(/href="\/"\s+aria-current="page"/)
})
