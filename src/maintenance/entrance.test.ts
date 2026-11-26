import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { ACCESS_TOKEN_HEADER } from '../operator/access'
import {
  accessTeam,
  AUDIENCE,
  OPERATOR_ORIGIN,
  TEAM,
} from '../operator/test-support'
import { TEST_ORIGIN, testEnv } from '../publication/test-support'
import { ENTER_PATH, ENTRANCE_PATH } from './entrance-routes'
import { PASS_COOKIE } from './pass-routes'
import { signPass } from './pass-token'

const team = await accessTeam()
// The keys come from the stand-in team instead of the network.
vi.mock('../operator/access-client', () => ({ accessKeys: () => team.keys }))

const platform = await getPlatformProxy<Env>({ persist: false })
const CONTENT = 'https://content.example'
const HELD = 'on;until=2026-12-01T03:00:00Z;reason=database'
const base = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: CONTENT,
  OPERATOR_ORIGIN,
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUDIENCE,
}
const held = { ...base, MAINTENANCE: HELD } as unknown as Env
const open = { ...base } as unknown as Env
afterAll(() => platform.dispose())

const NOW = new Date('2026-11-30T12:00:00Z')
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
})
beforeEach(() => vi.setSystemTime(NOW))
afterAll(() => vi.useRealTimers())

const send = (url: string, init: RequestInit = {}, env: Env = held) =>
  server.fetch(new Request(url, init), env)

const entrance = async (token?: string, env: Env = held, method = 'GET') =>
  send(
    `${OPERATOR_ORIGIN}${ENTRANCE_PATH}`,
    { method, headers: token ? { [ACCESS_TOKEN_HEADER]: token } : {} },
    env,
  )

const operatorToken = () => team.sign()

/** The value the entrance puts in the address of the management host. */
async function entered(env: Env = held) {
  const response = await entrance(await operatorToken(), env)
  expect(response.status).toBe(303)
  const target = new URL(response.headers.get('Location')!)
  return { response, target, value: target.searchParams.get('t')! }
}

/** The cookie the management host gives for a good value. */
async function passCookie(value: string, env: Env = held) {
  const response = await send(
    `${TEST_ORIGIN}${ENTER_PATH}?t=${encodeURIComponent(value)}`,
    {},
    env,
  )
  const set = response.headers.get('Set-Cookie') ?? ''
  return { response, set, cookie: set.split(';')[0] ?? '' }
}

const MAINTENANCE_503 = async (response: Response) => {
  expect(response.status).toBe(503)
  expect(response.headers.get('X-Slide-Maintenance')).toContain('on')
  expect(response.headers.has('Set-Cookie')).toBe(false)
}

test('F38-AC19: Given an operator who passed Access, When the entrance is opened while the service is held, Then they are sent on to the management host with a value that is good for a minute, and nothing is stored or logged of who they are', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    const { response, target } = await entered()
    expect(target.origin).toBe(TEST_ORIGIN)
    expect(target.pathname).toBe(ENTER_PATH)
    expect([...target.searchParams.keys()]).toEqual(['t'])
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(response.headers.has('Set-Cookie')).toBe(false)
    const logged = JSON.stringify(log.mock.calls)
    expect(logged).toContain('maintenance_entrance')
    expect(logged).not.toContain('op@example.com')
    expect(logged).not.toContain(target.searchParams.get('t')!)
  } finally {
    log.mockRestore()
  }
})

