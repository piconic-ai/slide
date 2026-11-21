import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { listInvites } from '../auth/invites-store'
import { authSession } from '../db/auth-schema'
import { invitedEmails } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { readOutbox } from '../mail/outbox-store'
import {
  emailOf,
  resetTables,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { ACCESS_TOKEN_HEADER } from './access'
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
beforeEach(() => resetTables(database))
afterAll(() => platform.dispose())

const open = async (path = '/') =>
  server.fetch(
    new Request(`${OPERATOR_ORIGIN}${path}`, {
      headers: { [ACCESS_TOKEN_HEADER]: await team.sign() },
    }),
    env,
  )

async function post(
  path: string,
  fields: Record<string, string>,
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
      body: new URLSearchParams(fields),
    }),
    env,
  )
}

test('F28-AC24: Given the operator, When they add an address, Then it is on the list in its normal spelling, with who invited it', async () => {
  const response = await post('/invites', {
    email: '  New.Person@Mail.Example ',
  })
  expect(response.status).toBe(303)
  expect(response.headers.get('location')).toBe('/?result=invited')
  expect(await listInvites(database)).toMatchObject([
    { email: 'new.person@mail.example', invitedBy: 'op@example.com' },
  ])
})

test('F28-AC24: Given an address already on the list, When the operator adds it again, Then the list keeps one row', async () => {
  await post('/invites', { email: 'a@mail.example' })
  await post('/invites', { email: 'A@mail.example' })
  expect(await db.$count(invitedEmails)).toBe(1)
})

test('F28-AC24: Given an added address, When its owner asks for a code, Then a code is mailed', async () => {
  await post('/invites', { email: 'new@mail.example' })
  const asked = await server.fetch(
    new Request(`${TEST_ORIGIN}/login`, {
      method: 'POST',
      headers: {
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ email: 'new@mail.example' }),
    }),
    env,
  )
  await asked.text()
  expect(await readOutbox(database, 'new@mail.example')).toHaveLength(1)
})

test.each(['', 'nobody', 'a b@mail.example'])(
  'F28-AC24: Given the text %j, When the operator adds it, Then it is refused and nothing is listed',
  async (email) => {
    const response = await post('/invites', { email })
    expect(response.headers.get('location')).toBe('/?result=invalid_email')
    expect(await db.$count(invitedEmails)).toBe(0)
  },
)

test('F28-AC25: Given invited addresses, When the operator opens the page, Then each is listed with a button to take it off', async () => {
  await post('/invites', { email: 'a@mail.example' })
  await post('/invites', { email: 'b@mail.example' })
  const page = await (await open()).text()
  expect(page).toContain('招待している人（2 件）')
  expect(page).toContain('a@mail.example')
  expect(page).toContain('b@mail.example')
  expect(page).toContain('action="/invites/remove"')
  expect(page).not.toContain('/invites/a@')
})

test('F28-AC25 F28-AC26: Given a signed-in person, When the operator takes their address off, Then the list drops it and their next request is refused', async () => {
  const cookie = await signIn(env, 'owner')
  const address = emailOf('owner')
  const check = () =>
    server.fetch(
      new Request(`${TEST_ORIGIN}/auth/owner`, { headers: { Cookie: cookie } }),
      env,
    )
  expect((await check()).status).toBe(200)
  const response = await post('/invites/remove', { email: address })
  expect(response.headers.get('location')).toBe('/?result=invite_removed')
  expect(await db.$count(invitedEmails)).toBe(0)
  expect((await check()).status).toBe(401)
  expect(await db.$count(authSession)).toBe(0)
})

test('Given a foreign Origin or no Access token, When an invitation is posted, Then nothing changes', async () => {
  expect(
    (
      await post(
        '/invites',
        { email: 'a@mail.example' },
        { origin: 'https://evil.example' },
      )
    ).status,
  ).toBe(403)
  expect(
    (await post('/invites', { email: 'a@mail.example' }, { origin: null }))
      .status,
  ).toBe(403)
  expect(
    (await post('/invites', { email: 'a@mail.example' }, { token: false }))
      .status,
  ).toBe(404)
  expect(await db.$count(invitedEmails)).toBe(0)
})

test('Given the management origin, When the operator routes are asked for, Then they are not there', async () => {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/invites`, {
      method: 'POST',
      headers: { Origin: TEST_ORIGIN },
    }),
    env,
  )
  expect(response.status).toBe(404)
})
