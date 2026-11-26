import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { collectDaily } from '../alerts/daily-routes'
import { sendDigest } from '../alerts/digest-routes'
import server from '../app/routes'
import { alerts, accounts } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { deckIdSchema } from '../decks/deck-id'
import { readOutbox } from '../mail/outbox-store'
import {
  emailOf,
  lastCode,
  resetTables,
  seedPublic,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { saveReport } from '../reports/store'
import { ACCESS_TOKEN_HEADER } from './access'
import { accessTeam, AUDIENCE, OPERATOR_ORIGIN, TEAM } from './test-support'

const team = await accessTeam()
vi.mock('./access-client', () => ({ accessKeys: () => team.keys }))

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = {
  ...testEnv(platform.env),
  OPEN_SIGNUP: 'on',
  CONTENT_ORIGIN: 'https://content.example',
  OPERATOR_ORIGIN,
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUDIENCE,
  ALERT_MAIL_TO: 'ops@mail.example',
} as unknown as Env

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await orm.delete(alerts)
})
afterAll(() => platform.dispose())

const form = (
  path: string,
  fields: Record<string, string>,
  base: string,
  headers: Record<string, string>,
) =>
  server.fetch(
    new Request(`${base}${path}`, {
      method: 'POST',
      headers: {
        Origin: base,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...headers,
      },
      body: new URLSearchParams(fields),
    }),
    env,
  )
const operator = async (path: string, fields: Record<string, string>) =>
  form(path, fields, OPERATOR_ORIGIN, {
    [ACCESS_TOKEN_HEADER]: await team.sign(),
  })
const share = (path: string) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`), env)

/** Someone who signs up while sign-up is open and has a slide up. */
async function newcomerWithASlide() {
  const email = emailOf('troll')
  await (await form('/login', { email }, TEST_ORIGIN, {})).text()
  const entered = await form(
    '/login/code',
    { email, code: await lastCode(db, email) },
    TEST_ORIGIN,
    {},
  )
  const cookie = entered.headers
    .getSetCookie()
    .find((value) => value.startsWith('__Host-slide_owner='))!
    .split(';')[0]!
  await form(
    '/welcome',
    { handle: 'troll', name: 'Troll', terms: 'on' },
    TEST_ORIGIN,
    { Cookie: cookie },
  )
  const [account] = await orm.select().from(accounts)
  await seedPublic(db, 'bait', 100, 'Bait', account!.user_id)
  return { cookie, userId: account!.user_id }
}

test('F42-AC23: Given someone who signed up while sign-up was open and put up a slide, When a reader reports it, Then the next-day mail has it, and the operator can hide the slide and suspend the account from the operator page', async () => {
  const { cookie, userId } = await newcomerWithASlide()
  expect((await share('/@troll/bait')).status).toBe(200)

  // A reader reports it: one report, told the next day (D-131, D-56).
  await saveReport(db, {
    deckId: deckIdSchema.parse('bait'),
    deploymentId: 'version-bait',
    sharePath: '/@troll/bait',
    reason: 'nuisance',
    note: '',
    reporterUserId: 'a-reader',
    now: Math.floor(Date.now() / 1000),
  })
  const at = Math.floor(Date.now() / 1000) + 60
  expect(await collectDaily(env, at)).toMatchObject({ reports: 1 })
  expect(await sendDigest(env, at)).toEqual({ rows: 1, sent: true })
  const [mail] = await readOutbox(db, 'ops@mail.example')
  expect(`${mail?.subject}${mail?.body}`).toContain('通報')
  expect(`${mail?.subject}${mail?.body}`).not.toContain('troll')

  // The operator's page lists the reported slide.
  const home = await server.fetch(
    new Request(`${OPERATOR_ORIGIN}/`, {
      headers: { [ACCESS_TOKEN_HEADER]: await team.sign() },
    }),
    env,
  )
  expect(await home.text()).toContain('@troll/bait')

  // Hide the slide.
  const hidden = await operator('/takedowns', {
    target: '@troll/bait',
    reason: 'a nuisance',
  })
  expect(hidden.headers.get('Location')).toBe('/?result=hidden')
  expect((await share('/@troll/bait')).status).toBe(404)

  // Suspend the account.
  const suspended = await operator('/suspensions', {
    target: '@troll',
    reason: 'repeats',
  })
  expect(suspended.headers.get('Location')).toBe('/?result=suspended')
  const page = await server.fetch(
    new Request(`${TEST_ORIGIN}/my/slides`, { headers: { Cookie: cookie } }),
    env,
  )
  expect(await page.text()).toMatch(/停止/)
  expect(userId).toBeTruthy()
})
