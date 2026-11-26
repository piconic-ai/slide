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
import { applyMigrations } from '../db/test-migrations'
import { alerts } from '../db/schema'
import {
  dropOldAlerts,
  KEEP_SECONDS,
  listQueued,
  listRecent,
  markMailed,
} from './alert-store'
import { cronFailedNotice, noticeOf } from './notice'
import { notifierOf } from './notify-routes'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGH-_0123456789'
const WEBHOOK = `https://discord.com/api/webhooks/123456789012345678/${TOKEN}`
const HOUR = 3600_000
const T0 = Date.UTC(2026, 10, 26, 3, 0, 0)

beforeAll(() => applyMigrations(database))
beforeEach(() => drizzle(database).delete(alerts))
afterEach(() => vi.restoreAllMocks())
afterAll(() => platform.dispose())

const envOf = (extra: Partial<Env> = {}) =>
  ({
    ...platform.env,
    OPERATOR_ORIGIN: 'https://admin.slide.example',
    DISCORD_WEBHOOK_URL: WEBHOOK,
    ...extra,
  }) as Env

const logs = () => {
  const lines: Record<string, unknown>[] = []
  const keep = (text: unknown) => lines.push(JSON.parse(String(text)))
  vi.spyOn(console, 'log').mockImplementation(keep)
  vi.spyOn(console, 'error').mockImplementation(keep)
  return lines
}

const answering = (status: number) =>
  vi.fn(async () => new Response(null, { status })) as unknown as typeof fetch &
    ReturnType<typeof vi.fn>

const loginMail = (count = 3) =>
  noticeOf('login_mail_failed', count, '/operations#alerts')

test('F39-AC1: Given a webhook, When an alert is told at once, Then one message goes to it with the kind, the count and the link', async () => {
  const send = answering(204)
  await notifierOf(envOf(), { send, clock: () => T0 })(loginMail())
  expect(send).toHaveBeenCalledTimes(1)
  const [url, init] = send.mock.calls[0] as [string, RequestInit]
  expect(url).toBe(WEBHOOK)
  const body = JSON.parse(String(init.body))
  expect(body.content).toContain('ログインのメールの送信に失敗しています')
  expect(body.content).toContain('3 回')
  expect(body.content).toContain(
    'https://admin.slide.example/operations#alerts',
  )
  expect(body.allowed_mentions).toEqual({ parse: [] })
  expect(init.redirect).toBe('manual')
  expect((await listRecent(database, 5)).map((a) => a.state)).toEqual(['sent'])
})

test('F39-AC2: Given an alert told, When the same kind is raised again within the hour, Then it is not told again', async () => {
  const lines = logs()
  const send = answering(204)
  let now = T0
  const notify = notifierOf(envOf(), { send, clock: () => now })
  await notify(loginMail())
  now = T0 + 59 * 60_000
  await notify(loginMail(7))
  expect(send).toHaveBeenCalledTimes(1)
  expect(lines).toContainEqual({
    event: 'alert_throttled',
    kind: 'login_mail_failed',
  })
  now = T0 + HOUR + 1000
  await notify(loginMail(9))
  expect(send).toHaveBeenCalledTimes(2)
})

test('F39-AC2: Given the same kind raised five times together, When they are told, Then exactly one message goes out', async () => {
  const send = answering(204)
  const notify = notifierOf(envOf(), { send, clock: () => T0 })
  await Promise.all([1, 2, 3, 4, 5].map(() => notify(loginMail())))
  expect(send).toHaveBeenCalledTimes(1)
})

test('F39-AC2: Given two kinds, When both are raised in the hour, Then each is told once', async () => {
  const send = answering(204)
  const notify = notifierOf(envOf(), { send, clock: () => T0 })
  await notify(loginMail())
  await notify(noticeOf('deploy_check_failed', 1, '/operations'))
  expect(send).toHaveBeenCalledTimes(2)
})

test('F39-AC16: Given a throttle of ten minutes, When the same kind is raised eleven minutes later, Then it is told', async () => {
  const send = answering(204)
  let now = T0
  const env = envOf({ ALERT_THRESHOLDS: { throttleSeconds: 600 } })
  const notify = notifierOf(env, { send, clock: () => now })
  await notify(loginMail())
  now += 11 * 60_000
  await notify(loginMail())
  expect(send).toHaveBeenCalledTimes(2)
})

test('F39-AC10: Given no webhook, When an alert is told at once, Then nothing is sent, one line is logged and the call resolves', async () => {
  const lines = logs()
  const send = answering(204)
  await expect(
    notifierOf(envOf({ DISCORD_WEBHOOK_URL: undefined }), {
      send,
      clock: () => T0,
    })(loginMail()),
  ).resolves.toBeUndefined()
  expect(send).not.toHaveBeenCalled()
  expect(lines).toEqual([
    {
      event: 'alert_not_sent',
      kind: 'login_mail_failed',
      reason: 'webhook_unset',
    },
  ])
  expect((await listRecent(database, 5)).map((a) => a.state)).toEqual([
    'not_configured',
  ])
})

test('F39-AC10: Given a secret that is not a Discord webhook, When an alert is told, Then it is as if unset and the value is not logged', async () => {
  const lines = logs()
  const send = answering(204)
  const secret = 'https://evil.example/api/webhooks/123456789012345678/' + TOKEN
  await notifierOf(envOf({ DISCORD_WEBHOOK_URL: secret }), {
    send,
    clock: () => T0,
  })(loginMail())
  expect(send).not.toHaveBeenCalled()
  expect(lines[0]).toMatchObject({ reason: 'webhook_invalid' })
  expect(JSON.stringify(lines)).not.toContain('evil.example')
})

