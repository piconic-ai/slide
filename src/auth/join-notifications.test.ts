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
import server from '../../server'
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

async function register(
  userId: string,
  handle: string,
  login = handle,
  createdAt = 1,
) {
  await orm.batch([
    orm
      .insert(accounts)
      .values({ user_id: userId, handle, created_at: createdAt }),
    orm
      .insert(profiles)
      .values({ user_id: userId, login, synced_at: createdAt }),
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
const response = (status: number) => new Response(null, { status })
const bobSignsIn = (
  following: (req: Request) => Response | Promise<Response>,
  login = 'bob',
) => signIn(env, login, { id: bobId, following })

test('F20-AC4: Given Alice follows Bob and Carol does not, When Bob first signs in, Then only Alice receives one notice naming Bob', async () => {
  await register(aliceId, 'old-alice', 'AliceNow')
  await register('37', 'carol')
  const following = vi.fn((req: Request) =>
    response(req.url.endsWith('/AliceNow/following/bob') ? 204 : 404),
  )

  expect(await bobSignsIn(following)).toMatch(/^__Host-slide_owner=.+/)

  expect(
    following.mock.calls
      .map(([req]) => [req.method, req.url, req.headers.get('Authorization')])
      .sort(),
  ).toEqual([
    [
      'GET',
      'https://api.github.com/users/AliceNow/following/bob',
      `Bearer gho_${bobId}`,
    ],
    [
      'GET',
      'https://api.github.com/users/carol/following/bob',
      `Bearer gho_${bobId}`,
    ],
  ])
  expect(await notices()).toEqual([aliceNotice])

  following.mockClear()
  expect(await bobSignsIn(following)).toMatch(/^__Host-slide_owner=.+/)
  expect(following).not.toHaveBeenCalled()
  expect(await notices()).toEqual([aliceNotice])
})

test('Given a login without a slide handle, When Bob signs in and later gains a handle, Then only the latter sign-in checks follows and announces him', async () => {
  await register(aliceId, 'alice')
  const following = vi.fn(() => response(204))

  expect(await bobSignsIn(following, 'not a handle')).toMatch(
    /^__Host-slide_owner=.+/,
  )
  expect(following).not.toHaveBeenCalled()
  expect(await notices()).toEqual([])

  expect(await bobSignsIn(following)).toMatch(/^__Host-slide_owner=.+/)
  expect(following).toHaveBeenCalledOnce()
  expect(await notices()).toEqual([aliceNotice])
})

test('F20-AC8: Given Alice muted Bob by ID, When Bob first signs in, Then Alice receives no join notice', async () => {
  await register(aliceId, 'alice')
  await orm
    .insert(mutes)
    .values({ muter_user_id: aliceId, muted_user_id: bobId, created_at: 1 })

  expect(await bobSignsIn(() => response(204))).toMatch(
    /^__Host-slide_owner=.+/,
  )
  expect(await notices()).toEqual([])
})

test('F20-AC7: Given Alice opted out of join notices, When Bob first signs in, Then Alice receives no join notice', async () => {
  await register(aliceId, 'alice')
  await orm
    .insert(notificationOptOuts)
    .values({ user_id: aliceId, kind: joined })

  expect(await bobSignsIn(() => response(204))).toMatch(
    /^__Host-slide_owner=.+/,
  )
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

test.each([
  ['returns 500', 'Error', () => response(500)],
  [
    'throws',
    'TypeError',
    () => {
      throw new TypeError('GitHub unavailable')
    },
  ],
  ['times out', 'TimeoutError', awaitAbort],
] as const)(
  'Given GitHub %s, When Bob first signs in, Then the failure is logged, his session works and no notice is stored',
  async (_scenario, name, answer) => {
    await register(aliceId, 'alice')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const session = await bobSignsIn(answer)
    const owner = await server.fetch(
      new Request(`${TEST_ORIGIN}/auth/owner`, {
        headers: { Cookie: session },
      }),
      env,
    )

    expect(await owner.json()).toEqual({ userId: bobId, login: 'bob' })
    expect(await notices()).toEqual([])
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({ event: 'join_notifications_unrecorded', name }),
    )
  },
  10000,
)

test('Given D1 refuses the notification insert, When Bob first signs in, Then he keeps his session and the failure is logged', async () => {
  await register(aliceId, 'alice')
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  await orm.run(sql`CREATE TRIGGER fail_join BEFORE INSERT ON notifications
    WHEN NEW.kind = 'github_followee_joined'
    BEGIN SELECT RAISE(ABORT, 'join insert failed'); END`)
  try {
    const session = await bobSignsIn(() => response(204))
    expect(session).toMatch(/^__Host-slide_owner=.+/)
    expect(await notices()).toEqual([])
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('"event":"join_notifications_unrecorded"'),
    )
  } finally {
    await orm.run(sql`DROP TRIGGER fail_join`)
  }
})

test('Given two pending lookups, When GitHub fails one and confirms the other, Then the confirmed follower receives the notice', async () => {
  await register(aliceId, 'alice')
  await register('37', 'carol')
  vi.spyOn(console, 'error').mockImplementation(() => {})

  const bothStarted = Promise.withResolvers<void>()
  let started = 0
  await bobSignsIn(async (req) => {
    if (++started === 2) bothStarted.resolve()
    await bothStarted.promise
    if (req.url.endsWith('/carol/following/bob')) throw new Error('offline')
    return response(204)
  })

  expect(await notices()).toEqual([aliceNotice])
})

test.each([
  ['uninvited', 'uninvited', '901'],
  ['holding another person’s handle', 'alice', bobId],
])(
  'Given a person is %s, When sign-in is refused, Then no following request is made',
  async (_name, login, id) => {
    await register(aliceId, 'alice')
    const following = vi.fn(() => response(204))

    expect(await signIn(env, login, { id, following })).toBe('')
    expect(following).not.toHaveBeenCalled()
    expect(await notices()).toEqual([])
  },
)

test('Given more than 50 registered people including a suspended person, When Bob joins, Then only the oldest 50 eligible people are checked', async () => {
  await register(aliceId, 'suspended', 'suspended', 0)
  await orm.insert(suspensions).values({
    user_id: aliceId,
    reason: 'abuse',
    suspended_at: 1,
    suspended_by: 'operator',
  })
  await orm
    .insert(accounts)
    .values({ user_id: '901', handle: 'no-profile', created_at: 0 })
  const people = Array.from({ length: 51 }, (_, i) => ({
    id: String(100 + i),
    login: `user-${i}`,
    createdAt: i + 1,
  }))
  for (const { id, login, createdAt } of people.toReversed())
    await register(id, login, login, createdAt)
  const following = vi.fn((_req: Request) => response(404))

  expect(await bobSignsIn(following)).toMatch(/^__Host-slide_owner=.+/)

  expect(following.mock.calls.map(([req]) => req.url).sort()).toEqual(
    people
      .slice(0, 50)
      .map(({ login }) => `https://api.github.com/users/${login}/following/bob`)
      .sort(),
  )
})

test('Given Alice was notified before Bob left, When Bob signs in again, Then Alice gets exactly one fresh join notice', async () => {
  await register(aliceId, 'alice')
  const following = vi.fn(() => response(204))
  const session = await bobSignsIn(following)
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

  following.mockClear()
  expect(await bobSignsIn(following)).toMatch(/^__Host-slide_owner=.+/)
  expect(following).toHaveBeenCalledOnce()
  expect(await notices()).toEqual([aliceNotice])
})
