import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import {
  accounts,
  mutes,
  notificationOptOuts,
  notifications,
  profiles,
  suspensions,
} from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  resetTables,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const orm = drizzle(database)
const env = withInvited(testEnv(platform.env))
const aliceId = OWNER_ID
const bobId = INVITED_ID
const joined = 'github_followee_joined'

beforeAll(() => applyMigrations(database))
beforeEach(() => resetTables(database))
afterEach(() => vi.restoreAllMocks())
afterAll(() => platform.dispose())

async function register(userId: string, handle: string, login = handle) {
  await orm.batch([
    orm.insert(accounts).values({ user_id: userId, handle, created_at: 1 }),
    orm.insert(profiles).values({ user_id: userId, login, synced_at: 1 }),
  ])
}

const notices = () =>
  orm
    .select({
      recipient: notifications.recipient_user_id,
      kind: notifications.kind,
      actor: notifications.actor_user_id,
    })
    .from(notifications)

const aliceNotice = { recipient: aliceId, kind: joined, actor: bobId }
const followerPage = (ids: number[]) => Response.json(ids.map((id) => ({ id })))
const aliceFollows = () => followerPage([Number(aliceId)])
const pageOf = (req: Request) =>
  Number(new URL(req.url).searchParams.get('page'))
const idsFrom = (start: number, length: number) =>
  Array.from({ length }, (_, i) => start + i)
const bobSignsIn = (
  followers: (req: Request) => Response | Promise<Response>,
  login = 'bob',
) => signIn(env, login, { id: bobId, followers })

test('F20-AC4: Given Alice follows Bob and Carol does not, When Bob first signs in, Then only Alice receives one notice naming Bob', async () => {
  await register(aliceId, 'alice')
  await register('37', 'carol')
  const followers = vi.fn((_req: Request) =>
    followerPage([Number(aliceId), 888, Number(bobId)]),
  )

  expect(await bobSignsIn(followers, 'BobNow')).toMatch(
    /^__Host-slide_owner=.+/,
  )

  expect(followers).toHaveBeenCalledOnce()
  const [[req]] = followers.mock.calls
  expect(req.method).toBe('GET')
  expect(req.url).toBe(
    'https://api.github.com/users/BobNow/followers?per_page=100&page=1',
  )
  expect(req.headers.get('Authorization')).toBe(`Bearer gho_${bobId}`)
  expect(await notices()).toEqual([aliceNotice])

  followers.mockClear()
  expect(await bobSignsIn(followers)).toMatch(/^__Host-slide_owner=.+/)
  expect(followers).not.toHaveBeenCalled()
  expect(await notices()).toEqual([aliceNotice])
})

test('Given GitHub names have changed hands, When Bob joins, Then only the registered follower with the matching ID is notified', async () => {
  await register(aliceId, 'alice', 'alice-before-rename')
  await register('37', 'carol', 'login-alice-now-owns')

  await bobSignsIn(() =>
    Response.json([{ id: Number(aliceId), login: 'login-alice-now-owns' }]),
  )

  expect(await notices()).toEqual([aliceNotice])
})

test('Given a login without a slide handle, When Bob signs in and later gains a handle, Then only the latter sign-in checks follows and announces him', async () => {
  await register(aliceId, 'alice')
  const followers = vi.fn(aliceFollows)

  expect(await bobSignsIn(followers, 'not a handle')).toMatch(
    /^__Host-slide_owner=.+/,
  )
  expect(followers).not.toHaveBeenCalled()
  expect(await notices()).toEqual([])

  expect(await bobSignsIn(followers)).toMatch(/^__Host-slide_owner=.+/)
  expect(followers).toHaveBeenCalledOnce()
  expect(await notices()).toEqual([aliceNotice])
})

test('F20-AC8: Given Alice muted Bob by ID, When Bob first signs in, Then Alice receives no join notice', async () => {
  await register(aliceId, 'alice')
  await orm
    .insert(mutes)
    .values({ muter_user_id: aliceId, muted_user_id: bobId, created_at: 1 })

  expect(await bobSignsIn(aliceFollows)).toMatch(/^__Host-slide_owner=.+/)
  expect(await notices()).toEqual([])
})

test('F20-AC7: Given Alice opted out of join notices, When Bob first signs in, Then Alice receives no join notice', async () => {
  await register(aliceId, 'alice')
  await orm
    .insert(notificationOptOuts)
    .values({ user_id: aliceId, kind: joined })

  expect(await bobSignsIn(aliceFollows)).toMatch(/^__Host-slide_owner=.+/)
  expect(await notices()).toEqual([])
})

function awaitAbort(request: Request): Promise<Response> {
  return new Promise((_, reject) => {
    request.signal.throwIfAborted()
    request.signal.addEventListener(
      'abort',
      () => reject(request.signal.reason),
      { once: true },
    )
  })
}

const pageFailures = [
  ['HTTP 500', 'Error', () => new Response(null, { status: 500 })],
  [
    'a network error',
    'TypeError',
    () => {
      throw new TypeError('GitHub unavailable')
    },
  ],
  ['a timeout', 'TimeoutError', awaitAbort],
  ['malformed JSON', 'SyntaxError', () => new Response('[')],
  [
    'a nonnumeric ID',
    'ZodError',
    () => Response.json([{ id: Number(aliceId) }, { id: '37' }]),
  ],
] as const

