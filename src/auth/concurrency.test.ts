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
import { count } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { authAccount, authSession, authUser } from '../db/auth-schema'
import { accounts } from '../db/schema'
import server from '../../server'
import { applyMigrations } from '../db/test-migrations'
import { markAccountDeleted } from '../decks/deletion'
import {
  resetTables,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = testEnv(platform.env)

beforeAll(() => applyMigrations(db))
beforeEach(() => resetTables(db))
afterEach(() => vi.unstubAllGlobals())
afterAll(() => platform.dispose())

function observeQueries(
  database: D1Database,
  hooks: {
    before?: (sql: string) => Promise<void>
    after?: (sql: string) => Promise<void>
  },
): D1Database {
  function observe(
    sql: string,
    statement: D1PreparedStatement,
  ): D1PreparedStatement {
    return new Proxy(statement, {
      get(target, key) {
        if (key === 'bind')
          return (...values: unknown[]) => observe(sql, target.bind(...values))
        const value = Reflect.get(target, key)
        if (typeof value !== 'function') return value
        return async (...args: unknown[]) => {
          await hooks.before?.(sql)
          const result = await value.apply(target, args)
          await hooks.after?.(sql)
          return result
        }
      },
    })
  }
  return new Proxy(database, {
    get(target, key) {
      if (key === 'prepare')
        return (sql: string) => observe(sql, target.prepare(sql))
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

const cookie = (response: Response, name: string) =>
  response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${name}=`))
    ?.split(';')[0] ?? ''
const ownerStatus = async (session: string) =>
  (
    await server.fetch(
      new Request(`${TEST_ORIGIN}/auth/owner`, {
        headers: { Cookie: session },
      }),
      env,
    )
  ).status
async function begin() {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/auth/github`),
    env,
  )
  return {
    state: new URL(response.headers.get('location')!).searchParams.get(
      'state',
    )!,
    cookie: cookie(response, '__Host-slide_oauth'),
  }
}
const complete = (start: Awaited<ReturnType<typeof begin>>, target: Env) =>
  server.fetch(
    new Request(
      `${TEST_ORIGIN}/auth/github/callback?code=c&state=${start.state}`,
      { headers: { Cookie: start.cookie } },
    ),
    target,
  )
function stubGitHub() {
  vi.stubGlobal('fetch', async (input: RequestInfo) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.endsWith('/access_token'))
      return Response.json({ access_token: 'gho_x' })
    if (url.endsWith('/user'))
      return Response.json({ id: 722500, login: 'owner' })
    if (url.endsWith('/user/emails')) return Response.json([])
    return new Response(null, { status: 204 })
  })
}

test.each(['A then B', 'B then A'])(
  'Given an existing owner and concurrent logins %s, When both sessions are inserted before either callback finishes, Then exactly the latest session survives',
  async (order) => {
    const old = await signIn(env)
    const a = await begin()
    const b = await begin()
    const firstInserted = Promise.withResolvers<void>()
    const bothInserted = Promise.withResolvers<void>()
    let insertions = 0
    const target = {
      ...env,
      DB: observeQueries(db, {
        after: async (sql) => {
          if (!/^insert into "auth_session"/i.test(sql)) return
          if (++insertions === 1) firstInserted.resolve()
          if (insertions === 2) bothInserted.resolve()
          await bothInserted.promise
        },
      }),
    }
    stubGitHub()
    const starts = order === 'A then B' ? [a, b] : [b, a]
    const first = complete(starts[0]!, target)
    await firstInserted.promise
    const second = complete(starts[1]!, target)
    const responses = await Promise.all([first, second])
    const statuses = await Promise.all(
      responses.map((response) =>
        ownerStatus(cookie(response, '__Host-slide_owner')),
      ),
    )
    expect(statuses).toEqual([401, 200])
    expect(await ownerStatus(old)).toBe(401)
    expect((await orm.select({ n: count() }).from(authSession).get())?.n).toBe(
      1,
    )
  },
)

test('Given a login paused before handle creation, When account deletion completes before that write, Then neither the handle nor a usable session is recreated', async () => {
  await signIn(env)
  const beforeHandle = Promise.withResolvers<void>()
  const deleted = Promise.withResolvers<void>()
  const target = {
    ...env,
    DB: observeQueries(db, {
      before: async (sql) => {
        if (!/^insert into "accounts"/i.test(sql)) return
        beforeHandle.resolve()
        await deleted.promise
      },
    }),
  }
  const pending = signIn(target)
  await beforeHandle.promise
  await markAccountDeleted(db, {
    ownerUserId: '722500',
    now: Math.floor(Date.now() / 1000),
  })
  deleted.resolve()
  const session = await pending
  expect(
    await orm
      .select({ user_id: accounts.user_id, handle: accounts.handle })
      .from(accounts),
  ).toEqual([])
  expect(await ownerStatus(session)).toBe(401)
  for (const table of [authUser, authAccount, authSession])
    expect((await orm.select({ n: count() }).from(table).get())?.n).toBe(0)
})
