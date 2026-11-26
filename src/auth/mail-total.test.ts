import { drizzle } from 'drizzle-orm/d1'
import { sql } from 'drizzle-orm'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { alerts, accounts, loginCodeRequests } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { readOutbox } from '../mail/outbox-store'
import { listRecent } from '../alerts/alert-store'
import {
  emailOf,
  invite,
  lastCode,
  resetTables,
  seedPerson,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { accounts as accountsTable } from '../db/schema'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const orm = drizzle(database)
const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGH-_0123456789'
const WEBHOOK = `https://discord.com/api/webhooks/123456789012345678/${TOKEN}`

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetTables(database)
  await orm.delete(alerts)
})
afterEach(() => vi.unstubAllGlobals())
afterAll(() => platform.dispose())

/** The environment with the total cap set (it is off by default, F42-AC29); the other two limits stay out of the way. */
const capped = (total: number, extra: Record<string, unknown> = {}) =>
  ({
    ...testEnv(platform.env),
    LOGIN_CODE_LIMITS: {
      perAddress: 1000,
      perSource: 1000,
      attemptsPerAddress: 1000,
      total,
    },
    DISCORD_WEBHOOK_URL: WEBHOOK,
    OPERATOR_ORIGIN: 'https://admin.slide.example',
    ...extra,
  }) as unknown as Env

/** Discord answers 204 and keeps what was posted; nothing else leaves. */
function discord() {
  const posted: { content: string }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith('https://discord.com/')) {
        posted.push(JSON.parse(String(init?.body)))
        return new Response(null, { status: 204 })
      }
      throw new Error(`an unexpected request to ${String(input)}`)
    }),
  )
  return posted
}

const ask = (email: string, env: Env, ip?: string) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}/login`, {
      method: 'POST',
      headers: {
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(ip ? { 'CF-Connecting-IP': ip } : {}),
      },
      body: new URLSearchParams({ email }),
    }),
    env,
  )
const enter = (email: string, code: string, env: Env) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}/login/code`, {
      method: 'POST',
      headers: {
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ email, code }),
    }),
    env,
  )
const told = async (kind: string) =>
  (await listRecent(database, 50)).filter((alert) => alert.kind === kind)

/** Without a total in the setting: only the other limits, set out of the way. */
const uncapped = (limits: unknown = {}, extra: Record<string, unknown> = {}) =>
  ({
    ...testEnv(platform.env),
    LOGIN_CODE_LIMITS: {
      perAddress: 1000,
      perSource: 1000,
      attemptsPerAddress: 1000,
      ...(limits as object),
    },
    DISCORD_WEBHOOK_URL: WEBHOOK,
    OPERATOR_ORIGIN: 'https://admin.slide.example',
    ...extra,
  }) as unknown as Env

/** Rows of codes asked for by `n` other people from other clients, just now. */
const seedRequests = async (n: number) => {
  const rows = Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    kind: 'send' as const,
    address_hash: `a${i}`,
    source_hash: `s${i}`,
    requested_at: Math.floor(Date.now() / 1000) - 5,
  }))
  for (let i = 0; i < rows.length; i += 10)
    await orm.insert(loginCodeRequests).values(rows.slice(i, i + 10))
}

const addresses = (n: number) =>
  Array.from({ length: n }, (_, i) => emailOf(`person${i}`))

test('F42-AC29: Given no total in the setting, When 150 codes have been asked for within the hour, Then another is sent, nothing says the service is busy, and the operator is not told', async () => {
  const posted = discord()
  const env = uncapped()
  await seedRequests(150)
  await invite(database, emailOf('late'))
  const response = await ask(emailOf('late'), env)
  expect(response.status).toBe(200)
  expect(await response.text()).toContain('name="code"')
  expect(await readOutbox(database, emailOf('late'))).toHaveLength(1)
  expect(posted).toEqual([])
  expect(await told('mail_flood')).toEqual([])
})

test('F42-AC29: Given no total in the setting, When codes are asked for, Then each leaves one row for its own address and client and nothing is added for a total', async () => {
  const env = uncapped()
  const people = addresses(12)
  for (const [i, person] of people.entries())
    expect((await ask(person, env, `203.0.113.${i + 1}`)).status).toBe(200)
  expect(await orm.$count(loginCodeRequests)).toBe(12)
})