for (const failedPage of [1, 2]) {
  test.each(pageFailures)(
    `Given %s on page ${failedPage}, When Bob joins, Then only completed pages are delivered, one failure is logged and his session works`,
    async (_scenario, name, fail) => {
      await register(aliceId, 'alice')
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      const followers = vi.fn((req: Request) =>
        pageOf(req) === failedPage
          ? fail(req)
          : followerPage([Number(aliceId), ...idsFrom(10000, 99)]),
      )
      const session = await bobSignsIn(followers)
      const owner = await server.fetch(
        new Request(`${TEST_ORIGIN}/auth/owner`, {
          headers: { Cookie: session },
        }),
        env,
      )

      expect(await owner.json()).toEqual({ userId: bobId, login: 'bob' })
      expect(followers.mock.calls.map(([req]) => pageOf(req))).toEqual(
        failedPage === 1 ? [1] : [1, 2],
      )
      expect(await notices()).toEqual(failedPage === 1 ? [] : [aliceNotice])
      expect(log.mock.calls).toEqual([
        [JSON.stringify({ event: 'join_notifications_unrecorded', name })],
      ])
    },
    10000,
  )
}

test('Given Bob has no followers, When he joins, Then the notification table is never needed', async () => {
  const followers = vi.fn(() => followerPage([]))
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  await orm.run(
    sql`ALTER TABLE notifications RENAME TO unavailable_notifications`,
  )
  try {
    expect(await bobSignsIn(followers)).toMatch(/^__Host-slide_owner=.+/)
    expect(followers).toHaveBeenCalledOnce()
    expect(log).not.toHaveBeenCalled()
  } finally {
    await orm.run(
      sql`ALTER TABLE unavailable_notifications RENAME TO notifications`,
    )
  }
})

test('Given D1 refuses the notification insert, When Bob first signs in, Then he keeps his session and the failure is logged', async () => {
  await register(aliceId, 'alice')
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  await orm.run(sql`CREATE TRIGGER fail_join BEFORE INSERT ON notifications
    WHEN NEW.kind = 'github_followee_joined'
    BEGIN SELECT RAISE(ABORT, 'join insert failed'); END`)
  try {
    const session = await bobSignsIn(aliceFollows)
    expect(session).toMatch(/^__Host-slide_owner=.+/)
    expect(await notices()).toEqual([])
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('"event":"join_notifications_unrecorded"'),
    )
  } finally {
    await orm.run(sql`DROP TRIGGER fail_join`)
  }
})

test('Given Alice is on the second page, When Bob joins, Then Alice receives a notice and the short page ends the lookup', async () => {
  await register(aliceId, 'alice')
  const followers = vi.fn((req: Request) =>
    pageOf(req) === 1 ? followerPage(idsFrom(10000, 100)) : aliceFollows(),
  )

  await bobSignsIn(followers)

  expect(followers.mock.calls.map(([req]) => pageOf(req))).toEqual([1, 2])
  expect(await notices()).toEqual([aliceNotice])
})

test('Given five full pages and a sixth page, When Bob joins, Then a follower on page five is notified and page six is never requested', async () => {
  await register(aliceId, 'alice')
  const followers = vi.fn((req: Request) => {
    const page = pageOf(req)
    const ids = idsFrom(10000 + page * 100, 100)
    if (page === 5) ids[99] = Number(aliceId)
    return followerPage(ids)
  })

  await bobSignsIn(followers)

  expect(followers.mock.calls.map(([req]) => pageOf(req))).toEqual([
    1, 2, 3, 4, 5,
  ])
  expect(await notices()).toEqual([aliceNotice])
})

test.each([
  ['uninvited', 'uninvited', '901'],
  ['holding another person’s handle', 'alice', bobId],
])(
  'Given a person is %s, When sign-in is refused, Then no followers request is made',
  async (_name, login, id) => {
    await register(aliceId, 'alice')
    const followers = vi.fn(aliceFollows)

    expect(await signIn(env, login, { id, followers })).toBe('')
    expect(followers).not.toHaveBeenCalled()
    expect(await notices()).toEqual([])
  },
)

test('Given Alice is a suspended follower, When Bob joins, Then Alice receives no join notice', async () => {
  await register(aliceId, 'alice')
  await orm.insert(suspensions).values({
    user_id: aliceId,
    reason: 'abuse',
    suspended_at: 1,
    suspended_by: 'operator',
  })

  await bobSignsIn(aliceFollows)

  expect(await notices()).toEqual([])
})

test('Given 150 registered followers, When Bob joins, Then all 150 receive one notice each', async () => {
  const ids = idsFrom(10000, 150)
  await database.batch(
    ids.map((id) =>
      database
        .prepare(
          'INSERT INTO accounts (user_id, handle, created_at) VALUES (?, ?, 1)',
        )
        .bind(String(id), `user-${id}`),
    ),
  )
  const followers = vi.fn((req: Request) =>
    pageOf(req) === 1
      ? followerPage(ids.slice(0, 100))
      : followerPage(ids.slice(100)),
  )

  await bobSignsIn(followers)

  expect(followers.mock.calls.map(([req]) => pageOf(req))).toEqual([1, 2])
  expect((await notices()).map((n) => n.recipient).sort()).toEqual(
    ids.map(String),
  )
})

test('Given Alice was notified before Bob left, When Bob signs in again, Then Alice gets exactly one fresh join notice', async () => {
  await register(aliceId, 'alice')
  const followers = vi.fn(aliceFollows)
  const session = await bobSignsIn(followers)
  expect(await notices()).toEqual([aliceNotice])
  const deletion = await server.fetch(
    new Request(`${TEST_ORIGIN}/account/delete`, {
      method: 'POST',
      headers: {
        Cookie: session,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ confirm: 'bob' }),
    }),
    env,
  )
  expect(deletion.status).toBe(303)
  expect(await notices()).toEqual([])

  followers.mockClear()
  expect(await bobSignsIn(followers)).toMatch(/^__Host-slide_owner=.+/)
  expect(followers).toHaveBeenCalledOnce()
  expect(await notices()).toEqual([aliceNotice])
})
