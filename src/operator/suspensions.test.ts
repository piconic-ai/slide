import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { accounts, suspensions } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { readPublication } from '../publication/store'
import {
  applySuspensionCommand,
  readSuspension,
} from '../publication/suspension-store'
import { TAKEDOWN_REASON_MAX } from '../publication/takedown'
import {
  applyOperatorCommand,
  readTakedown,
} from '../publication/takedown-store'
import {
  INVITED_ID,
  OWNER_ID,
  resetTables,
  seedPublic,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { ACCESS_TOKEN_HEADER } from './access'
import { listSuspendedAccounts } from './store'
import { accessTeam, AUDIENCE, OPERATOR_ORIGIN, TEAM } from './test-support'

const team = await accessTeam()
vi.mock('./access-client', () => ({ accessKeys: () => team.keys }))

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
  OPERATOR_ORIGIN,
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUDIENCE,
} as unknown as Env

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetTables(database)
  await db.insert(accounts).values([
    { user_id: OWNER_ID, handle: 'owner', created_at: 1 },
    { user_id: INVITED_ID, handle: 'other', created_at: 1 },
  ])
  await seedPublic(database, 'talk', 100, 'Talk')
  await seedPublic(database, 'other-talk', 100, 'Other talk', INVITED_ID)
})
afterAll(() => platform.dispose())

const open = async (path = '/') =>
  server.fetch(
    new Request(`${OPERATOR_ORIGIN}${path}`, {
      headers: { [ACCESS_TOKEN_HEADER]: await team.sign() },
    }),
    env,
  )