test('F42-AC29: Given a total of 0, When 150 codes have been asked for within the hour, Then it is off like a missing total, and the other limits stay as set', async () => {
  const posted = discord()
  const env = uncapped({ total: 0, perAddress: 1 })
  await seedRequests(150)
  const [a] = addresses(1) as [string]
  await invite(database, a)
  expect((await ask(a, env)).status).toBe(200)
  const again = await ask(a, env)
  expect(again.status).toBe(429)
  expect(await again.text()).toContain('以降に、もう一度お試しください')
  expect(posted).toEqual([])
})

test('F42-AC29: Given no total in the setting, When an address and a client reach their own limits, Then they are still refused', async () => {
  const env = uncapped({ perAddress: 1, perSource: 2 })
  const [a, b, c] = addresses(3) as [string, string, string]
  await (await ask(a, env, '203.0.113.5')).text()
  expect((await ask(a, env, '203.0.113.6')).status).toBe(429)
  await (await ask(b, env, '203.0.113.5')).text()
  expect((await ask(c, env, '203.0.113.5')).status).toBe(429)
})

test.each([{ total: -1 }, { total: 2.5 }, { total: '100' }, { total: null }])(
  'F42-AC29: Given the mistaken total %j, When 150 codes have been asked for within the hour, Then there is no total cap, and the operator is not told',
  async (mistaken) => {
    const posted = discord()
    const env = uncapped(mistaken)
    await seedRequests(150)
    await invite(database, emailOf('late'))
    expect((await ask(emailOf('late'), env)).status).toBe(200)
    expect(posted).toEqual([])
    expect(await told('mail_flood')).toEqual([])
  },
)

test('F42-AC25: Given a total cap of 3, When four different addresses from four clients ask for a code, Then the fourth is refused with "try again in a while" and nothing is mailed to it', async () => {
  const env = capped(3)
  const [a, b, c, d] = addresses(4) as [string, string, string, string]
  for (const person of [a, b, c, d]) await invite(database, person)
  for (const [i, person] of [a, b, c].entries())
    expect((await ask(person, env, `203.0.113.${i + 1}`)).status).toBe(200)
  const refused = await ask(d, env, '203.0.113.9')
  expect(refused.status).toBe(429)
  expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0)
  const page = await refused.text()
  expect(page).toContain('しばらくしてからやり直してください')
  expect(page).not.toContain('name="code"')
  expect(await readOutbox(database, d)).toEqual([])
  expect(await readOutbox(database, a)).toHaveLength(1)
})

test('F42-AC25: Given the English page, When the total cap is reached, Then it says to try again in a while', async () => {
  const env = capped(1)
  await invite(database, emailOf('one'))
  await (await ask(emailOf('one'), env)).text()
  const refused = await server.fetch(
    new Request(`${TEST_ORIGIN}/login?lang=en`, {
      method: 'POST',
      headers: {
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ email: emailOf('two') }),
    }),
    env,
  )
  expect(refused.status).toBe(429)
  expect(await refused.text()).toContain('Please try again in a while')
})

test('F42-AC25: Given the total cap was reached, When an hour has passed, Then codes are sent again', async () => {
  const env = capped(2)
  const [a, b, c] = addresses(3) as [string, string, string]
  for (const person of [a, b, c]) await invite(database, person)
  await (await ask(a, env)).text()
  await (await ask(b, env)).text()
  expect((await ask(c, env)).status).toBe(429)
  // The two requests are now an hour and a second old.
  await orm.run(
    sql`UPDATE login_code_requests SET requested_at = requested_at - 3601`,
  )
  expect((await ask(c, env)).status).toBe(200)
  expect(await readOutbox(database, c)).toHaveLength(1)
})