test('F38-AC19: Given the value of the entrance, When the management host takes it, Then the browser is given a pass for the host alone and sent to the top page without the value in the address', async () => {
  const { value } = await entered()
  const { response, set } = await passCookie(value)
  expect(response.status).toBe(303)
  expect(response.headers.get('Location')).toBe('/')
  expect(response.headers.get('Cache-Control')).toContain('no-store')
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
  expect(set).toContain(`${PASS_COOKIE}=`)
  expect(set).toMatch(/HttpOnly/i)
  expect(set).toMatch(/Secure/i)
  expect(set).toMatch(/SameSite=Lax/i)
  expect(set).toMatch(/Path=\//)
  expect(set).toMatch(/Max-Age=3600/)
  // No Domain: the cookie is for the management host alone.
  expect(set).not.toMatch(/Domain=/i)
})

test('F38-AC19: Given the pass, When the management host is asked for pages while the service is held, Then they open, and without it they are 503', async () => {
  const { value } = await entered()
  const { cookie } = await passCookie(value)
  const withPass = await send(`${TEST_ORIGIN}/slides`, {
    headers: { Cookie: cookie },
  })
  expect(withPass.status).not.toBe(503)
  const without = await send(`${TEST_ORIGIN}/slides`)
  await MAINTENANCE_503(without)
  const api = await send(`${TEST_ORIGIN}/api/slides`, {
    headers: { Cookie: cookie },
  })
  expect(api.status).not.toBe(503)
})

test.each([
  ['no token', undefined],
  ['a token that is not one', 'x.y.z'],
  ['a token past its time', 'expired'],
  ['a token that was altered', 'altered'],
  ['a token for another application', 'other-aud'],
  ['a token of another team', 'other-team'],
  ['a token with no person', 'no-person'],
])(
  'F38-AC19: Given %s, When the entrance is opened, Then it is the 503 of maintenance, the same as for any other address',
  async (_, kind) => {
    const real = await operatorToken()
    const token =
      kind === 'expired'
        ? await team.sign({}, { expiresAt: 1 })
        : kind === 'altered'
          ? `${real.slice(0, -4)}AAAA`
          : kind === 'other-aud'
            ? await team.sign({ aud: 'b'.repeat(64) })
            : kind === 'other-team'
              ? await team.sign({ iss: 'https://other.cloudflareaccess.com' })
              : kind === 'no-person'
                ? await team.sign({ email: undefined })
                : kind
    const response = await entrance(token)
    await MAINTENANCE_503(response)
    const ordinary = await send(`${OPERATOR_ORIGIN}/no-such-page`, {
      headers: { [ACCESS_TOKEN_HEADER]: await operatorToken() },
    })
    expect(response.status).toBe(ordinary.status)
    expect(await response.text()).toBe(await ordinary.text())
    expect(response.headers.get('Location')).toBeNull()
  },
)

test('F38-AC19: Given the operator is not set up, or the service has no secret to make a key from, When the entrance is opened, Then it is 503 and nothing is made', async () => {
  for (const env of [
    { ...held, ACCESS_AUD: undefined },
    { ...held, ACCESS_TEAM_DOMAIN: undefined },
    { ...held, BETTER_AUTH_SECRET: undefined },
    { ...held, BETTER_AUTH_SECRET: 'short' },
  ] as unknown as Env[]) {
    const response = await entrance(await operatorToken(), env)
    await MAINTENANCE_503(response)
    expect(response.headers.get('Location')).toBeNull()
  }
})

test('F38-AC19: Given another method, or another path, on the operator host, When it is asked for while the service is held, Then it is 503 and the entrance made nothing', async () => {
  for (const method of ['POST', 'PUT', 'DELETE'])
    await MAINTENANCE_503(await entrance(await operatorToken(), held, method))
  for (const path of [
    `${ENTRANCE_PATH}/`,
    `${ENTRANCE_PATH}/x`,
    '/',
    '/operations',
  ])
    await MAINTENANCE_503(
      await send(`${OPERATOR_ORIGIN}${path}`, {
        headers: { [ACCESS_TOKEN_HEADER]: await operatorToken() },
      }),
    )
})

test('F38-AC19: Given a value of the entrance, When it is changed, expired, used as a pass, or made for another maintenance, Then the management host answers 503 and gives no pass', async () => {
  const { value } = await entered()
  const { cookie } = await passCookie(value)
  const passValue = decodeURIComponent(cookie.split('=').slice(1).join('='))
  const [v, kind, expiry, signature] = value.split('.') as [
    string,
    string,
    string,
    string,
  ]
  const other = await signPass(
    base.BETTER_AUTH_SECRET!,
    'enter',
    'on',
    Math.floor(NOW.getTime() / 1000),
  )
  for (const t of [
    '',
    'x',
    `${value}x`,
    `${v}.${kind}.${Number(expiry) + 60}.${signature}`,
    `${v}.${kind}.${expiry}.${'A'.repeat(43)}`,
    passValue,
    other.value,
  ]) {
    const { response, set } = await passCookie(t)
    await MAINTENANCE_503(response)
    expect(set, t).toBe('')
  }
})

test('F38-AC19: Given a value of the entrance, When a minute has passed, Then it is no good, and a pass is no good after an hour', async () => {
  const { value } = await entered()
  vi.setSystemTime(new Date(NOW.getTime() + 59_000))
  expect((await passCookie(value)).response.status).toBe(303)
  vi.setSystemTime(new Date(NOW.getTime() + 61_000))
  await MAINTENANCE_503((await passCookie(value)).response)

  vi.setSystemTime(NOW)
  const { cookie } = await passCookie((await entered()).value)
  vi.setSystemTime(new Date(NOW.getTime() + 3_599_000))
  expect(
    (await send(`${TEST_ORIGIN}/slides`, { headers: { Cookie: cookie } }))
      .status,
  ).not.toBe(503)
  vi.setSystemTime(new Date(NOW.getTime() + 3_601_000))
  await MAINTENANCE_503(
    await send(`${TEST_ORIGIN}/slides`, { headers: { Cookie: cookie } }),
  )
})

test('F38-AC19: Given a pass, When the maintenance ends or is started again with another value, Then the pass is no good', async () => {
  const { cookie } = await passCookie((await entered()).value)
  const again = { ...base, MAINTENANCE: 'on' } as unknown as Env
  await MAINTENANCE_503(
    await send(`${TEST_ORIGIN}/slides`, { headers: { Cookie: cookie } }, again),
  )
  // Not held: the page answers as for anyone, and the pass is not read.
  const ended = await send(
    `${TEST_ORIGIN}/slides`,
    { headers: { Cookie: cookie } },
    open,
  )
  expect(ended.status).not.toBe(503)
})

test('F38-AC20: Given the service is not held, When the entrance and the management host side are opened, Then nothing is done: no value, no cookie, and both are addresses that are not there', async () => {
  const token = await operatorToken()
  for (const env of [
    open,
    { ...base, MAINTENANCE: 'off' },
    { ...base, MAINTENANCE: '' },
  ] as unknown as Env[]) {
    const response = await entrance(token, env)
    expect(response.status).toBe(404)
    expect(response.headers.get('Location')).toBeNull()
    expect(response.headers.has('Set-Cookie')).toBe(false)
    const { value } = await (async () => {
      // A value made while the service was held.
      const made = await entered()
      return made
    })()
    const taken = await passCookie(value, env)
    expect(taken.response.status).toBe(404)
    expect(taken.set).toBe('')
  }
})

test('F38-AC21: Given a pass and a value of the entrance, When the content origin is asked for while the service is held, Then it is still 503', async () => {
  const { value } = await entered()
  const { cookie } = await passCookie(value)
  const id = '0b6f0b55-8c43-4d0e-9a51-3c6a3f0f6a10'
  for (const url of [
    `https://d-${id}.content.example/index.html`,
    'https://other.content.example/',
    `https://d-${id}.content.example${ENTER_PATH}?t=${encodeURIComponent(value)}`,
  ]) {
    const response = await send(url, { headers: { Cookie: cookie } })
    await MAINTENANCE_503(response)
  }
})

test('F38-AC21: Given a pass, When the operator host is asked for its pages while the service is held, Then it is still 503: the pass is for the management host', async () => {
  const { value } = await entered()
  const { cookie } = await passCookie(value)
  const response = await send(`${OPERATOR_ORIGIN}/operations`, {
    headers: {
      Cookie: cookie,
      [ACCESS_TOKEN_HEADER]: await operatorToken(),
    },
  })
  await MAINTENANCE_503(response)
})

test('F38-AC22: Given a pass, When the cron fires while the service is held, Then no task starts', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const waited: Promise<unknown>[] = []
  try {
    await server.scheduled(
      { scheduledTime: Date.now(), cron: '17 * * * *', noRetry() {} },
      held,
      {
        waitUntil: (p: Promise<unknown>) => waited.push(p),
        passThroughOnException() {},
        props: {},
      } as unknown as ExecutionContext,
    )
    expect(waited).toHaveLength(0)
  } finally {
    log.mockRestore()
  }
})

test('F38-AC19: Given the entrance is opened by a person who is not an operator but guesses the address of the management host, When they ask without a value, Then they get the 503', async () => {
  for (const path of [
    ENTER_PATH,
    `${ENTER_PATH}?t=`,
    `${ENTER_PATH}?t=v1.pass.1.x`,
  ])
    await MAINTENANCE_503(await send(`${TEST_ORIGIN}${path}`))
})
