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
import { runScheduled } from '../app/cron-routes'
import { hourlyTask } from '../app/cron-task'
import { applyMigrations } from '../db/test-migrations'
import { alerts, mailOutbox } from '../db/schema'
import { readOutbox } from '../mail/outbox-store'
import { CONTACT_ADDRESS } from '../site/legal-pages'
import { listQueued } from './alert-store'
import { cronFailedNotice, noticeOf } from './notice'
import { notifierOf } from './notify-routes'
import { sendDigest } from './digest-routes'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const DAY = Date.UTC(2026, 10, 26, 23, 17) / 1000

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await drizzle(database).delete(alerts)
  await drizzle(database).delete(mailOutbox)
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => platform.dispose())

const envOf = (extra: Partial<Env> = {}) =>
  ({
    ...platform.env,
    MAIL_OUTBOX: 'on',
    OPERATOR_ORIGIN: 'https://admin.slide.example',
    ...extra,
  }) as Env

const quiet = () => {
  const lines: Record<string, unknown>[] = []
  const keep = (text: unknown) => lines.push(JSON.parse(String(text)))
  vi.spyOn(console, 'log').mockImplementation(keep)
  vi.spyOn(console, 'error').mockImplementation(keep)
  return lines
}

const queue = (
  env: Env,
  ...notices: Parameters<ReturnType<typeof notifierOf>>[0][]
) =>
  Promise.all(
    notices.map((notice) =>
      notifierOf(env, { clock: () => DAY * 1000 })(notice),
    ),
  )

test('F39-AC7: Given nothing queued, When the daily mail runs, Then no mail is sent', async () => {
  const env = envOf({ ALERT_MAIL_TO: 'ops@mail.example' })
  expect(await sendDigest(env, DAY)).toEqual({ rows: 0, sent: false })
  expect(await readOutbox(database, 'ops@mail.example')).toEqual([])
  expect(await readOutbox(database, CONTACT_ADDRESS)).toEqual([])
})

test('F39-AC8: Given alerts queued, When the daily mail runs twice in the day, Then one mail goes to the operator address and the second run sends none', async () => {
  const env = envOf({ ALERT_MAIL_TO: 'Ops@Mail.example' })
  await queue(
    env,
    noticeOf('report_received', 1, '/'),
    noticeOf(
      'luma_feed_stopped',
      2,
      'docs/dev/alerts-runbook.md#luma-feed-stopped',
    ),
  )
  expect(await sendDigest(env, DAY)).toEqual({ rows: 2, sent: true })
  expect(await sendDigest(env, DAY + 60)).toEqual({ rows: 0, sent: false })
  const mails = await readOutbox(database, 'ops@mail.example')
  expect(mails).toHaveLength(1)
  expect(mails[0]!.subject).toBe('[slide] 運用のお知らせ(2026-11-27)')
  expect(mails[0]!.body).toContain('通報が届きました: 1 件')
  expect(mails[0]!.body).toContain('Luma の配信が止まりました: 2 件')
  expect(await listQueued(database)).toEqual([])
})

test('F39-AC8: Given no operator address set, When the mail runs, Then it goes to the contact address', async () => {
  const env = envOf()
  await queue(env, noticeOf('report_received', 1, '/'))
  await sendDigest(env, DAY)
  expect(await readOutbox(database, CONTACT_ADDRESS)).toHaveLength(1)
})

test('F39-AC8: Given an operator address that is not an address, When the mail runs, Then it goes to the contact address and the setting is not logged', async () => {
  const lines = quiet()
  const env = envOf({ ALERT_MAIL_TO: 'not an address' })
  await queue(env, noticeOf('report_received', 1, '/'))
  await sendDigest(env, DAY)
  expect(await readOutbox(database, CONTACT_ADDRESS)).toHaveLength(1)
  expect(lines).toEqual([{ event: 'alert_mail_to_invalid' }])
})

test('F39-AC3: Given a task that failed in two firings of the day, When the daily mail runs, Then the one mail names the task and says twice', async () => {
  quiet()
  const env = envOf({ ALERT_MAIL_TO: 'ops@mail.example' })
  const breaks = hourlyTask('breaks', async () => {
    throw new Error('x')
  })
  const works = vi.fn(async () => ({}))
  const fire = async (hour: number) => {
    const waited: Promise<unknown>[] = []
    runScheduled(
      [breaks, hourlyTask('works', works)],
      {
        scheduledTime: Date.UTC(2026, 10, 26, hour, 17),
        cron: '17 * * * *',
        noRetry() {},
      },
      env,
      {
        waitUntil: (p: Promise<unknown>) => waited.push(p),
        passThroughOnException() {},
        props: {},
      } as unknown as ExecutionContext,
    )
    await Promise.all(waited)
  }
  await fire(3)
  await fire(4)
  expect(works).toHaveBeenCalledTimes(2)
  await sendDigest(env, DAY)
  const [mail] = await readOutbox(database, 'ops@mail.example')
  expect(mail!.body).toContain('定期の処理が失敗しました(breaks): 2 回')
  expect(mail!.body).not.toContain('works')
})