test('F42-AC26: Given the total cap is reached, When a registered person, an invited person with no account, an uninvited address and a malformed-case address ask, Then the status, the headers and the page are the same, whoever they are', async () => {
  const env = capped(2)
  await seedPerson(database, 'u1', 'member')
  await orm
    .insert(accountsTable)
    .values({ user_id: 'u1', handle: 'member', created_at: 1 })
  await invite(database, emailOf('guest'))
  await (await ask(emailOf('x1'), env)).text()
  await (await ask(emailOf('x2'), env)).text()
  const answers: { status: number; retry: string | null; body: string }[] = []
  for (const person of [
    emailOf('member'),
    emailOf('guest'),
    emailOf('stranger'),
    emailOf('STRANGER2'),
  ]) {
    const response = await ask(person, env)
    answers.push({
      status: response.status,
      retry: response.headers.get('retry-after'),
      // The page repeats what was typed in the field; that is the only difference.
      body: (await response.text())
        .replaceAll(person, 'ADDRESS')
        .replaceAll(person.toLowerCase(), 'ADDRESS'),
    })
  }
  expect(answers[0]!.status).toBe(429)
  // Retry-After counts down in real time, so two requests that straddle a
  // second boundary differ by one; everything else must be identical.
  const first = Number(answers[0]!.retry)
  for (const answer of answers.slice(1)) {
    expect(Math.abs(Number(answer.retry) - first)).toBeLessThanOrEqual(1)
    expect({ ...answer, retry: null }).toEqual({ ...answers[0], retry: null })
  }
  expect(await orm.$count(loginCodeRequests)).toBe(2)
})

test('F42-AC28: Given an address at its own limit while the total has room, When it asks again, Then the address limit still refuses it, with its own wording', async () => {
  const env = capped(100, {
    LOGIN_CODE_LIMITS: {
      perAddress: 1,
      perSource: 1000,
      attemptsPerAddress: 1000,
      total: 100,
    },
  })
  const [a] = addresses(1) as [string]
  await invite(database, a)
  await (await ask(a, env)).text()
  const again = await ask(a, env)
  expect(again.status).toBe(429)
  expect(await again.text()).toContain('以降に、もう一度お試しください')
})

test('F42-AC28: Given a client at its own limit while the total has room, When it asks with another address, Then the client limit still refuses it', async () => {
  const env = capped(100, {
    LOGIN_CODE_LIMITS: {
      perAddress: 1000,
      perSource: 1,
      attemptsPerAddress: 1000,
      total: 100,
    },
  })
  const [a, b] = addresses(2) as [string, string]
  await (await ask(a, env, '203.0.113.5')).text()
  const again = await ask(b, env, '203.0.113.5')
  expect(again.status).toBe(429)
  expect(await again.text()).toContain('以降に、もう一度お試しください')
})

test('F42-AC25: Given the total cap is reached, When someone who already holds a code enters it, Then they sign in: only asking for codes is capped', async () => {
  const env = capped(1)
  const [a, b] = addresses(2) as [string, string]
  await invite(database, a)
  await invite(database, b)
  await (await ask(a, env)).text()
  expect((await ask(b, env)).status).toBe(429)
  const entered = await enter(a, await lastCode(database, a), env)
  expect(entered.status).toBe(303)
  expect(entered.headers.getSetCookie().join(';')).toContain(
    '__Host-slide_owner=',
  )
})

test('F42-AC27: Given a total cap of 10, When the 7th, the 8th and the 10th codes are asked for, Then the operator is told once, at the 8th, with the count and no address', async () => {
  const posted = discord()
  const env = capped(10)
  const people = addresses(11)
  const seen: number[] = []
  for (const person of people.slice(0, 10)) {
    await invite(database, person)
    await (await ask(person, env)).text()
    seen.push(posted.length)
  }
  expect(seen).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 1, 1])
  const [message] = posted
  expect(message!.content).toContain('ログインのメールが多く送られています')
  expect(message!.content).toContain('8 通')
  for (const person of people)
    expect(JSON.stringify(posted)).not.toContain(person)
  expect(JSON.stringify(posted)).not.toMatch(/@\w|\d+\.\d+\.\d+\.\d+/)
  const rows = await told('mail_flood')
  expect(rows.map((row) => row.state)).toEqual(['sent'])
  expect(rows[0]!.link).toBe('/operations#signups')
})

test('F42-AC27: Given the cap is reached and more codes are asked for, When the refusals come, Then the alert is not told again within the hour', async () => {
  const posted = discord()
  const env = capped(2)
  const people = addresses(5)
  for (const person of people) await (await ask(person, env)).text()
  expect(posted).toHaveLength(1)
  expect(await orm.$count(alerts)).toBe(1)
})

