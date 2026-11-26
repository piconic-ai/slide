import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { createAuth } from '../auth/auth-store'
import { resetTables, TEST_ORIGIN, testEnv } from '../publication/test-support'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const orm = drizzle(database)
const base = testEnv(platform.env)

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
const on = { ...base, ...KEYS } as Env
const off = base

beforeAll(() => applyMigrations(database))
beforeEach(() => resetTables(database), 30_000)
afterAll(() => platform.dispose())

/** Asks for a code as `typed` and signs in with it; the cookie and user. */
async function signUp(env: Env, typed: string) {
  let sent = { to: '', code: '' }
  const auth = createAuth(env, {
    onCode: async (to, code) => {
      sent = { to, code }
    },
  })!
  await auth.api.sendVerificationOTP({
    body: { email: typed, type: 'sign-in' },
  })
  const response = await auth.api.signInEmailOTP({
    body: { email: typed, otp: sent.code },
    asResponse: true,
  })
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
  const body = (await response.json()) as {
    user: { id: string; email: string }
  }
  return { auth, sent, cookie, user: body.user }
}

/** Every text in every table of D1, with where it is. */
async function everyText() {
  const tables = await orm.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'`,
  )
  const found: string[] = []
  for (const { name } of tables) {
    const rows = await orm.all<Record<string, unknown>>(
      sql.raw(`SELECT * FROM "${name}"`),
    )
    for (const row of rows)
      for (const [column, value] of Object.entries(row))
        if (typeof value === 'string') found.push(`${name}.${column}=${value}`)
  }
  return found
}

test('D-82, F41-AC1, F41-AC16: Given the keys are on, When a person signs up through Better Auth, Then Better Auth works with the address and D1 holds it nowhere', async () => {
  const { user, sent } = await signUp(on, 'Alice@Mail.example')
  expect(user.email).toBe('alice@mail.example')
  expect(sent.to).toBe('alice@mail.example')
  const texts = (await everyText()).join('\n').toLowerCase()
  expect(texts).not.toContain('alice')
  expect(texts).not.toContain('mail.example')
  const [row] = await orm.all<{ email: string; c: string }>(
    sql`SELECT email, email_ciphertext AS c FROM auth_user`,
  )
  expect(row?.email).toMatch(/^enc1:[0-9a-f]{64}$/)
  expect(row?.c).toMatch(/^ec1\.1\./)
})

test('D-82, F41-AC2: Given a person signed up sealed, When they sign in again in other spellings, Then it is the same user and the session shows the address', async () => {
  const first = await signUp(on, 'alice@mail.example')
  const again = await signUp(on, 'ALICE@mail.EXAMPLE')
  expect(again.user.id).toBe(first.user.id)
  const session = await again.auth.api.getSession({
    headers: new Headers({ cookie: again.cookie }),
  })
  expect(session?.user.email).toBe('alice@mail.example')
  expect(session?.user.id).toBe(first.user.id)
  expect(await orm.all(sql`SELECT id FROM auth_user`)).toHaveLength(1)
})

test('D-82, F41-AC3: Given a sealed user, When a second user is made for the same address in another spelling, Then it is refused and one user stays', async () => {
  const auth = createAuth(on)!
  const { internalAdapter } = await auth.$context
  const make = (email: string) =>
    internalAdapter.createUser(
      { email, emailVerified: true, name: '' },
      { method: 'email-otp' },
    )
  await make('dup@mail.example')
  await expect(make('DUP@mail.example')).rejects.toThrow()
  expect(await orm.all(sql`SELECT id FROM auth_user`)).toHaveLength(1)
})

test('D-82, F41-AC6: Given a person who signed up plain, When the keys are turned on and they sign in, Then they are the same user and their row is still plain', async () => {
  const plain = await signUp(off, 'bob@mail.example')
  const later = await signUp(on, 'bob@mail.example')
  expect(later.user.id).toBe(plain.user.id)
  const session = await later.auth.api.getSession({
    headers: new Headers({ cookie: later.cookie }),
  })
  expect(session?.user.email).toBe('bob@mail.example')
  expect(
    await orm.all(sql`SELECT email, email_ciphertext AS c FROM auth_user`),
  ).toEqual([{ email: 'bob@mail.example', c: null }])
})

test('F41-AC13: Given the keys are off, When a person signs up, Then the address is kept plain as before', async () => {
  await signUp(off, 'carol@mail.example')
  expect(
    await orm.all(sql`SELECT email, email_ciphertext AS c FROM auth_user`),
  ).toEqual([{ email: 'carol@mail.example', c: null }])
})

test('F41-AC14: Given people sealed under the right keys, When the lookup key is wrong, Then nobody is signed in and no second user is made', async () => {
  const alice = await signUp(on, 'alice@mail.example')
  const wrong = { ...on, EMAIL_LOOKUP_KEY: b64(8) } as Env
  await expect(signUp(wrong, 'alice@mail.example')).rejects.toThrow()
  expect(await orm.all(sql`SELECT id FROM auth_user`)).toEqual([
    { id: alice.user.id },
  ])
})

test('F41-AC14: Given people sealed, When the encryption key is wrong, Then signing in fails and their rows stay as they were', async () => {
  const alice = await signUp(on, 'alice@mail.example')
  const before = await orm.all(sql`SELECT * FROM auth_user`)
  const wrong = { ...on, EMAIL_CIPHER_KEYS: `1:${b64(2)}` } as Env
  await expect(signUp(wrong, 'alice@mail.example')).rejects.toThrow()
  const auth = createAuth(wrong)!
  await expect(
    auth.api.getSession({ headers: new Headers({ cookie: alice.cookie }) }),
  ).rejects.toThrow()
  expect(await orm.all(sql`SELECT * FROM auth_user`)).toEqual(before)
})

test('F41-AC13, F41-AC14: Given people sealed, When the keys are gone, Then no plain row is written beside them', async () => {
  await signUp(on, 'alice@mail.example')
  await expect(signUp(off, 'alice@mail.example')).rejects.toThrow()
  await expect(signUp(off, 'dave@mail.example')).rejects.toThrow()
  expect(await orm.all(sql`SELECT id FROM auth_user`)).toHaveLength(1)
})

test('F41-AC14: Given keys that are set but not usable, When Better Auth is made, Then there is none', () => {
  expect(createAuth({ ...on, EMAIL_CIPHER_CURRENT: '7' } as Env)).toBeNull()
  expect(createAuth({ ...base, EMAIL_LOOKUP_KEY: b64(9) } as Env)).toBeNull()
  expect(TEST_ORIGIN).toBeTruthy()
})

test('F41-AC1: Given a code waiting for an address, When D1 is read, Then the code row does not name the address', async () => {
  const auth = createAuth(on, { onCode: async () => {} })!
  await auth.api.sendVerificationOTP({
    body: { email: 'pending@mail.example', type: 'sign-in' },
  })
  const rows = await orm.all<{ identifier: string }>(
    sql`SELECT identifier FROM auth_verification`,
  )
  expect(rows).toHaveLength(1)
  expect((await everyText()).join('\n').toLowerCase()).not.toContain('pending')
})
