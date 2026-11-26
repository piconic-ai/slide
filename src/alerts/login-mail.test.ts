import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from 'vitest'
import { drizzle } from 'drizzle-orm/d1'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import { alerts, alertSignals } from '../db/schema'
import {
  emailOf,
  invite,
  resetTables,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { listRecent } from './alert-store'
import { reportLoginMailFailure } from './login-mail-routes'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGH-_0123456789'
const WEBHOOK = `https://discord.com/api/webhooks/123456789012345678/${TOKEN}`
const T0 = Date.UTC(2026, 10, 26, 3, 0, 0)

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetTables(database)
  await db.delete(alerts)
  await db.delete(alertSignals)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
afterAll(() => platform.dispose())

/** The mail service refuses every message, Turnstile and Discord answer, and each post to Discord is kept. */
function network() {
  const discord: { content: string }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('siteverify')) return Response.json({ success: true })
      if (url.startsWith('https://discord.com/')) {
        discord.push(JSON.parse(String(init?.body)))
        return new Response(null, { status: 204 })
      }
      return new Response('no', { status: 500 })
    }),
  )
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  return discord
}

const real = (extra: Partial<Env> = {}) =>
  ({
    ...testEnv(platform.env),
    MAIL_OUTBOX: undefined,
    MAIL_API_TOKEN: 't',
    MAIL_ACCOUNT_ID: 'a',
    MAIL_FROM: 'login@slide.example',
    TURNSTILE_SITE_KEY: 'site',
    TURNSTILE_SECRET: 'secret',
    OPERATOR_ORIGIN: 'https://admin.slide.example',
    DISCORD_WEBHOOK_URL: WEBHOOK,
    ...extra,
  }) as unknown as Env

const ask = (email: string, env: Env) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}/login`, {
      method: 'POST',
      headers: {
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ email, 'cf-turnstile-response': 't' }),
    }),
    env,
  )

test('F39-AC1 and F39-AC2: Given the mail service failing, When codes are asked for five times in the hour, Then one message goes to Discord, at the third failure, and no other', async () => {
  const discord = network()
  const env = real()
  const addresses = ['a', 'b', 'c', 'd', 'e'].map((n) => emailOf(n))
  for (const address of addresses) await invite(database, address)
  const seen: number[] = []
  for (const address of addresses) {
    const response = await ask(address, env)
    // The page is the same, mail sent or not.
    expect(response.status).toBe(200)
    await response.text()
    seen.push(discord.length)
  }
  expect(seen).toEqual([0, 0, 1, 1, 1])
  const [message] = discord
  expect(message!.content).toContain('ログインのメールの送信に失敗しています')
  expect(message!.content).toContain('3 回')
  for (const address of addresses)
    expect(JSON.stringify(discord)).not.toContain(address)
  expect(JSON.stringify(discord)).not.toMatch(/@\w|\d+\.\d+\.\d+\.\d+/)
  const told = (await listRecent(database, 10)).filter(
    (a) => a.kind === 'login_mail_failed',
  )
  expect(told.map((a) => a.state)).toEqual(['sent'])
})

test('F39-AC1: Given two failures only, When the hour passes, Then nothing is told', async () => {
  const discord = network()
  const env = real()
  for (const n of ['a', 'b']) {
    await invite(database, emailOf(n))
    await (await ask(emailOf(n), env)).text()
  }
  expect(discord).toEqual([])
})

test('F39-AC1: Given an address that is not invited, When a code is asked for, Then no mail is tried and no failure is counted', async () => {
  const discord = network()
  const env = real()
  for (const n of ['a', 'b', 'c', 'd'])
    await (await ask(emailOf(n), env)).text()
  expect(discord).toEqual([])
  expect(await db.select().from(alertSignals)).toEqual([])
})

test('F39-AC1: Given failures spread over more than the window, When the third comes, Then it is not told, and within the window it is', async () => {
  const discord = network()
  const env = real()
  const notify = vi.fn(async () => {})
  const at = (minutes: number) => ({
    clock: () => T0 + minutes * 60_000,
    notify,
  })
  await reportLoginMailFailure(env, at(0))
  await reportLoginMailFailure(env, at(30))
  await reportLoginMailFailure(env, at(61))
  expect(notify).not.toHaveBeenCalled()
  await reportLoginMailFailure(env, at(62))
  expect(notify).toHaveBeenCalledTimes(1)
  expect(notify).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'login_mail_failed',
      urgency: 'immediate',
      count: 3,
    }),
  )
  expect(discord).toEqual([])
})

test('F39-AC16: Given loginMailFailures of 5, When 4 and then 5 failures are counted, Then it is told at the fifth', async () => {
  network()
  const env = real({ ALERT_THRESHOLDS: { loginMailFailures: 5 } })
  const notify = vi.fn(async () => {})
  for (let i = 0; i < 4; i++)
    await reportLoginMailFailure(env, { clock: () => T0 + i, notify })
  expect(notify).not.toHaveBeenCalled()
  await reportLoginMailFailure(env, { clock: () => T0 + 5, notify })
  expect(notify).toHaveBeenCalledTimes(1)
})

test('F39-AC10: Given no webhook, When the mail service fails three times, Then nothing is sent, the page is as usual and the alert is recorded as not sent', async () => {
  const discord = network()
  const env = real({ DISCORD_WEBHOOK_URL: undefined })
  for (const n of ['a', 'b', 'c']) {
    await invite(database, emailOf(n))
    const response = await ask(emailOf(n), env)
    expect(response.status).toBe(200)
    await response.text()
  }
  expect(discord).toEqual([])
  expect((await listRecent(database, 5)).map((a) => [a.kind, a.state])).toEqual(
    [['login_mail_failed', 'not_configured']],
  )
})

test('F39-AC10: Given D1 that cannot be written, When a failure is reported, Then it resolves and logs the kind and the error name only', async () => {
  const lines: string[] = []
  vi.spyOn(console, 'error').mockImplementation(
    (text) => void lines.push(String(text)),
  )
  await expect(
    reportLoginMailFailure({ ...real(), DB: undefined } as unknown as Env),
  ).resolves.toBeUndefined()
  expect(lines.map((l) => JSON.parse(l))).toEqual([
    {
      event: 'alert_error',
      kind: 'login_mail_failed',
      name: expect.any(String),
    },
  ])
})
