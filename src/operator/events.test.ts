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
const eventPage = async (lang = 'ja') =>
  (
    await (
      await server.fetch(
        // The page of the event (F45-AC9), which reads no `?lang=`.
        new Request(`${TEST_ORIGIN}/link/connpass.com/event/410635`, {
          headers: { 'Accept-Language': lang },
        }),
        env,
      )
    ).text()
  ).replace(/\s+/g, ' ')

test('F29-AC15: Given the operator page, When it opens, Then it has the form to rename an event', async () => {
  const response = await server.fetch(
    new Request(`${OPERATOR_ORIGIN}/`, {
      headers: { [ACCESS_TOKEN_HEADER]: await team.sign() },
    }),
    env,
  )
  const body = (await response.text()).replace(/\s+/g, ' ')
  expect(body).toContain('<h2>イベント名を直す</h2>')
  expect(body).toContain('action="/events/rename"')
})

test.each([
  () => String(eventId),
  () => `/events/${eventId}`,
  () => `${TEST_ORIGIN}/events/${eventId}`,
])(
  'F29-AC15: Given the operator names an event by %s, When they rename it, Then the new name is on its page and who renamed it is kept',
  async (target) => {
    const response = await post({
      target: target(),
      name: '  Kanagawa.pm #3 (2026)  ',
    })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/?result=event_renamed')
    expect(await stored()).toMatchObject({
      name: 'Kanagawa.pm #3 (2026)',
      named_by: 'op@example.com',
      named_at: expect.any(Number),
    })
    expect(await eventPage()).toContain('<h1>Kanagawa.pm #3 (2026)</h1>')
  },
)

test('F29-AC15: Given a renamed event, When a link with another title is added, Then the operator’s name stays', async () => {
  await post({ target: String(eventId), name: 'Renamed' })
  await seedPublic(database, 'more', 200, 'More')
  await addLink(database, {
    deckId: 'more',
    ownerUserId: OWNER_ID,
    link: {
      kind: 'event',
      url: URL1,
      title: 'Another',
      event: eventRefOf(URL1)!,
    },
    now: 2,
  })
  expect((await stored())?.name).toBe('Renamed')
})

test.each([
  [{ target: 'https://other.example/events/1', name: 'X' }, 'invalid_event'],
  [{ target: '@owner/talk', name: 'X' }, 'invalid_event'],
  [{ target: '0', name: 'X' }, 'invalid_event'],
  [{ target: '999999', name: 'X' }, 'event_not_found'],
  [{ target: '1', name: '' }, 'invalid_event_name'],
  [{ target: '1', name: '   ' }, 'invalid_event_name'],
  [{ target: '1', name: 'a​b\nc' }, 'invalid_event_name'],
  [{ target: '1', name: 'x'.repeat(101) }, 'invalid_event_name'],
] as const)(
  'F29-AC15: Given %o, When the operator sends it, Then it is refused as %s and the name stays',
  async (fields, result) => {
    const response = await post({
      ...fields,
      target: fields.target === '1' ? String(eventId) : fields.target,
    })
    expect(response.headers.get('location')).toBe(`/?result=${result}`)
    expect((await stored())?.name).toBe('Kanagawa.pm #3')
  },
)

test('F29-AC15: Given no Access token, or a request from another origin, When an event is renamed, Then it is refused and the name stays', async () => {
  expect(
    (await post({ target: String(eventId), name: 'X' }, { token: false }))
      .status,
  ).toBe(404)
  expect(
    (
      await post(
        { target: String(eventId), name: 'X' },
        { origin: 'https://evil.example' },
      )
    ).status,
  ).toBe(403)
  expect((await stored())?.name).toBe('Kanagawa.pm #3')
})

test('F29-AC15: Given a signed-in author on the public origin, When they post the operator form there, Then no rename happens', async () => {
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
  expect((await stored())?.name).toBe('Kanagawa.pm #3')
})
