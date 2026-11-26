import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { readSignupPause } from '../auth/signup-pause-store'
import { accounts, signupPauseEvents } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { resetTables, testEnv } from '../publication/test-support'
import { ACCESS_TOKEN_HEADER } from './access'
import { accessTeam, AUDIENCE, OPERATOR_ORIGIN, TEAM } from './test-support'

const team = await accessTeam()
vi.mock('./access-client', () => ({ accessKeys: () => team.keys }))

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const orm = drizzle(database)
const base = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
  OPERATOR_ORIGIN,
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUDIENCE,
}
const closed = base as unknown as Env
const open = { ...base, OPEN_SIGNUP: 'on' } as unknown as Env

beforeAll(() => applyMigrations(database))
beforeEach(() => resetTables(database))
afterAll(() => platform.dispose())

const get = async (path: string, env: Env = closed) =>
  server.fetch(
    new Request(`${OPERATOR_ORIGIN}${path}`, {
      headers: { [ACCESS_TOKEN_HEADER]: await team.sign() },
    }),
    env,
  )
async function post(
  path: string,
  options: { token?: boolean; origin?: string | null } = {},
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  }
  if (options.token !== false) headers[ACCESS_TOKEN_HEADER] = await team.sign()
  if (options.origin !== null)
    headers.Origin = options.origin ?? OPERATOR_ORIGIN
  return server.fetch(
    new Request(`${OPERATOR_ORIGIN}${path}`, {
      method: 'POST',
      headers,
      body: new URLSearchParams(),
    }),
    closed,
  )
}
const frameOf = (page: string) =>
  page.slice(
    page.indexOf('<section id="signups">'),
    page.indexOf('</section>', page.indexOf('<section id="signups">')),
  )

test('F42-AC11: Given people who registered lately, When the operations page is opened, Then the frame counts the last hour and the last 24 hours and says whether the service is invite-only or open', async () => {
  const now = Math.floor(Date.now() / 1000)
  await orm.insert(accounts).values([
    { user_id: 'a', handle: 'a', created_at: now - 60 },
    { user_id: 'b', handle: 'b', created_at: now - 7200 },
    { user_id: 'c', handle: 'c', created_at: now - 100_000 },
  ])
  const closedFrame = frameOf(await (await get('/operations')).text())
  expect(closedFrame).toMatch(/<dd>\s*招待制\s*<\/dd>/)
  expect(closedFrame).toMatch(/直近 1 時間の登録<\/dt>\s*<dd>1 人/)
  expect(closedFrame).toMatch(/直近 24 時間の登録<\/dt>\s*<dd>2 人/)
  const openFrame = frameOf(await (await get('/operations', open)).text())
  expect(openFrame).toContain('開いている')
})

test('F42-AC12: Given the operator presses "新しい登録を止める", When the page is read again, Then sign-up is stopped, the press is kept with who made it, and the page offers to resume', async () => {
  const response = await post('/operations/signups/pause')
  expect(response.status).toBe(303)
  expect(response.headers.get('location')).toBe('/operations#signups')
  expect((await readSignupPause(database)).kind).toBe('paused')
  const [row] = await orm.select().from(signupPauseEvents)
  expect(row).toMatchObject({ paused: true })
  expect(row!.changed_by).toContain('@')
  const frame = frameOf(await (await get('/operations')).text())
  expect(frame).toContain('止めている(')
  expect(frame).toContain('再開する')
  expect(frame).not.toContain('新しい登録を止める')
})

test('F42-AC15: Given sign-up is stopped, When the operator presses "再開する", Then it goes on and the page offers to stop', async () => {
  await post('/operations/signups/pause')
  expect((await post('/operations/signups/resume')).status).toBe(303)
  expect((await readSignupPause(database)).kind).toBe('running')
  const frame = frameOf(await (await get('/operations')).text())
  expect(frame).toContain('受け付けている')
  expect(frame).toContain('新しい登録を止める')
  expect(await orm.$count(signupPauseEvents)).toBe(2)
})

test('F42-AC12: Given a press without the operator’s sign-in, from another origin or with no origin, When it arrives, Then nothing changes', async () => {
  const noToken = await post('/operations/signups/pause', { token: false })
  expect(noToken.status).not.toBe(303)
  expect(
    (
      await post('/operations/signups/pause', {
        origin: 'https://evil.example',
      })
    ).status,
  ).toBe(403)
  expect(
    (await post('/operations/signups/pause', { origin: null })).status,
  ).toBe(403)
  expect((await readSignupPause(database)).kind).toBe('running')
  expect(await orm.$count(signupPauseEvents)).toBe(0)
})

test('F42-AC12: Given the public host, When the operator’s paths are asked for there, Then there is no such page', async () => {
  const response = await server.fetch(
    new Request('https://slide.example/operations/signups/pause', {
      method: 'POST',
      headers: { Origin: 'https://slide.example' },
    }),
    closed,
  )
  expect(response.status).toBeGreaterThanOrEqual(400)
  expect(await orm.$count(signupPauseEvents)).toBe(0)
})