test('F42-AC27: Given no webhook is set, When the 80% point is reached, Then the alert is kept as not sent, and login goes on', async () => {
  const env = capped(5, { DISCORD_WEBHOOK_URL: undefined })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  for (const person of addresses(4)) {
    const response = await ask(person, env)
    expect(response.status).toBe(200)
  }
  expect((await told('mail_flood')).map((row) => row.state)).toEqual([
    'not_configured',
  ])
})

test('F42-AC25: Given the cap is reached by many addresses, When the cap lets go, Then the time it says is when the oldest of the newest codes leaves the hour', async () => {
  const env = capped(2)
  const now = Math.floor(Date.now() / 1000)
  await orm.insert(loginCodeRequests).values([
    {
      id: 'o1',
      kind: 'send',
      address_hash: 'a',
      source_hash: 'x',
      requested_at: now - 1000,
    },
    {
      id: 'o2',
      kind: 'send',
      address_hash: 'b',
      source_hash: 'y',
      requested_at: now - 10,
    },
  ])
  const refused = await ask(emailOf('c'), env)
  expect(refused.status).toBe(429)
  // The oldest of the two leaves the hour in 2600 seconds.
  const wait = Number(refused.headers.get('retry-after'))
  expect(wait).toBeGreaterThan(2590)
  expect(wait).toBeLessThanOrEqual(2600)
})

test('F42-AC10: Given 9 people registered in the last hour and none before, When a 10th registers, Then the operator is told at once of a surge with the count only', async () => {
  const posted = discord()
  const env = capped(1000)
  const now = Math.floor(Date.now() / 1000)
  for (let i = 0; i < 9; i++)
    await orm.insert(accounts).values({
      user_id: `old${i}`,
      handle: `old${i}`,
      created_at: now - 60 - i,
    })
  await invite(database, emailOf('tenth'))
  await (await ask(emailOf('tenth'), env)).text()
  const entered = await enter(
    emailOf('tenth'),
    await lastCode(database, emailOf('tenth')),
    env,
  )
  const cookie = entered.headers
    .getSetCookie()
    .find((c) => c.startsWith('__Host-slide_owner='))!
    .split(';')[0]!
  expect(posted).toEqual([])
  const done = await server.fetch(
    new Request(`${TEST_ORIGIN}/welcome`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        handle: 'tenth',
        name: 'Tenth',
        terms: 'on',
      }),
    }),
    env,
  )
  expect(done.status).toBe(303)
  expect(posted).toHaveLength(1)
  expect(posted[0]!.content).toContain('新しい登録が急に増えています')
  expect(posted[0]!.content).toContain('10 件')
  expect(JSON.stringify(posted)).not.toMatch(/@\w|tenth/i)
  expect((await told('signup_surge')).map((row) => row.count)).toEqual([10])
})

test('F42-AC10: Given a steady week of one sign-up an hour, When 10 register in an hour, Then it is not a surge, and the 11th makes it one', async () => {
  const posted = discord()
  const env = capped(1000)
  const now = Math.floor(Date.now() / 1000)
  // 168 people, one an hour, in the 7 days before the last hour.
  const week = Array.from({ length: 168 }, (_, i) => ({
    user_id: `w${i}`,
    handle: `w${i}`,
    created_at: now - 3600 - 600 - i * 3600,
  }))
  for (let i = 0; i < week.length; i += 20)
    await orm.insert(accounts).values(week.slice(i, i + 20))
  const register = async (name: string) => {
    await invite(database, emailOf(name))
    await (await ask(emailOf(name), env)).text()
    const entered = await enter(
      emailOf(name),
      await lastCode(database, emailOf(name)),
      env,
    )
    const cookie = entered.headers
      .getSetCookie()
      .find((c) => c.startsWith('__Host-slide_owner='))!
      .split(';')[0]!
    return server.fetch(
      new Request(`${TEST_ORIGIN}/welcome`, {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: TEST_ORIGIN,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ handle: name, name, terms: 'on' }),
      }),
      env,
    )
  }
  for (let i = 0; i < 10; i++) await register(`steady${i}`)
  expect(posted).toEqual([])
  await register('steady10')
  expect(posted).toHaveLength(1)
  expect(posted[0]!.content).toContain('11 件')
}, 60_000)
