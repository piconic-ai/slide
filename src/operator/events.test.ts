import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { events } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { eventRefOf } from '../events/event-url'
import { addLink } from '../links/store'
import {
  OWNER_ID,
  resetTables,
  seedPublic,
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

const URL1 = 'https://kanagawapm.connpass.com/event/410635/'
let eventId = 0
beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetTables(database)
  await signIn(env)
  await seedPublic(database, 'talk', 100, 'Talk')
  const event = eventRefOf(URL1)!
  await addLink(database, {
    deckId: 'talk',
    ownerUserId: OWNER_ID,
    link: { kind: 'event', url: URL1, title: 'Kanagawa.pm #3', event },
    now: 1,
  })
  eventId = (await db.select().from(events).get())!.id
  // A name from the time names were kept.
  await db.update(events).set({ name: 'Kept' }).where(eq(events.id, eventId))
})
afterAll(() => platform.dispose())

async function post(
  fields: Record<string, string>,
  options: { token?: boolean; origin?: string } = {},
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Origin: options.origin ?? OPERATOR_ORIGIN,
  }
  if (options.token !== false) headers[ACCESS_TOKEN_HEADER] = await team.sign()
  return server.fetch(
    new Request(`${OPERATOR_ORIGIN}/events/rename`, {
      method: 'POST',
      headers,
      body: new URLSearchParams(fields),
    }),
    env,
  )
}
const stored = async () =>
  db.select().from(events).where(eq(events.id, eventId)).get()

test('F45-AC20: Given the operator page, When it opens, Then it has no form to rename an event', async () => {
  const response = await server.fetch(
    new Request(`${OPERATOR_ORIGIN}/`, {
      headers: { [ACCESS_TOKEN_HEADER]: await team.sign() },
    }),
    env,
  )
  expect(response.status).toBe(200)
  const body = await response.text()
  expect(body).not.toContain('イベント名')
  expect(body).not.toContain('/events/rename')
})

test('F45-AC20: Given the operator, with and without the Access token, When they post a new name for an event, Then there is no such way and the name stays', async () => {
  for (const token of [true, false]) {
    const response = await post(
      { target: String(eventId), name: 'Renamed' },
      { token },
    )
    expect(response.status).toBe(404)
  }
  expect((await stored())?.name).toBe('Kept')
})

test('F45-AC20: Given a signed-in author on the public origin, When they post a new name for an event there, Then there is no such way and the name stays', async () => {
  const cookie = await signIn(env, 'bob', { id: '2' })
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/events/rename`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ target: String(eventId), name: 'X' }),
    }),
    env,
  )
  expect(response.status).toBe(404)
  expect((await stored())?.name).toBe('Kept')
})
