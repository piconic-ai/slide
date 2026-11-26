import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/d1'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { alerts } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { ACCESS_TOKEN_HEADER } from '../operator/access'
import {
  accessTeam,
  AUDIENCE,
  OPERATOR_ORIGIN,
  TEAM,
} from '../operator/test-support'
import { testEnv } from '../publication/test-support'
import { cronFailedNotice, noticeOf } from './notice'
import { notifierOf } from './notify-routes'

const team = await accessTeam()
// The keys come from the stand-in team instead of the network.
vi.mock('../operator/access-client', () => ({ accessKeys: () => team.keys }))

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGH-_0123456789'
const WEBHOOK = `https://discord.com/api/webhooks/123456789012345678/${TOKEN}`
const T0 = Date.UTC(2026, 10, 26, 3, 5, 9)

beforeAll(() => applyMigrations(database))
beforeEach(() => drizzle(database).delete(alerts))
afterAll(() => platform.dispose())

const envOf = (extra: Partial<Env> = {}) =>
  ({
    ...testEnv(platform.env),
    CONTENT_ORIGIN: 'https://content.example',
    OPERATOR_ORIGIN,
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUDIENCE,
    ...extra,
  }) as unknown as Env

async function operations(env: Env) {
  const response = await server.fetch(
    new Request(`${OPERATOR_ORIGIN}/operations`, {
      headers: { [ACCESS_TOKEN_HEADER]: await team.sign() },
    }),
    env,
  )
  expect(response.status).toBe(200)
  return response.text()
}

/** The text of the frame "通知": from its heading to the end of its section. */
const frameOf = (page: string) =>
  page.slice(
    page.indexOf('<section id="alerts">'),
    page.indexOf('</section>', page.indexOf('<section id="alerts">')),
  )

test('F39-AC11: Given no webhook, When the operations page is opened, Then the alerts frame says 未設定 with what to set and where the steps are, and the page still opens', async () => {
  const frame = frameOf(
    await operations(envOf({ DISCORD_WEBHOOK_URL: undefined })),
  )
  expect(frame).toContain('未設定')
  expect(frame).toContain('DISCORD_WEBHOOK_URL')
  expect(frame).toContain('docs/dev/deploy.md#通知と監視作業-m')
})

test('F39-AC11: Given a secret that is not a Discord webhook, When the page is opened, Then it says 未設定 and does not show the value', async () => {
  const secret = 'https://evil.example/hook-with-a-secret-token'
  const page = await operations(envOf({ DISCORD_WEBHOOK_URL: secret }))
  expect(frameOf(page)).toContain('未設定')
  expect(page).not.toContain('evil.example')
  expect(page).not.toContain('hook-with-a-secret-token')
})

test('F39-AC11 and F39-AC20: Given a webhook and alerts told and queued, When the page is opened, Then the frame lists them newest first and never shows the webhook address', async () => {
  const env = envOf({ DISCORD_WEBHOOK_URL: WEBHOOK })
  const send = vi.fn(async () => new Response(null, { status: 204 }))
  await notifierOf(env, {
    send: send as unknown as typeof fetch,
    clock: () => T0,
  })(
    noticeOf(
      'login_mail_failed',
      3,
      'docs/dev/alerts-runbook.md#login-mail-failed',
    ),
  )
  await notifierOf(env, { clock: () => T0 + 60_000 })(
    cronFailedNotice('feeds_read', 1, 'docs/dev/alerts-runbook.md#cron-failed'),
  )
  const page = await operations(env)
  const frame = frameOf(page)
  expect(frame).not.toContain('未設定')
  expect(frame).toContain('設定されています')
  expect(frame).toContain('2026-11-26T03:05:09.000Z')
  expect(frame).toContain('2026-11-26T03:06:09.000Z')
  expect(frame).toContain('Discord に送信済み')
  expect(frame).toContain('翌日のメールを待っている')
  expect(frame.indexOf('定期の処理が失敗しました')).toBeLessThan(
    frame.indexOf('ログインのメール'),
  )
  expect(page).not.toContain(WEBHOOK)
  expect(page).not.toContain(TOKEN)
})

test('F39-AC20: Given a day of alerts, When the page is opened, Then it lists the twenty newest and no more', async () => {
  const db = drizzle(database)
  const row = (i: number) => ({
    kind: 'report_received',
    urgency: 'next_day' as const,
    count: 1,
    link: '/',
    raised_at: T0 / 1000 + i,
    state: 'queued' as const,
  })
  // D1 takes at most a hundred bound values in one statement.
  await db.insert(alerts).values(Array.from({ length: 12 }, (_, i) => row(i)))
  await db
    .insert(alerts)
    .values(Array.from({ length: 13 }, (_, i) => row(12 + i)))
  const frame = frameOf(await operations(envOf()))
  expect(frame.match(/<tr>/g)).toHaveLength(21)
})

test('F39-AC20: Given a message left sending for good, a refused one and a maintenance notice, When the page is opened, Then they read as failed, refused and by their phase', async () => {
  const now = Math.floor(Date.now() / 1000)
  const row = {
    urgency: 'immediate' as const,
    count: 0,
    link: '/operations#alerts',
  }
  await drizzle(database)
    .insert(alerts)
    .values([
      {
        ...row,
        kind: 'login_mail_failed',
        raised_at: now - 3600,
        state: 'sending',
      },
      {
        ...row,
        kind: 'deploy_check_failed',
        raised_at: now - 1800,
        state: 'refused',
      },
      {
        ...row,
        kind: 'maintenance',
        phase: 'ended',
        raised_at: now - 60,
        state: 'sent',
      },
      { ...row, kind: 'signup_surge', raised_at: now - 30, state: 'sending' },
    ])
  const frame = frameOf(await operations(envOf()))
  expect(frame).toContain('送信に失敗')
  expect(frame).toContain('Discord に断られた(送り先を確かめる)')
  expect(frame).toContain('メンテナンスが終わりました')
  // One that is only a few seconds old is still on its way.
  expect(frame).toContain('送信中')
})