test('F39-AC9: Given alerts of every kind queued, When the mail is made, Then it holds no at sign and no IP address', async () => {
  const env = envOf({ ALERT_MAIL_TO: 'ops@mail.example' })
  await queue(
    env,
    cronFailedNotice('feeds_read', 1, 'docs/dev/alerts-runbook.md#cron-failed'),
    noticeOf('report_received', 3, '/'),
    noticeOf('d1_size', 5200, 'docs/dev/alerts-runbook.md#d1-size'),
    noticeOf('backup_failed', 1, '/operations#backups'),
  )
  await sendDigest(env, DAY)
  const [mail] = await readOutbox(database, 'ops@mail.example')
  expect(mail!.body).not.toMatch(/@|\d+\.\d+\.\d+\.\d+/)
  expect(mail!.subject).not.toContain('@')
})

test('F39-AC7: Given a mail service not set up, When the daily mail runs, Then the alerts stay queued, one line is logged and nothing fails', async () => {
  const lines = quiet()
  const env = envOf({ MAIL_OUTBOX: undefined })
  await queue(env, noticeOf('report_received', 1, '/'))
  expect(await sendDigest(env, DAY)).toEqual({ rows: 0, sent: false })
  expect(lines).toEqual([
    { event: 'alert_digest_not_sent', reason: 'mail_unset' },
  ])
  expect(await listQueued(database)).toHaveLength(1)
})

test('F39-AC8: Given a mail service that fails, When the daily mail runs, Then it rejects, the alerts stay queued and the next day sends them', async () => {
  const env = envOf({
    MAIL_OUTBOX: undefined,
    MAIL_API_TOKEN: 'token',
    MAIL_ACCOUNT_ID: 'acct',
    MAIL_FROM: 'noreply@mail.example',
    ALERT_MAIL_TO: 'ops@mail.example',
  })
  await queue(env, noticeOf('report_received', 1, '/'))
  const sent: unknown[] = []
  let status = 500
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)))
      return new Response('{}', { status })
    }),
  )
  await expect(sendDigest(env, DAY)).rejects.toThrow(
    'Mail service answered 500',
  )
  expect(await listQueued(database)).toHaveLength(1)
  status = 200
  expect(await sendDigest(env, DAY + 86400)).toEqual({ rows: 1, sent: true })
  expect(await listQueued(database)).toEqual([])
  vi.unstubAllGlobals()
  expect(sent).toHaveLength(2)
  expect(sent[1]).toMatchObject({ to: 'ops@mail.example' })
})

test('Given an alert queued while the mail was being made, When the mail marks what it sent, Then the later alert waits for the next one', async () => {
  const env = envOf({ ALERT_MAIL_TO: 'ops@mail.example' })
  await queue(env, noticeOf('report_received', 1, '/'))
  // The alert arrives while the mail is on its way out.
  const outbox = vi
    .spyOn(await import('../mail/outbox-store'), 'writeOutbox')
    .mockImplementation(async () => {
      await queue(
        env,
        noticeOf(
          'luma_feed_stopped',
          1,
          'docs/dev/alerts-runbook.md#luma-feed-stopped',
        ),
      )
    })
  await sendDigest(env, DAY)
  outbox.mockRestore()
  expect((await listQueued(database)).map((a) => a.kind)).toEqual([
    'luma_feed_stopped',
  ])
})

test('Given a row of a kind the service no longer knows, When the mail runs, Then it is marked and no mail goes out', async () => {
  const lines = quiet()
  const env = envOf({ ALERT_MAIL_TO: 'ops@mail.example' })
  await drizzle(database).insert(alerts).values({
    kind: 'retired_kind',
    urgency: 'next_day',
    count: 1,
    link: '/',
    raised_at: DAY,
    state: 'queued',
  })
  expect(await sendDigest(env, DAY)).toEqual({ rows: 1, sent: false })
  expect(await readOutbox(database, 'ops@mail.example')).toEqual([])
  expect(await listQueued(database)).toEqual([])
  expect(lines).toEqual([{ event: 'alert_digest_empty', rows: 1 }])
})
