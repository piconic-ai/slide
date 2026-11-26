import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { authUser, authVerification } from '../db/auth-schema'
import { emailCryptoOf } from '../db/email-settings'
import { accounts, loginCodeRequests, signupPauseEvents } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import type { EmailAddress } from '../mail/address'
import { readOutbox } from '../mail/outbox-store'
import {
  emailOf,
  invite,
  lastCode,
  OWNER_ID,
  resetTables,
  seedPerson,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { addInvite } from './invites-store'
import { isRegistered } from './registered-store'
import { setSignupPause } from './signup-pause-store'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const closed = testEnv(platform.env)
const open = { ...closed, OPEN_SIGNUP: 'on' } as Env

const b64 = (seed: number) =>
  btoa(String.fromCharCode(...new Uint8Array(32).fill(seed)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
const sealed = {
  ...closed,
  EMAIL_CIPHER_KEYS: `1:${b64(1)}`,
  EMAIL_CIPHER_CURRENT: '1',
  EMAIL_LOOKUP_KEY: b64(9),
} as unknown as Env

beforeAll(() => applyMigrations(db))
beforeEach(() => resetTables(db), 30_000)
afterAll(() => platform.dispose())

const pause = () =>
  setSignupPause(db, { paused: true, by: 'op@example.com', now: 100 })
const resume = () =>
  setSignupPause(db, { paused: false, by: 'op@example.com', now: 200 })

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

/** A person who has registered: a user and an account, invited. */
async function registered(login: string, id: string) {
  await seedPerson(db, id, login)
  await orm
    .insert(accounts)
    .values({ user_id: id, handle: login, created_at: 1 })
  return emailOf(login)
}

const NOTICE = '新しい登録を一時的に止めています'

test('F42-AC12: Given new sign-ups are stopped and sign-up is invite-only, When an address that is not registered asks for a code, Then nothing is mailed, whether or not it was invited', async () => {
  await pause()
  await invite(db, emailOf('invitee'))
  await (await ask(emailOf('invitee'))).text()
  await (await ask(emailOf('stranger'))).text()
  expect(await readOutbox(db, emailOf('invitee'))).toEqual([])
  expect(await readOutbox(db, emailOf('stranger'))).toEqual([])
})

test('F42-AC12: Given new sign-ups are stopped and sign-up is open, When a new address asks for a code, Then nothing is mailed and no user is made', async () => {
  await pause()
  await (await ask(emailOf('newcomer'), open)).text()
  expect(await readOutbox(db, emailOf('newcomer'))).toEqual([])
  const guess = await enter(emailOf('newcomer'), '123456', open)
  expect(cookieOf(guess)).toBe('')
  expect(await orm.$count(authUser)).toBe(0)
})

test.each(['invite-only', 'open'])(
  'F42-AC13: Given new sign-ups are stopped and sign-up is %s, When a registered person asks for a code and enters it, Then it is mailed and they sign in',
  async (mode) => {
    const target = mode === 'open' ? open : closed
    const email = await registered('member', 'm1')
    await pause()
    await (await ask(email, target)).text()
    expect(await readOutbox(db, email)).toHaveLength(1)
    const entered = await enter(email, await lastCode(db, email), target)
    expect(entered.status).toBe(303)
    expect(cookieOf(entered)).not.toBe('')
  },
)

test('F42-AC13: Given new sign-ups are stopped, When a person who is signed in uses the service, Then nothing changes for them', async () => {
  const cookie = await signIn(closed, 'owner')
  await pause()
  expect((await send('/my/slides', { cookie })).status).toBe(200)
})

test.each([
  ['invite-only', 'invitation'],
  ['open', 'open'],
])(
  'F42-AC14: Given new sign-ups are stopped and sign-up is %s, When a registered person, an invited person who has not registered, and two addresses nobody knows ask for a code, Then the status, the headers and the page are the same, and each says new sign-ups are stopped',
  async (_label, mode) => {
    const target = mode === 'open' ? open : closed
    const member = await registered('member', 'm1')
    await invite(db, emailOf('invitee'))
    await pause()
    const answers: {
      status: number
      headers: [string, string][]
      body: string
    }[] = []
    for (const typed of [
      member,
      emailOf('invitee'),
      emailOf('stranger'),
      emailOf('Other'),
    ]) {
      const response = await ask(typed, target)
      const body = await response.text()
      answers.push({
        status: response.status,
        headers: [...response.headers].sort(),
        body: body
          .replaceAll(typed.toLowerCase(), 'ADDRESS')
          .replaceAll(typed, 'ADDRESS'),
      })
    }
    expect(answers[0]!.status).toBe(200)
    expect(answers[0]!.body).toContain(NOTICE)
    for (const answer of answers.slice(1)) expect(answer).toEqual(answers[0])
    // The footprint is the same too: one code row and one request row each.
    expect(await orm.$count(authVerification)).toBe(4)
    expect(await orm.$count(loginCodeRequests)).toBe(4)
  },
)

test('F42-AC14: Given new sign-ups are stopped, When the login page is opened, Then everyone is told so, in both languages, and when they are not stopped it is not said', async () => {
  const before = await (await send('/login')).text()
  expect(before).not.toContain(NOTICE)
  await pause()
  const ja = await (await send('/login?lang=ja')).text()
  expect(ja).toContain(NOTICE)
  expect(ja).toContain('登録済みの方は、これまでどおりログインできます')
  const en = await (await send('/login?lang=en')).text()
  expect(en).toContain('New sign-ups are paused for now')
  await resume()
  expect(await (await send('/login')).text()).not.toContain(NOTICE)
})

test('F42-AC14: Given new sign-ups are stopped, When a wrong code is entered for a registered person and for an address nobody knows, Then the pages are the same and say new sign-ups are stopped', async () => {
  const member = await registered('member', 'm1')
  await pause()
  await (await ask(member)).text()
  await (await ask(emailOf('stranger'))).text()
  const wrong = async (email: string) => {
    const response = await enter(email, '000000')
    return {
      status: response.status,
      body: (await response.text()).replaceAll(email, 'ADDRESS'),
    }
  }
  const a = await wrong(member)
  const b = await wrong(emailOf('stranger'))
  expect(a).toEqual(b)
  expect(a.body).toContain(NOTICE)
})

test('F42-AC14: Given the keys are on and new sign-ups are stopped, When registered and unregistered addresses ask, Then the answers are the same and only the registered one is mailed', async () => {
  const member = emailOf('member')
  const crypto = emailCryptoOf(sealed)
  await addInvite(
    db,
    { email: member as EmailAddress, invitedBy: 'op@example.com', now: 1 },
    crypto,
  )
  // Sign the person up through the service so that the rows are sealed.
  await (await ask(member, sealed)).text()
  const [mail] = await readOutbox(db, member, crypto)
  const code = /\b(\d{6})\b/.exec(`${mail?.subject} ${mail?.body}`)![1]!
  const first = await enter(member, code, sealed)
  const cookie = cookieOf(first)
  await send(
    '/welcome',
    { fields: { handle: 'member', name: 'Member', terms: 'on' }, cookie },
    sealed,
  )
  expect(await isRegistered(db, member, crypto)).toBe(true)
  await pause()
  const a = await ask(member, sealed)
  const b = await ask(emailOf('stranger'), sealed)
  expect(a.status).toBe(b.status)
  expect((await a.text()).replaceAll(member, 'X')).toBe(
    (await b.text()).replaceAll(emailOf('stranger'), 'X'),
  )
  expect(await readOutbox(db, member, crypto)).toHaveLength(2)
  expect(await readOutbox(db, emailOf('stranger'), crypto)).toEqual([])
})

test('F42-AC15: Given new sign-ups were stopped, When the operator resumes, Then a new address in an open service gets a code and can sign up', async () => {
  await pause()
  await (await ask(emailOf('newcomer'), open)).text()
  expect(await readOutbox(db, emailOf('newcomer'))).toEqual([])
  await resume()
  await (await ask(emailOf('newcomer'), open)).text()
  expect(await readOutbox(db, emailOf('newcomer'))).toHaveLength(1)
  const entered = await enter(
    emailOf('newcomer'),
    await lastCode(db, emailOf('newcomer')),
    open,
  )
  const done = await send(
    '/welcome',
    {
      fields: { handle: 'newcomer', name: 'Newcomer', terms: 'on' },
      cookie: cookieOf(entered),
    },
    open,
  )
  expect(done.status).toBe(303)
  expect(await orm.$count(accounts)).toBe(1)
})

test('F42-AC12: Given someone signed in before new sign-ups were stopped and has no account yet, When they open the welcome page and send it, Then they are told it is stopped, no account is made, and once it is resumed they can finish', async () => {
  await (await ask(emailOf('half'), open)).text()
  const entered = await enter(
    emailOf('half'),
    await lastCode(db, emailOf('half')),
    open,
  )
  const cookie = cookieOf(entered)
  await pause()
  const page = await send('/welcome', { cookie }, open)
  expect(page.status).toBe(200)
  expect(await page.text()).toContain('新しい登録を一時的に止めています')
  const refused = await send(
    '/welcome',
    { fields: { handle: 'half', name: 'Half', terms: 'on' }, cookie },
    open,
  )
  expect(refused.status).toBe(503)
  expect(refused.headers.get('X-Slide-Intended')).toBe('signup_paused')
  expect(await orm.$count(accounts)).toBe(0)
  await resume()
  const done = await send(
    '/welcome',
    { fields: { handle: 'half', name: 'Half', terms: 'on' }, cookie },
    open,
  )
  expect(done.status).toBe(303)
  expect(await orm.$count(accounts)).toBe(1)
})

test('F42-AC12: Given a registered person who opens the welcome page while it is stopped, When they send it, Then they are sent on as before', async () => {
  const cookie = await signIn(closed, 'owner')
  await pause()
  const sent = await send(
    '/welcome',
    { fields: { handle: 'other', name: 'Other', terms: 'on' }, cookie },
    closed,
  )
  expect(sent.status).toBe(303)
})

test('F42-AC12, F42-AC15: Given the switch pressed in any order, When it is read, Then the newest press is the state, and pressing the same thing twice adds nothing', async () => {
  expect(await resume()).toBe('unchanged')
  expect(await pause()).toBe('changed')
  expect(await pause()).toBe('unchanged')
  expect(await resume()).toBe('changed')
  expect(await resume()).toBe('unchanged')
  expect(await pause()).toBe('changed')
  const rows = await orm.select().from(signupPauseEvents)
  expect(rows.map((row) => [row.paused, row.changed_by])).toEqual([
    [true, 'op@example.com'],
    [false, 'op@example.com'],
    [true, 'op@example.com'],
  ])
})

test('F42-AC12: Given presses made together, When they land, Then one row is added for the one change', async () => {
  const results = await Promise.all(Array.from({ length: 5 }, () => pause()))
  expect(results.filter((r) => r === 'changed')).toHaveLength(1)
  expect(await orm.$count(signupPauseEvents)).toBe(1)
})

test('F42-AC13: Given addresses in different states, When they are looked up as registered, Then only one with a user and an account is, in any spelling of the case', async () => {
  const crypto = emailCryptoOf(closed)
  await registered('member', 'm1')
  await seedPerson(db, 'u2', 'noaccount')
  expect(await isRegistered(db, 'member@mail.example', crypto)).toBe(true)
  expect(await isRegistered(db, 'MEMBER@mail.example', crypto)).toBe(true)
  expect(await isRegistered(db, 'noaccount@mail.example', crypto)).toBe(false)
  expect(await isRegistered(db, 'nobody@mail.example', crypto)).toBe(false)
  expect(OWNER_ID).toBeTruthy()
})
