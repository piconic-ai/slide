import { createHash } from 'node:crypto'
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
import { applyMigrations } from '../db/test-migrations'
import { gravatarHash } from '../profile/gravatar'
import {
  emailOf,
  invite,
  lastCode,
  OWNER_ID,
  resetTables,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

// What an address leaves behind where it must not: a hash of it without a key
// in what the service keeps (F43-AC10), and the address itself in what the
// service says about a sign-in (F43-AC8). An address is short enough to be
// found again from an unkeyed hash, so such a hash is as good as the address.

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = testEnv(platform.env)

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  const kept = await platform.env.UPLOADS.list()
  await platform.env.UPLOADS.delete(kept.objects.map(({ key }) => key))
}, 30_000)
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
afterAll(() => platform.dispose())

const send = (
  path: string,
  init: { fields?: Record<string, string>; cookie?: string } = {},
) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      method: init.fields ? 'POST' : 'GET',
      headers: {
        Cookie: init.cookie ?? '',
        ...(init.fields
          ? {
              Origin: TEST_ORIGIN,
              'Content-Type': 'application/x-www-form-urlencoded',
            }
          : {}),
      },
      body: init.fields ? new URLSearchParams(init.fields) : undefined,
    }),
    env,
  )

/** The unkeyed hashes someone could keep of an address, in lowercase hex. */
const hashesOf = (email: string) =>
  [email, email.toUpperCase()].flatMap((form) =>
    ['md5', 'sha1', 'sha256'].map((algorithm) =>
      createHash(algorithm).update(form).digest('hex'),
    ),
  )

/** Every text in every table of D1, lowercased. */
async function everyText() {
  const tables = await orm.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'`,
  )
  const found: string[] = []
  for (const { name } of tables)
    for (const row of await orm.all<Record<string, unknown>>(
      sql.raw(`SELECT * FROM "${name}"`),
    ))
      for (const [column, value] of Object.entries(row))
        if (typeof value === 'string') found.push(`${name}.${column}=${value}`)
  return found.join('\n').toLowerCase()
}

/** Every key, every piece of metadata and every body in R2, lowercased. */
async function everyObject() {
  const listed = await platform.env.UPLOADS.list({
    include: ['customMetadata', 'httpMetadata'],
  })
  const found: string[] = []
  for (const object of listed.objects) {
    const body = await platform.env.UPLOADS.get(object.key)
    found.push(
      object.key,
      JSON.stringify(object.customMetadata ?? {}),
      JSON.stringify(object.httpMetadata ?? {}),
      new TextDecoder('latin1').decode(await body!.arrayBuffer()),
    )
  }
  return {
    keys: listed.objects.map(({ key }) => key),
    text: found.join('\n').toLowerCase(),
  }
}

test.each([
  [
    'has a picture',
    () =>
      new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]), {
        headers: { 'Content-Type': 'image/png' },
      }),
    [`gravatar/${OWNER_ID}`],
  ],
  [
    'has none',
    () => new Response('', { status: 404 }),
    [`gravatar/${OWNER_ID}`],
  ],
  ['does not answer', () => new Response('x', { status: 503 }), []],
] as const)(
  'F43-AC10: Given a person with Gravatar on and a Gravatar that %s, When their face is asked for, Then Gravatar is asked by the hash of their address, and neither D1 nor R2 keeps an unkeyed hash of it',
  async (_label, answer, kept) => {
    const email = emailOf('hana')
    expect(await signIn(env, 'hana', { name: 'Hana' })).not.toBe('')
    const asked: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(String(url))
      return answer()
    })

    await (await send(`/avatars/${OWNER_ID}`)).arrayBuffer()

    const hash = await gravatarHash(email)
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain(hash)
    const objects = await everyObject()
    // What Gravatar answered is kept under the person's id, never the hash.
    expect(objects.keys).toEqual(kept)
    for (const text of [await everyText(), objects.text])
      for (const unkeyed of [...hashesOf(email), hash.toLowerCase()])
        expect(text.includes(unkeyed), `${unkeyed.slice(0, 8)}… is kept`).toBe(
          false,
        )
  },
)

test('F43-AC8: Given sign-ins, refused sign-ins, wrong codes and bad input, When everything the service wrote to its logs and every error answer is read, Then no address and no unkeyed hash of one is in it', async () => {
  const logged: string[] = []
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const)
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(
        args
          .map((arg) => (arg instanceof Error ? `${arg.stack}` : String(arg)))
          .join(' '),
      )
    })
  const bodies: string[] = []
  // A page that echoes what the person typed (the login form) is theirs to
  // read; what must stay clean is what the service says about a failure: its
  // logs, the errors it throws and the body of an error answer.
  const keep = async (run: () => Response | Promise<Response>) => {
    try {
      const response = await run()
      const text = await response.text()
      if (response.status >= 500 && response.status !== 503) bodies.push(text)
      return response
    } catch (error) {
      bodies.push(`${error instanceof Error ? error.stack : error}`)
      return null
    }
  }
  const member = emailOf('ivy')
  const stranger = emailOf('nobody')
  await invite(db, member)

  // A first sign-in all the way to an account, in another spelling.
  await keep(() =>
    send('/login', { fields: { email: ` ${member.toUpperCase()} ` } }),
  )
  const code = await lastCode(db, member)
  const entered = await keep(() =>
    send('/login/code', { fields: { email: member, code } }),
  )
  const cookie =
    entered?.headers
      .getSetCookie()
      .find((value) => value.startsWith('__Host-slide_owner='))
      ?.split(';')[0] ?? ''
  expect(cookie).not.toBe('')
  await keep(() =>
    send('/welcome', {
      fields: { handle: 'ivy', name: 'Ivy', terms: 'on' },
      cookie,
    }),
  )
  await keep(() => send('/settings', { cookie }))
  // Refused: an address nobody invited, a wrong code, a code never asked for.
  await keep(() => send('/login', { fields: { email: stranger } }))
  await keep(() =>
    send('/login/code', { fields: { email: stranger, code: '000000' } }),
  )
  await keep(() => send('/login', { fields: { email: member } }))
  await keep(() =>
    send('/login/code', { fields: { email: member, code: '000000' } }),
  )
  // Bad input: not an address, an address too long, a field sent twice over.
  await keep(() => send('/login', { fields: { email: 'ivy@' } }))
  await keep(() =>
    send('/login', { fields: { email: `${'a'.repeat(300)}@mail.example` } }),
  )
  await keep(() => send('/login/code', { fields: { email: member } }))
  await keep(() => send('/welcome/leave', { fields: {}, cookie }))

  const everything = [...logged, ...bodies].join('\n').toLowerCase()
  const marks = [
    member,
    stranger,
    'ivy@',
    'nobody@',
    ...hashesOf(member),
    ...hashesOf(stranger),
    await gravatarHash(member),
  ]
  for (const mark of marks)
    expect(
      everything.includes(mark.toLowerCase()),
      `a ${mark.slice(0, 6)}… value shows`,
    ).toBe(false)
})
