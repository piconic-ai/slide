import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { authUser } from '../db/auth-schema'
import { EMAIL_CRYPTO_OFF } from '../db/email-cipher'
import { accounts, decks, invitedEmails } from '../db/schema'
import { markAccountDeleted } from '../decks/deletion-store'
import { applyMigrations } from '../db/test-migrations'
import { readOutbox } from '../mail/outbox-store'
import {
  emailOf,
  invite,
  lastCode,
  resetTables,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { listInvites } from './invites-store'
import { OPEN_SIGNUP_INVITER } from './signup-mode'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const base = testEnv(platform.env)
const closed = base
const open = { ...base, OPEN_SIGNUP: 'on' } as Env

beforeAll(() => applyMigrations(db))
beforeEach(() => resetTables(db), 30_000)
afterAll(() => platform.dispose())

const send = (
  path: string,
  init: { fields?: Record<string, string>; cookie?: string } = {},
  target: Env = closed,
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
const ask = (email: string, target: Env = closed) =>
  send('/login', { fields: { email } }, target)
const enter = (email: string, code: string, target: Env = closed) =>
  send('/login/code', { fields: { email, code } }, target)
const cookieOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .find((value) => value.startsWith('__Host-slide_owner='))
    ?.split(';')[0] ?? ''

/** Asks for a code and enters it; the cookie is empty when it did not sign in. */
async function signInAs(email: string, target: Env) {
  await (await ask(email, target)).text()
  const code = await lastCode(db, email)
  const entered = await enter(email, code, target)
  return { cookie: cookieOf(entered), entered }
}

const register = (cookie: string, handle: string, target: Env) =>
  send(
    '/welcome',
    { fields: { handle, name: handle, terms: 'on' }, cookie },
    target,
  )

test.each([undefined, '', 'off', 'ON', 'true', '1'])(
  'F42-AC1: Given OPEN_SIGNUP is %j, When an address that was not invited asks for a code, Then nothing is mailed, no user is made and the page is the same as for an invited address',
  async (setting) => {
    const target = { ...base, OPEN_SIGNUP: setting } as unknown as Env
    await invite(db, 'in@mail.example')
    const invited = await ask('in@mail.example', target)
    const stranger = await ask('out@mail.example', target)
    expect(stranger.status).toBe(invited.status)
    expect((await stranger.text()).replaceAll('out@', 'in@')).toBe(
      await invited.text(),
    )
    expect(await readOutbox(db, 'out@mail.example')).toEqual([])
    expect(await readOutbox(db, 'in@mail.example')).toHaveLength(1)
    expect(await orm.$count(authUser)).toBe(0)
    const guess = await enter('out@mail.example', '123456', target)
    expect(cookieOf(guess)).toBe('')
  },
)

test('F42-AC1: Given invite-only, When an uninvited address enters the code of an address that was mailed, Then it is not signed in', async () => {
  await invite(db, 'in@mail.example')
  await (await ask('in@mail.example')).text()
  const code = await lastCode(db, 'in@mail.example')
  const stranger = await enter('out@mail.example', code)
  expect(cookieOf(stranger)).toBe('')
  expect(await orm.$count(authUser)).toBe(0)
})

test('F42-AC2: Given sign-up is open, When an address that was never invited asks for a code, Then a 6-digit code is mailed to it', async () => {
  const response = await ask('new@mail.example', open)
  expect(response.status).toBe(200)
  expect(await response.text()).toContain('name="code"')
  expect(await readOutbox(db, 'new@mail.example')).toHaveLength(1)
  expect(await lastCode(db, 'new@mail.example')).toMatch(/^\d{6}$/)
})

test('F42-AC3: Given sign-up is open, When a first-time person enters the code, Then they are asked to agree to the terms and choose a handle, and no account exists before they do', async () => {
  const { cookie, entered } = await signInAs('new@mail.example', open)
  expect(entered.headers.get('location')).toBe('/welcome')
  expect(await orm.$count(accounts)).toBe(0)
  const page = await (await send('/welcome', { cookie }, open)).text()
  expect(page).toContain('href="/terms"')
  expect(page).toContain('href="/privacy"')
  // Without the agreement nothing is made.
  const refused = await send(
    '/welcome',
    { fields: { handle: 'newbie', name: 'Newbie' }, cookie },
    open,
  )
  expect(refused.status).toBe(400)
  expect(await orm.$count(accounts)).toBe(0)
  const done = await register(cookie, 'newbie', open)
  expect(done.status).toBe(303)
  expect(await orm.$count(accounts)).toBe(1)
  expect((await send('/slides', { cookie }, open)).status).toBe(200)
})

test('F42-AC3: Given sign-up is open, When a first-time person signs up, Then they join the invitation list under the service name, and the operator does not see that row among the invitations', async () => {
  await invite(db, 'op@mail.example')
  await signInAs('new@mail.example', open)
  const rows = await orm.select().from(invitedEmails)
  expect(rows.map((row) => [row.email, row.invited_by]).sort()).toEqual([
    ['new@mail.example', OPEN_SIGNUP_INVITER],
    ['op@mail.example', 'test@operator.example'],
  ])
  const listed = await listInvites(db, EMAIL_CRYPTO_OFF)
  expect(listed.map((one) => one.email)).toEqual(['op@mail.example'])
})

test('F42-AC4: Given someone signed up while sign-up was open, When the setting is taken away, Then they sign in again and use the service as before, and a stranger is not mailed', async () => {
  const email = emailOf('early')
  const first = await signInAs(email, open)
  await register(first.cookie, 'early', open)
  // Back to invite-only: the session they have still works…
  expect((await send('/slides', { cookie: first.cookie }, closed)).status).toBe(
    200,
  )
  // …and so does signing in again.
  const second = await signInAs(email, closed)
  expect(second.cookie).not.toBe('')
  expect(
    (await send('/slides', { cookie: second.cookie }, closed)).status,
  ).toBe(200)
  await (await ask('stranger@mail.example', closed)).text()
  expect(await readOutbox(db, 'stranger@mail.example')).toEqual([])
})

test('F42-AC4: Given someone signed in while sign-up was open and has no account yet, When the setting is taken away, Then they are not turned away at once and can finish signing up', async () => {
  const { cookie } = await signInAs('half@mail.example', open)
  const done = await register(cookie, 'half', closed)
  expect(done.status).toBe(303)
  expect(await orm.$count(accounts)).toBe(1)
})

test('F42-AC4: Given an invitation the service made while sign-up was open, When the operator invites the same address, Then the row becomes the operator’s and is listed', async () => {
  await signInAs('both@mail.example', open)
  await invite(db, 'both@mail.example')
  const row = await orm.select().from(invitedEmails).get()
  expect(row?.invited_by).toBe('test@operator.example')
  expect(
    (await listInvites(db, EMAIL_CRYPTO_OFF)).map((one) => one.email),
  ).toEqual(['both@mail.example'])
})

test('F42-AC3: Given a person who left before signing up, When sign-up is open, Then the row the service made for their address is gone, and the operator’s own invitation of another address stays', async () => {
  await invite(db, 'op@mail.example')
  const { cookie } = await signInAs('gone@mail.example', open)
  expect(await orm.$count(invitedEmails)).toBe(2)
  await send('/welcome/leave', { fields: {}, cookie }, open)
  const rows = await orm.select().from(invitedEmails)
  expect(rows.map((row) => row.email)).toEqual(['op@mail.example'])
  expect(await orm.$count(authUser)).toBe(0)
})

test('F42-AC3: Given an operator invitation and sign-up open, When that person leaves before signing up, Then the operator’s invitation stays', async () => {
  await invite(db, 'op@mail.example')
  const { cookie } = await signInAs('op@mail.example', open)
  await send('/welcome/leave', { fields: {}, cookie }, open)
  expect(await orm.$count(invitedEmails)).toBe(1)
})

test('F42-AC3: Given someone who signed up while sign-up was open, When they delete their account, Then the row the service made for their address goes with it', async () => {
  const email = emailOf('leaver')
  const { cookie } = await signInAs(email, open)
  await register(cookie, 'leaver', open)
  const user = await orm.select().from(authUser).get()
  await markAccountDeleted(db, { ownerUserId: user!.id, now: 100 })
  expect(await orm.$count(invitedEmails)).toBe(0)
  expect(await orm.$count(authUser)).toBe(0)
})

test('F42-AC3: Given an operator-invited person, When they delete their account, Then the invitation stays', async () => {
  const email = emailOf('member')
  await invite(db, email)
  const { cookie } = await signInAs(email, closed)
  await register(cookie, 'member', closed)
  const user = await orm.select().from(authUser).get()
  await markAccountDeleted(db, { ownerUserId: user!.id, now: 100 })
  expect(await orm.$count(invitedEmails)).toBe(1)
})

test.each([
  ['ja', '招待', 'メールアドレスに 6 桁のコード'],
  ['en', 'invit', '6-digit code'],
])(
  'F42-AC5: Given the %s login page, When it is opened, Then it speaks of an invitation only while sign-up is invite-only',
  async (lang, word, always) => {
    const closedPage = await (await send(`/login?lang=${lang}`)).text()
    const openPage = await (await send(`/login?lang=${lang}`, {}, open)).text()
    expect(closedPage.toLowerCase()).toContain(word)
    expect(closedPage).toContain(always)
    expect(openPage.toLowerCase()).not.toContain(word)
    expect(openPage).toContain(always)
  },
)

test.each(['ja', 'en'])(
  'F42-AC5: Given sign-up is open, When a login is asked for, a wrong code is entered and the welcome page opens in %s, Then none of those pages speaks of an invitation',
  async (lang) => {
    const asked = await send(
      `/login?lang=${lang}`,
      { fields: { email: 'x@mail.example' } },
      open,
    )
    const wrong = await send(
      `/login/code?lang=${lang}`,
      { fields: { email: 'x@mail.example', code: '000000' } },
      open,
    )
    const invalid = await send(
      `/login?lang=${lang}`,
      { fields: { email: 'not-an-address' } },
      open,
    )
    const { cookie } = await signInAs('y@mail.example', open)
    const welcome = await send(`/welcome?lang=${lang}`, { cookie }, open)
    for (const response of [asked, wrong, invalid, welcome])
      expect((await response.text()).toLowerCase()).not.toMatch(/招待|invit/)
  },
)

test('F42-AC4: Given an open sign-up whose invitation row was taken away by the operator, When the person signs in again while sign-up is open, Then they are let in and the row is made again', async () => {
  const email = emailOf('back')
  const first = await signInAs(email, open)
  await register(first.cookie, 'back', open)
  await orm.delete(invitedEmails).where(eq(invitedEmails.email, email))
  const again = await signInAs(email, open)
  expect(again.cookie).not.toBe('')
  expect(await orm.$count(invitedEmails)).toBe(1)
})

const startUpload = (cookie: string, target: Env) =>
  send2('/api/slides/mine/uploads', cookie, target)
const send2 = (path: string, cookie: string, target: Env) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        attempt: 'open-signup-attempt',
        entry: 'index.html',
        files: [{ path: 'index.html', size: 1, sha256: 'a'.repeat(64) }],
      }),
    }),
    target,
  )

test.each([
  ['invite-only', 'invitation_only'],
  ['open', 'not_registered'],
])(
  'F42-AC5: Given someone taken off the invitations who still holds a session, When sign-up is %s and they start an upload, Then they are refused with the code %s, and only the invite-only answer speaks of an invitation',
  async (mode, code) => {
    const target = mode === 'open' ? open : closed
    const email = emailOf('removed')
    await invite(db, email)
    const first = await signInAs(email, closed)
    await register(first.cookie, 'removed', closed)
    const user = await orm.select().from(authUser).get()
    await orm.insert(decks).values({
      id: 'mine',
      slug: 'mine',
      owner_user_id: user!.id,
      created_at: 1,
    })
    await orm.delete(invitedEmails).where(eq(invitedEmails.email, email))
    const response = await startUpload(first.cookie, target)
    expect(response.status).toBe(403)
    const body = await response.text()
    expect(JSON.parse(body)).toMatchObject({ code })
    expect(/招待|invit/i.test(body)).toBe(code === 'invitation_only')
  },
)
