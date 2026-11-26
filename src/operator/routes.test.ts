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
const answer = async (response: Response) => ({
  status: response.status,
  body: await response.text(),
})

test('F17-AC12: Given a verified Access token, When the operator host is opened, Then the operator page answers and names the operator', async () => {
  const response = await admin('/', await team.sign())
  expect(response.status).toBe(200)
  expect(await response.text()).toContain('op@example.com')
})

test('F17-AC12: Given no token, a forged token, or an expired one, When the operator host is opened, Then the answer is the one a missing page gets', async () => {
  const token = await team.sign()
  const missing = await answer(await admin('/no-such-page', token))
  expect(missing.status).toBe(404)
  const tampered = `${token.slice(0, -4)}AAAA`
  const expired = await team.sign({}, { expiresAt: 1 })
  for (const presented of [undefined, tampered, expired, 'x.y.z'])
    for (const path of ['/', '/no-such-page'])
      expect(await answer(await admin(path, presented))).toEqual(missing)
})

test.each([
  ['no team domain', { ACCESS_TEAM_DOMAIN: undefined }],
  ['no audience', { ACCESS_AUD: undefined }],
  ['a malformed audience', { ACCESS_AUD: 'everyone' }],
])(
  'F17-AC12: Given %s is configured, When a verified token is presented, Then the operator host stays closed',
  async (_, change) => {
    const closed = { ...env, ...change } as unknown as Env
    expect((await admin('/', await team.sign(), closed)).status).toBe(404)
  },
)

test('F17-AC19: Given a verified token, When it is presented on the management origin or a deployment origin, Then no operator page answers there', async () => {
  const token = await team.sign()
  const management = await get(`${TEST_ORIGIN}/`, token)
  expect(await management.text()).not.toContain('op@example.com')
  const deployment = await get(
    'https://d-7ae11c67-633f-4f21-b2b1-80af84107428.content.example/',
    token,
  )
  expect(deployment.status).toBe(404)
  expect(await deployment.text()).not.toContain('op@example.com')
})

test('F17-AC19: Given the operator host, When management paths are asked for with a verified token, Then none of the management app answers', async () => {
  const token = await team.sign()
  for (const path of [
    '/my/slides',
    '/help',
    '/api/public/slides',
    '/auth/github',
  ])
    expect((await admin(path, token)).status).toBe(404)
})

test('F17-AC20: Given the operator host, When robots.txt is asked for without a token, Then it disallows every path', async () => {
  const response = await admin('/robots.txt')
  expect(response.status).toBe(200)
  expect(await response.text()).toBe('User-agent: *\nDisallow: /\n')
})

test('F17-AC21: Given any answer of the operator host, When its headers are read, Then it is not indexed and not stored', async () => {
  const token = await team.sign()
  const responses = [
    await admin('/', token),
    await admin('/'),
    await admin('/no-such-page', token),
    await admin('/robots.txt'),
  ]
  for (const response of responses) {
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    // A form posted from these pages must carry their origin.
    expect(response.headers.get('Referrer-Policy')).toBe('same-origin')
    expect(response.headers.get('X-Frame-Options')).toBe('DENY')
  }
})

test('Given maintenance is on, When the operator host is opened, Then it answers 503 without reading the token', async () => {
  const response = await admin('/', await team.sign(), {
    ...env,
    MAINTENANCE: 'on',
  } as unknown as Env)
  expect(response.status).toBe(503)
})

test('Given the standard local setup, When the operator host is asked for robots.txt, Then the operator app answers, and a local deployment origin still does not', async () => {
  const local = {
    ...env,
    PUBLIC_ORIGIN: 'http://localhost:8794',
    CONTENT_ORIGIN: 'http://localhost:8794',
    OPERATOR_ORIGIN: 'http://admin.localhost:8794',
  } as unknown as Env
  const robots = await get(
    'http://admin.localhost:8794/robots.txt',
    undefined,
    local,
  )
  expect(robots.status).toBe(200)
  expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n')
  expect(
    (await get('http://admin.localhost:8794/', await team.sign(), local))
      .status,
  ).toBe(200)
  const deployment = await get(
    'http://d-7ae11c67-633f-4f21-b2b1-80af84107428.localhost:8794/',
    await team.sign(),
    local,
  )
  expect(await deployment.text()).not.toContain('op@example.com')
})