test('F39-AC10: Given the webhook answers an error, When an alert is told, Then it is logged by its status, not told as sent, and does not hold back the next try', async () => {
  const lines = logs()
  const bad = answering(500)
  let now = T0
  await notifierOf(envOf(), { send: bad, clock: () => now })(loginMail())
  expect(lines).toContainEqual({
    event: 'alert_send_failed',
    kind: 'login_mail_failed',
    status: 500,
  })
  expect(JSON.stringify(lines)).not.toContain(TOKEN)
  expect((await listRecent(database, 5)).map((a) => a.state)).toEqual([
    'failed',
  ])
  const good = answering(204)
  now += 60_000
  await notifierOf(envOf(), { send: good, clock: () => now })(loginMail())
  expect(good).toHaveBeenCalledTimes(1)
})

test.each([
  [
    'a network error',
    new TypeError('connect to 203.0.113.7 failed'),
    'network',
  ],
  [
    'a timeout',
    Object.assign(new Error('x'), { name: 'TimeoutError' }),
    'timeout',
  ],
])(
  'F39-AC10: Given %s, When an alert is told, Then the call resolves and the log names only the reason',
  async (_, error, reason) => {
    const lines = logs()
    const send = vi.fn(async () => {
      throw error
    }) as unknown as typeof fetch
    await expect(
      notifierOf(envOf(), { send, clock: () => T0 })(loginMail()),
    ).resolves.toBeUndefined()
    expect(lines).toEqual([
      { event: 'alert_send_failed', kind: 'login_mail_failed', reason },
    ])
  },
)

test('F39-AC10: Given D1 cannot be written, When an alert is told, Then the call still resolves and logs the failure by name', async () => {
  const lines = logs()
  const broken = { ...envOf(), DB: {} as D1Database }
  await expect(
    notifierOf(broken, { send: answering(204), clock: () => T0 })(loginMail()),
  ).resolves.toBeUndefined()
  expect(lines).toEqual([
    { event: 'alert_error', kind: 'login_mail_failed', name: 'DrizzleError' },
  ])
})

test('F39-AC3: Given a cron failure, When it is told, Then it is queued for the next day with the task name and nothing is sent', async () => {
  const send = answering(204)
  const notify = notifierOf(envOf(), { send, clock: () => T0 })
  await notify(cronFailedNotice('feeds_read', 1, '/operations#alerts'))
  await notify(cronFailedNotice('feeds_read', 1, '/operations#alerts'))
  expect(send).not.toHaveBeenCalled()
  const queued = await listQueued(database)
  expect(queued.map((a) => [a.kind, a.task, a.count, a.state])).toEqual([
    ['cron_failed', 'feeds_read', 1, 'queued'],
    ['cron_failed', 'feeds_read', 1, 'queued'],
  ])
})

test('F39-AC7: Given queued alerts, When they are marked mailed up to an id, Then a later one stays queued', async () => {
  const notify = notifierOf(envOf(), { clock: () => T0 })
  await notify(noticeOf('report_received', 1, '/'))
  await notify(noticeOf('d1_size', 5200, '/operations'))
  const [first, second] = await listQueued(database)
  await markMailed(database, first!.id, T0 / 1000)
  expect((await listQueued(database)).map((a) => a.id)).toEqual([second!.id])
  const rows = await drizzle(database).select().from(alerts)
  expect(rows.find((r) => r.id === first!.id)).toMatchObject({
    state: 'mailed',
    mailed_at: T0 / 1000,
  })
})

test('Given old rows, When they are dropped, Then mailed and told ones past the keep time go and a queued one stays', async () => {
  const db = drizzle(database)
  const old = T0 / 1000 - KEEP_SECONDS - 10
  await db.insert(alerts).values([
    {
      kind: 'd1_size',
      urgency: 'next_day',
      count: 1,
      link: '/',
      raised_at: old,
      state: 'mailed',
      mailed_at: old,
    },
    {
      kind: 'd1_size',
      urgency: 'next_day',
      count: 1,
      link: '/',
      raised_at: old,
      state: 'queued',
    },
    {
      kind: 'login_mail_failed',
      urgency: 'immediate',
      count: 3,
      link: '/',
      raised_at: old,
      state: 'sent',
    },
    {
      kind: 'login_mail_failed',
      urgency: 'immediate',
      count: 3,
      link: '/',
      raised_at: T0 / 1000,
      state: 'sent',
    },
  ])
  await dropOldAlerts(database, T0 / 1000)
  expect(
    (await db.select().from(alerts)).map((r) => [r.state, r.raised_at === old]),
  ).toEqual([
    ['queued', true],
    ['sent', false],
  ])
})

test('Given a row that breaks the rules of a state, When it is written, Then D1 refuses it', async () => {
  const db = drizzle(database)
  const row = { kind: 'd1_size', count: 1, link: '/', raised_at: 1 }
  await expect(
    db.insert(alerts).values({ ...row, urgency: 'immediate', state: 'queued' }),
  ).rejects.toThrow()
  await expect(
    db.insert(alerts).values({ ...row, urgency: 'next_day', state: 'sent' }),
  ).rejects.toThrow()
  await expect(
    db.insert(alerts).values({ ...row, urgency: 'next_day', state: 'mailed' }),
  ).rejects.toThrow()
  await expect(
    db
      .insert(alerts)
      .values({ ...row, urgency: 'next_day', state: 'queued', mailed_at: 5 }),
  ).rejects.toThrow()
  await expect(
    db
      .insert(alerts)
      .values({ ...row, urgency: 'next_day', state: 'queued', count: -1 }),
  ).rejects.toThrow()
})
