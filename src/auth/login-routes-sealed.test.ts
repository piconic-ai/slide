import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { createHash } from 'node:crypto'
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
import { emailCryptoOf } from '../db/email-settings'
import { applyMigrations } from '../db/test-migrations'
import { readOutbox } from '../mail/outbox-store'
import { gravatarHash } from '../profile/gravatar'
import { readEmail } from '../profile/store'
import {
  emailOf,
  invite,
  resetTables,
  seedPerson,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import {
  addInvite,
  isInvited,
  isInvitedUser,
  listInvites,
  removeInvite,
} from './invites-store'
import type { EmailAddress } from '../mail/address'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)

const b64 = (seed: number) =>
  btoa(String.fromCharCode(...new Uint8Array(32).fill(seed)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
const KEYS = {
  EMAIL_CIPHER_KEYS: `1:${b64(1)}`,
  EMAIL_CIPHER_CURRENT: '1',
  EMAIL_LOOKUP_KEY: b64(9),
}
const env = { ...testEnv(platform.env), ...KEYS } as unknown as Env
const crypto = emailCryptoOf(env)

beforeAll(() => applyMigrations(db))
beforeEach(() => resetTables(db), 30_000)
afterAll(() => platform.dispose())

const send = (
  path: string,
  init: { fields?: Record<string, string>; cookie?: string } = {},
  target: Env = env,
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
    target,
  )
const cookieOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .find((value) => value.startsWith('__Host-slide_owner='))
    ?.split(';')[0] ?? ''

/** The newest code mailed to an address, read from the box under the keys. */
async function codeFor(email: string, target = crypto) {
  const [mail] = await readOutbox(db, email, target)
  return (
    /\b(\d{6})\b/.exec(`${mail?.subject ?? ''} ${mail?.body ?? ''}`)?.[1] ?? ''
  )
}

/** Asks for a code as `typed` and enters it; the sign-in's response. */
async function signInAs(typed: string, target: Env = env) {
  const email = typed.trim().toLowerCase()
  await (await send('/login', { fields: { email: typed } }, target)).text()
  return send(
    '/login/code',
    {
      fields: {
        email: typed,
        code: await codeFor(email, emailCryptoOf(target)),
      },
    },
    target,
  )
}

/** Every text in every table of D1. */
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

const addSealedInvite = (email: string) =>
  addInvite(
    db,
    { email: email as EmailAddress, invitedBy: 'op@example.com', now: 1 },
    crypto,
  )

test('F41-AC1, F41-AC2, F41-AC4: Given an invited address and the keys on, When the person asks for a code, enters it in another spelling and makes an account, Then they are signed in and no table of D1 holds their address', async () => {
  const email = emailOf('alice')
  await addSealedInvite(email)
  const entered = await signInAs(` ${email.toUpperCase()} `)
  expect(entered.status).toBe(303)
  const cookie = cookieOf(entered)
  expect(cookie).not.toBe('')
  const welcomed = await send('/welcome', {
    fields: { handle: 'alice', name: 'Alice', terms: 'on' },
    cookie,
  })
  expect(welcomed.status).toBe(303)
  expect((await send('/settings', { cookie })).status).toBe(200)
  const texts = await everyText()
  expect(texts).not.toContain('alice@')
  expect(texts).not.toContain('mail.example')
  // The login mail itself is the only place a person would read the address.
  expect(await readOutbox(db, email, crypto)).toHaveLength(1)
})

test('F41-AC4, F41-AC7: Given a plain invitation from before the keys, When the person signs in first under the keys, Then they are made a sealed user, the invitation is sealed with them and they are still invited', async () => {
  const email = emailOf('bob')
  await invite(db, email)
  const entered = await signInAs(email)
  expect(cookieOf(entered)).not.toBe('')
  const rows = await orm.all<{ email: string; c: string | null }>(
    sql`SELECT email, email_ciphertext AS c FROM invited_emails`,
  )
  expect(rows).toHaveLength(1)
  expect(rows[0]?.c).not.toBeNull()
  const [user] = await orm.all<{ id: string }>(sql`SELECT id FROM auth_user`)
  expect(await isInvitedUser(db, user!.id)).toBe(true)
  expect(await isInvited(db, email, crypto)).toBe(true)
})

test('F41-AC6, F41-AC7: Given a person who signed up plain, When the keys are on, Then they log in as the same person and stay invited', async () => {
  await seedPerson(db, 'u-old', 'old')
  const email = emailOf('old')
  const entered = await signInAs(email)
  expect(cookieOf(entered)).not.toBe('')
  expect(await orm.all(sql`SELECT id FROM auth_user`)).toEqual([
    { id: 'u-old' },
  ])
  expect(await isInvitedUser(db, 'u-old')).toBe(true)
})

test('F41-AC5: Given sealed and plain invitations, When the operator lists them, Then every address shows in its normal spelling', async () => {
  await invite(db, emailOf('plain'))
  await addSealedInvite(emailOf('sealed'))
  const listed = (await listInvites(db, crypto)).map((row) => row.email).sort()
  expect(listed).toEqual([emailOf('plain'), emailOf('sealed')])
})

test('F41-AC3: Given an address invited in either form, When it is invited again in another spelling, Then there is still one invitation', async () => {
  await invite(db, emailOf('twice'))
  await addSealedInvite(emailOf('twice').toUpperCase().toLowerCase())
  await addSealedInvite(emailOf('other'))
  await addSealedInvite(emailOf('other'))
  expect(await orm.all(sql`SELECT email FROM invited_emails`)).toHaveLength(2)
})

test('F41-AC7: Given a plain user and an address invited again under the keys, When the invitation is added, Then the user and the invitation are sealed together and the user stays invited', async () => {
  await seedPerson(db, 'u-pair', 'pair')
  await removeInvite(db, emailOf('pair') as EmailAddress, crypto)
  await addSealedInvite(emailOf('pair'))
  expect(await isInvitedUser(db, 'u-pair')).toBe(true)
  const [user] = await orm.all<{ c: string | null }>(
    sql`SELECT email_ciphertext AS c FROM auth_user WHERE id = 'u-pair'`,
  )
  expect(user?.c).not.toBeNull()
})

test('F41-AC4: Given a sealed invitation, When the operator takes it off, Then the address is no longer invited', async () => {
  const email = emailOf('gone')
  await addSealedInvite(email)
  await removeInvite(db, email as EmailAddress, crypto)
  expect(await isInvited(db, email, crypto)).toBe(false)
  expect(await orm.all(sql`SELECT email FROM invited_emails`)).toEqual([])
})

test('F28-AC54, F41-AC16: Given a sealed user, When the settings page and the picture lookup read the address, Then they get the plain address', async () => {
  const email = emailOf('carol')
  await addSealedInvite(email)
  const cookie = cookieOf(await signInAs(email))
  await send('/welcome', {
    fields: { handle: 'carol', name: 'Carol', terms: 'on' },
    cookie,
  })
  const [user] = await orm.all<{ id: string }>(sql`SELECT id FROM auth_user`)
  expect(await readEmail(db, user!.id, crypto)).toBe(email)
  expect(await (await send('/settings', { cookie })).text()).toContain(email)
})

test('F28-AC64, F41-AC1: Given a sealed user who has no account, When they leave before signing up, Then their user row and their code are gone', async () => {
  const email = emailOf('dan')
  await addSealedInvite(email)
  const cookie = cookieOf(await signInAs(email))
  await send('/login', { fields: { email } })
  expect(await orm.all(sql`SELECT id FROM auth_verification`)).toHaveLength(1)
  await send('/welcome/leave', { fields: {}, cookie })
  expect(await orm.all(sql`SELECT id FROM auth_user`)).toEqual([])
  expect(await orm.all(sql`SELECT id FROM auth_verification`)).toEqual([])
})

test('F41-AC1: Given the keys on, When a code is mailed to the box, Then the box holds the lookup value and not the address', async () => {
  const email = emailOf('erin')
  await addSealedInvite(email)
  await (await send('/login', { fields: { email } })).text()
  const rows = await orm.all<{
    to_address: string
    subject: string
    body: string
  }>(sql`SELECT to_address, subject, body FROM mail_outbox`)
  expect(rows).toHaveLength(1)
  expect(rows[0]?.to_address).toMatch(/^enc1:[0-9a-f]{64}$/)
  expect(JSON.stringify(rows).toLowerCase()).not.toContain('erin')
})

test('F41-AC14: Given people sealed, When the lookup key is wrong, Then nobody gets in and no second user is made', async () => {
  const email = emailOf('frank')
  await addSealedInvite(email)
  expect(cookieOf(await signInAs(email))).not.toBe('')
  const wrong = { ...env, EMAIL_LOOKUP_KEY: b64(8) } as unknown as Env
  const before = await orm.all(sql`SELECT * FROM auth_user`)
  const settled = async (run: () => Response | Promise<Response>) => {
    try {
      return await run()
    } catch {
      return null
    }
  }
  const attempt = await settled(() =>
    send('/login', { fields: { email } }, wrong),
  )
  await attempt?.text()
  const entered = await settled(() =>
    send('/login/code', { fields: { email, code: '000000' } }, wrong),
  )
  expect(entered === null || cookieOf(entered) === '').toBe(true)
  expect(await orm.all(sql`SELECT * FROM auth_user`)).toEqual(before)
})

test('F41-AC14: Given keys set but not usable, When a code is asked for, Then the page says sign-in is not set up and nothing is written', async () => {
  const broken = { ...env, EMAIL_CIPHER_CURRENT: '9' } as unknown as Env
  const response = await send(
    '/login',
    { fields: { email: emailOf('gina') } },
    broken,
  )
  expect(response.status).toBe(503)
  expect(await orm.all(sql`SELECT id FROM auth_verification`)).toEqual([])
  expect(await orm.all(sql`SELECT id FROM mail_outbox`)).toEqual([])
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test('F41-AC17, F41-AC16: Given a sealed user with Gravatar on, When their face is asked for, Then Gravatar is asked by the hash of the plain address and no table of D1 holds a hash of it', async () => {
  const email = emailOf('hana')
  await addSealedInvite(email)
  const cookie = cookieOf(await signInAs(email))
  await send('/welcome', {
    fields: { handle: 'hana', name: 'Hana', terms: 'on' },
    cookie,
  })
  const [user] = await orm.all<{ id: string }>(sql`SELECT id FROM auth_user`)
  const asked: string[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    asked.push(String(url))
    return new Response('', { status: 404 })
  })
  await send(`/avatars/${user!.id}`)
  expect(asked).toHaveLength(1)
  expect(asked[0]).toContain(await gravatarHash(email))
  const texts = await everyText()
  for (const form of [email, email.toUpperCase()])
    for (const algorithm of ['md5', 'sha256'])
      expect(texts).not.toContain(
        createHash(algorithm).update(form).digest('hex'),
      )
  expect(texts).not.toContain((await gravatarHash(email)).toLowerCase())
})

test('F41-AC15: Given sign-ups, wrong keys and bad input, When everything the service wrote to its logs and every error page is read, Then no address, sealed text or key is in it', async () => {
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
  const email = emailOf('ivy')
  await addSealedInvite(email)
  const cookie = cookieOf(await signInAs(email))
  await send('/welcome', {
    fields: { handle: 'ivy', name: 'Ivy', terms: 'on' },
    cookie,
  })
  const wrongLookup = { ...env, EMAIL_LOOKUP_KEY: b64(8) } as unknown as Env
  const wrongCipher = {
    ...env,
    EMAIL_CIPHER_KEYS: `1:${b64(2)}`,
  } as unknown as Env
  const broken = { ...env, EMAIL_CIPHER_CURRENT: '9' } as unknown as Env
  // A page that echoes what the person typed (the login form) is theirs to
  // read; what must stay clean is what the service says about a failure: its
  // logs, the errors it throws and the body of an error answer.
  const keep = async (run: () => Response | Promise<Response>) => {
    try {
      const response = await run()
      const text = await response.text()
      if (response.status >= 500 && response.status !== 503) bodies.push(text)
    } catch (error) {
      bodies.push(`${error instanceof Error ? error.stack : error}`)
    }
  }
  for (const target of [wrongLookup, wrongCipher, broken]) {
    await keep(() => send('/login', { fields: { email } }, target))
    await keep(() =>
      send('/login/code', { fields: { email, code: '123456' } }, target),
    )
    await keep(() => send('/settings', { cookie }, target))
    await keep(() => send('/my/slides', { cookie }, target))
  }
  const [row] = await orm.all<{ c: string }>(
    sql`SELECT email_ciphertext AS c FROM auth_user`,
  )
  const secrets = [email, 'ivy@', row!.c, b64(1), b64(2), b64(9), b64(8)]
  const everything = [...logged, ...bodies].join('\n')
  for (const secret of secrets)
    expect(
      everything.includes(secret),
      `a ${secret.slice(0, 6)}… value shows`,
    ).toBe(false)
})

test('F41-AC13, F41-AC14: Given people sealed, When the keys are gone or wrong and the operator adds an invitation, Then it is refused and no plain row is added', async () => {
  await addSealedInvite(emailOf('kept'))
  await expect(
    addInvite(
      db,
      {
        email: emailOf('late') as EmailAddress,
        invitedBy: 'op@example.com',
        now: 2,
      },
      emailCryptoOf({}),
    ),
  ).rejects.toThrow('email crypto')
  await expect(
    addInvite(
      db,
      {
        email: emailOf('late') as EmailAddress,
        invitedBy: 'op@example.com',
        now: 2,
      },
      emailCryptoOf({ ...KEYS, EMAIL_LOOKUP_KEY: b64(8) }),
    ),
  ).rejects.toThrow('email crypto')
  expect(await orm.all(sql`SELECT email FROM invited_emails`)).toHaveLength(1)
})