const share = (path = '/@owner/talk') =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`), env)

async function post(
  path: string,
  fields: Record<string, string>,
  options: { token?: boolean; origin?: string | null; email?: string } = {},
) {
  const headers = new Headers({
    'Content-Type': 'application/x-www-form-urlencoded',
  })
  if (options.token !== false)
    headers.set(
      ACCESS_TOKEN_HEADER,
      await team.sign({ email: options.email ?? 'op@example.com' }),
    )
  if (options.origin !== null)
    headers.set('Origin', options.origin ?? OPERATOR_ORIGIN)
  return server.fetch(
    new Request(`${OPERATOR_ORIGIN}${path}`, {
      method: 'POST',
      headers,
      body: new URLSearchParams(fields).toString(),
    }),
    env,
  )
}
const suspend = (target = '@owner', reason = 'fake sign-in page') =>
  post('/suspensions', { target, reason })
const release = (userId = OWNER_ID) =>
  post(`/suspensions/${userId}/release`, {})

test('F17-AC27: Given two authors with public decks, When an operator suspends a handle with a reason, Then the verified identity is stored and listed and only that author becomes unreadable', async () => {
  expect((await share()).status).toBe(200)
  expect((await share('/@other/other-talk')).status).toBe(200)
  const before = Math.floor(Date.now() / 1000)
  const response = await post('/suspensions', {
    target: '@owner',
    reason: 'fake sign-in page',
    operator: 'forged@example.com',
  })
  expect(response.status).toBe(303)
  expect(response.headers.get('Location')).toBe('/?result=suspended')
  const suspension = await readSuspension(database, OWNER_ID)
  if (!suspension) throw new Error('Missing suspension')
  expect(suspension).toMatchObject({
    reason: 'fake sign-in page',
    operator: 'op@example.com',
  })
  expect(suspension.suspendedAt).toBeGreaterThanOrEqual(before)
  expect(suspension.suspendedAt).toBeLessThanOrEqual(
    Math.floor(Date.now() / 1000),
  )
  expect((await share()).status).toBe(404)
  expect((await share('/@other/other-talk')).status).toBe(200)

  const page = await (await open('/?result=suspended')).text()
  expect(page).toContain('アカウントを停止しました。')
  expect(page).toContain('停止中のアカウント（1 件）')
  expect(page).toMatch(/<td>\s*@owner\s*<\/td>/)
  expect(page).toContain('fake sign-in page')
  expect(page).toContain(new Date(suspension.suspendedAt * 1000).toISOString())
  expect(page).toContain('op@example.com')
  expect(page).not.toContain('forged@example.com')
  expect(page).toContain(`action="/suspensions/${OWNER_ID}/release"`)
  expect(page.indexOf('アカウントを停止する')).toBeGreaterThan(
    page.indexOf('非表示にしているスライド'),
  )
})

const invalidForms: [string, Record<string, string>, string][] = [
  ['an unknown handle', { target: '@missing', reason: 'r' }, 'not_found'],
  ['an empty reason', { target: '@owner', reason: '' }, 'invalid_reason'],
  [
    'a whitespace reason',
    { target: '@owner', reason: ' \n ' },
    'invalid_reason',
  ],
  [
    'a long reason',
    { target: '@owner', reason: 'r'.repeat(TAKEDOWN_REASON_MAX + 1) },
    'invalid_reason',
  ],
  [
    'a deck URL',
    { target: `${TEST_ORIGIN}/@owner/talk`, reason: 'r' },
    'invalid_target',
  ],
  ['no fields', {}, 'invalid_target'],
  ['no reason', { target: '@owner' }, 'invalid_reason'],
]
test.each(invalidForms)(
  'F17-AC27: Given %s, When a suspension is posted, Then nothing is stored and the result explains why',
  async (_, fields, result) => {
    const response = await post('/suspensions', fields)
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe(`/?result=${result}`)
    expect(await db.select().from(suspensions)).toEqual([])
  },
)

test.each([
  ['no Access token', { token: false }, 404],
  ['a wrong Origin', { origin: 'https://evil.example' }, 403],
  ['no Origin', { origin: null }, 403],
] as const)(
  'F17-AC27: Given %s, When suspension and release are posted, Then access is denied and nothing changes',
  async (_, options, status) => {
    const denied = await post(
      '/suspensions',
      { target: '@owner', reason: 'r' },
      options,
    )
    expect(denied.status).toBe(status)
    expect(await db.select().from(suspensions)).toEqual([])
    await suspend()
    const before = await readSuspension(database, OWNER_ID)
    const deniedRelease = await post(
      `/suspensions/${OWNER_ID}/release`,
      {},
      options,
    )
    expect(deniedRelease.status).toBe(status)
    expect(await readSuspension(database, OWNER_ID)).toEqual(before)
  },
)

test('F17-AC27: Given a suspension by an earlier operator, When another operator suspends the account again, Then the first reason, time and operator remain', async () => {
  await applySuspensionCommand(database, {
    userId: OWNER_ID,
    command: {
      kind: 'suspend',
      reason: 'first',
      operator: 'first@example.com',
    },
    now: 100,
  })
  const response = await post(
    '/suspensions',
    { target: '@owner', reason: 'second' },
    { email: 'second@example.com' },
  )
  expect(response.headers.get('Location')).toBe('/?result=unchanged')
  expect(await readSuspension(database, OWNER_ID)).toEqual({
    suspendedAt: 100,
    reason: 'first',
    operator: 'first@example.com',
  })
})

test('F17-AC27: Given a suspended account that was deleted and a reason containing HTML, When the operator opens the list, Then its GitHub ID remains and the reason is escaped', async () => {
  await suspend('@owner', '<script>alert(1)</script>')
  await db.delete(accounts).where(eq(accounts.user_id, OWNER_ID))
  const page = await (await open()).text()
  expect(page).toContain('停止中のアカウント（1 件）')
  expect(page).toContain(`退会済み（GitHub ID: ${OWNER_ID}）`)
  expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  expect(page).not.toContain('<script>alert(1)</script>')
  expect(await listSuspendedAccounts(database)).toMatchObject([
    { userId: OWNER_ID, handle: null },
  ])
})

test('F17-AC28: Given a suspended author with a public deck and an individually hidden deck, When the suspension is released, Then the public deck is readable with unchanged publication and the hidden deck stays hidden', async () => {
  await seedPublic(database, 'hidden-talk', 100, 'Hidden talk')
  await applyOperatorCommand(database, {
    deckId: 'hidden-talk',
    command: {
      kind: 'hide',
      reason: 'individual reason',
      operator: 'op@example.com',
    },
    now: 100,
  })
  const before = await readPublication(database, 'talk', OWNER_ID)
  const hiddenBefore = await readPublication(database, 'hidden-talk', OWNER_ID)
  const takedownBefore = await readTakedown(database, 'hidden-talk')
  await suspend()
  expect((await share()).status).toBe(404)
  const response = await release()
  expect(response.status).toBe(303)
  expect(response.headers.get('Location')).toBe('/?result=suspension_released')
  expect(await readSuspension(database, OWNER_ID)).toBeNull()
  expect((await share()).status).toBe(200)
  expect((await share('/@owner/hidden-talk')).status).toBe(404)
  expect(await readPublication(database, 'talk', OWNER_ID)).toEqual(before)
  expect(await readPublication(database, 'hidden-talk', OWNER_ID)).toEqual(
    hiddenBefore,
  )
  expect(await readTakedown(database, 'hidden-talk')).toEqual(takedownBefore)
  const page = await (await open('/?result=suspension_released')).text()
  expect(page).toContain('アカウントの停止を解除しました。')
  expect(page).toContain('停止中のアカウント（0 件）')
  expect(page).toContain('停止中のアカウントはありません。')
})

test.each([
  ['999999', 'unchanged'],
  [INVITED_ID, 'unchanged'],
  ['not-a-user', 'not_found'],
  ['0', 'not_found'],
  ['01', 'not_found'],
  ['-1', 'not_found'],
  ['1.5', 'not_found'],
])(
  'F17-AC28: Given an unknown, unsuspended or invalid user %s, When release is posted, Then nothing changes',
  async (userId, result) => {
    await suspend()
    const before = await db.select().from(suspensions)
    const response = await release(userId)
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe(`/?result=${result}`)
    expect(await db.select().from(suspensions)).toEqual(before)
  },
)

test('F17-AC28: Given a suspended account that was deleted, When its GitHub ID is released, Then its suspension is removed', async () => {
  await suspend()
  await db.delete(accounts).where(eq(accounts.user_id, OWNER_ID))
  expect((await release()).headers.get('Location')).toBe(
    '/?result=suspension_released',
  )
  expect(await readSuspension(database, OWNER_ID)).toBeNull()
})

test('F17-AC27: Given two operators suspending concurrently, When both commands finish, Then exactly one complete suspension is stored', async () => {
  const first = {
    reason: 'first',
    operator: 'first@example.com',
    suspendedAt: 100,
  }
  const second = {
    reason: 'second',
    operator: 'second@example.com',
    suspendedAt: 200,
  }
  const results = await Promise.all(
    [first, second].map((record) =>
      applySuspensionCommand(database, {
        userId: OWNER_ID,
        command: {
          kind: 'suspend',
          reason: record.reason,
          operator: record.operator,
        },
        now: record.suspendedAt,
      }),
    ),
  )
  expect(results.map((result) => result.kind).sort()).toEqual([
    'applied',
    'unchanged',
  ])
  expect([first, second]).toContainEqual(
    await readSuspension(database, OWNER_ID),
  )
  expect(await db.select().from(suspensions)).toHaveLength(1)
})

test('F17-AC27: Given an invalid operator identity, When suspension storage receives the command, Then it refuses the command without storing a row', async () => {
  expect(
    await applySuspensionCommand(database, {
      userId: OWNER_ID,
      command: { kind: 'suspend', reason: 'reason', operator: '' },
      now: 100,
    }),
  ).toEqual({ kind: 'invalid_operator' })
  expect(await db.select().from(suspensions)).toEqual([])
})

test('F17-AC27: Given more than fifty suspended accounts, When the operator list is read, Then only the fifty newest appear in descending suspension order', async () => {
  for (let index = 0; index < 51; index++)
    await db.insert(suspensions).values({
      user_id: String(1000 + index),
      reason: `reason ${index}`,
      suspended_at: index,
      suspended_by: 'op@example.com',
    })
  const rows = await listSuspendedAccounts(database)
  expect(rows.map((row) => row.userId)).toEqual(
    Array.from({ length: 50 }, (_, index) => String(1050 - index)),
  )
  const page = await (await open()).text()
  expect(page).toContain('停止中のアカウント（50 件）')
  expect(page).not.toContain('GitHub ID: 1000）')
})
