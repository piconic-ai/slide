import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from './routes'
import { CRON_TASKS, runScheduled } from './cron-routes'
import { notifierOf } from '../alerts/notify-routes'
import { cronFailedNotice, runbookLink } from '../alerts/notice'
import { applyMigrations } from '../db/test-migrations'
import { ACCESS_TOKEN_HEADER } from '../operator/access'
import {
  accessTeam,
  AUDIENCE,
  OPERATOR_ORIGIN,
  TEAM,
} from '../operator/test-support'
import {
  OWNER_ID,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

// D-08: every resource and setting the fourth scope added may be missing, and
// the service then runs as the third scope did. This takes all of them off at
// once and runs the places that read them. The sign-in limits are the test
// harness's own (LOGIN_CODE_LIMITS), kept so that the test is not slowed.

const team = await accessTeam()
vi.mock('../operator/access-client', () => ({ accessKeys: () => team.keys }))

const platform = await getPlatformProxy<Env>({ persist: false })

/** Every name the fourth scope added to the Worker's configuration. */
const ADDED = [
  'ANALYTICS',
  'UPLOADS_BACKUP',
  'ANALYTICS_ACCOUNT_ID',
  'ANALYTICS_READ_TOKEN',
  'DISCORD_WEBHOOK_URL',
  'ALERT_MAIL_TO',
  'ALERT_THRESHOLDS',
  'OPEN_SIGNUP',
  'NEW_AUTHOR_LIMITS',
  'MAINTENANCE',
] as const

const bare = {
  ...testEnv(platform.env),
  OPERATOR_ORIGIN,
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUDIENCE,
  ...Object.fromEntries(ADDED.map((name) => [name, undefined])),
} as unknown as Env

let alice = ''
beforeAll(async () => {
  await applyMigrations(platform.env.DB)
  alice = await signIn(bare, 'alice')
  await seedPublic(platform.env.DB, 'talk', 2, 'A talk', OWNER_ID)
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => platform.dispose())

const get = (path: string, cookie = '') =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      headers: cookie ? { Cookie: cookie } : {},
    }),
    bare,
  )

test('D-08: Given none of the added settings, When a person signs in, Then an invited address gets in and an address with no invitation is refused', async () => {
  expect(alice).not.toBe('')
  expect(await signIn(bare, 'carol', { id: '99', invited: false })).toBe('')
})

test('D-08: Given none of the added settings, When the pages of the service are opened, Then each answers as before and none says an error', async () => {
  for (const path of [
    '/terms',
    '/privacy',
    '/privacy/external',
    '/help',
    '/help/start',
    '/@alice/talk',
    '/@alice',
  ])
    expect((await get(path)).status, path).toBe(200)
  for (const path of ['/settings', '/my/slides/talk'])
    expect((await get(path, alice)).status, path).toBe(200)
  expect((await get('/account/export/account.json', alice)).status).toBe(200)
})

test('D-08: Given none of the added settings, When the Cron Trigger fires at every hour of a day, Then no task fails, nothing is sent out and no alert goes wrong', async () => {
  const send = vi.spyOn(globalThis, 'fetch')
  const logged: Record<string, unknown>[] = []
  const record = (text: unknown) => logged.push(JSON.parse(String(text)))
  vi.spyOn(console, 'log').mockImplementation(record)
  vi.spyOn(console, 'error').mockImplementation(record)
  for (let hour = 0; hour < 24; hour += 1) {
    const waited: Promise<unknown>[] = []
    runScheduled(
      CRON_TASKS,
      {
        scheduledTime: Date.UTC(2026, 10, 26, hour, 17),
        cron: '17 * * * *',
        noRetry() {},
      },
      bare,
      {
        waitUntil: (promise: Promise<unknown>) => waited.push(promise),
        passThroughOnException() {},
        props: {},
      } as unknown as ExecutionContext,
    )
    await Promise.all(waited)
  }
  const shaped = logged.filter((line) => line.event === 'cron_task')
  expect(new Set(shaped.map((line) => line.task))).toEqual(
    new Set(CRON_TASKS.map((task) => task.name)),
  )
  expect(shaped.filter((line) => line.outcome !== 'ok')).toEqual([])
  expect(logged.filter((line) => line.event === 'alert_error')).toEqual([])
  expect(send).not.toHaveBeenCalled()
})

test('D-08: Given no webhook, When an alert for now is raised, Then it is logged as not sent and nothing leaves', async () => {
  const send = vi.spyOn(globalThis, 'fetch')
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  await notifierOf(bare)({
    kind: 'login_mail_failed',
    urgency: 'immediate',
    count: 3,
    link: runbookLink('login_mail_failed'),
  })
  expect(log.mock.calls.map((call) => JSON.parse(String(call[0])))).toEqual([
    {
      event: 'alert_not_sent',
      kind: 'login_mail_failed',
      reason: 'webhook_unset',
    },
  ])
  expect(send).not.toHaveBeenCalled()
  // A failure of a task is the next day's, and is queued without a webhook.
  await notifierOf(bare)(
    cronFailedNotice('backup', 1, runbookLink('cron_failed')),
  )
  expect(send).not.toHaveBeenCalled()
})

test('D-08: Given none of the added settings, When the operator pages are opened, Then they open and say which settings are not set', async () => {
  const open = async (path: string) =>
    server.fetch(
      new Request(`${OPERATOR_ORIGIN}${path}`, {
        headers: { [ACCESS_TOKEN_HEADER]: await team.sign() },
      }),
      bare,
    )
  const operations = await open('/operations')
  expect(operations.status).toBe(200)
  expect(await operations.text()).toContain('未設定')
  const metrics = await open('/metrics')
  expect(metrics.status).toBe(200)
  expect(await metrics.text()).toContain('未設定')
})
