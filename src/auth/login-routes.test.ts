import { eq } from 'drizzle-orm'
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
import { STASH_RETURN_PARAM } from '../drops/stash'
import { authSession, authUser, authVerification } from '../db/auth-schema'
import { accounts, invitedEmails, loginCodeRequests } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
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

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = testEnv(platform.env)

beforeAll(() => applyMigrations(db))
beforeEach(() => resetTables(db))
afterEach(() => vi.unstubAllGlobals())
afterAll(() => platform.dispose())

const send = (
  path: string,
  init: { fields?: Record<string, string>; cookie?: string; ip?: string } = {},
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
        ...(init.ip ? { 'CF-Connecting-IP': init.ip } : {}),
      },
      body: init.fields ? new URLSearchParams(init.fields) : undefined,
    }),
    target,
  )
const ask = (email: string, extra: Record<string, string> = {}, target = env) =>
  send('/login', { fields: { email, ...extra } }, target)
const enter = (
  email: string,
  code: string,
  extra: Record<string, string> = {},
  target: Env = env,
) => send('/login/code', { fields: { email, code, ...extra } }, target)
const cookieOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .find((value) => value.startsWith('__Host-slide_owner='))
    ?.split(';')[0] ?? ''
const visit = (path: string, cookie: string) => send(path, { cookie })

/** Asks for a code as an invited person who has no handle yet, and signs in. */
async function newcomer(login = 'newbie', extra: Record<string, string> = {}) {
  const email = emailOf(login)
  await invite(db, email)
  await (await ask(email, extra)).text()
  const entered = await enter(email, await lastCode(db, email), extra)
  return { email, entered, cookie: cookieOf(entered) }
}

test('F28-AC1: Given an invited address, When it is entered on /login, Then a 6-digit code is mailed there and the page asks for the code', async () => {
  const email = emailOf('alice')
  await invite(db, email)
  const response = await ask(email)
  expect(response.status).toBe(200)
  const page = await response.text()
  expect(page).toContain('name="code"')
  expect(page).toContain('inputmode="numeric"')
  expect(page).toContain('autocomplete="one-time-code"')
  const mails = await readOutbox(db, email)
  expect(mails).toHaveLength(1)
  expect(await lastCode(db, email)).toMatch(/^\d{6}$/)
})

test.each([
  ['ja', 'Slide のログインコード'],
  ['en', 'Your Slide sign-in code'],
])(
  'F28-AC2: Given the %s page, When a code is mailed, Then the mail holds the code and the service name only, with no link or image',
  async (lang, subject) => {
    const email = emailOf('alice')
    await invite(db, email)
    await (await send(`/login?lang=${lang}`, { fields: { email } })).text()
    const [mail] = await readOutbox(db, email)
    const code = await lastCode(db, email)
    expect(mail?.subject).toContain(subject)
    expect(mail?.subject).toContain(code)
    expect(mail?.body).toContain(code)
    expect(mail?.body).toContain('Slide')
    expect(`${mail?.subject}${mail?.body}`).not.toMatch(/https?:|<|www\./i)
  },
)

test('F28-AC3: Given a person who has a handle, When they enter the right code, Then they are signed in and the page they land on is theirs', async () => {
  const email = emailOf('owner')
  await seedPerson(db, OWNER_ID, 'owner')
  await orm
    .insert(accounts)
    .values({ user_id: OWNER_ID, handle: 'owner', created_at: 1 })
  await (await ask(email)).text()
  const entered = await enter(email, await lastCode(db, email))
  expect(entered.status).toBe(303)
  const cookie = cookieOf(entered)
  expect(cookie).not.toBe('')
  const owner = await visit('/auth/owner', cookie)
  expect(await owner.json()).toEqual({ userId: OWNER_ID, login: 'owner' })
  for (const attribute of [
    'Secure',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=43200',
  ])
    expect(
      entered.headers
        .getSetCookie()
        .find((value) => value.startsWith('__Host-slide_owner='))!,
    ).toContain(attribute)
  expect(
    await orm.select({ ip: authSession.ipAddress }).from(authSession).get(),
  ).toEqual({ ip: null })
})

test('F28-AC4: Given a first sign-in, When they open another page, Then they are sent to /welcome, and they can still sign out', async () => {
  const { cookie, entered } = await newcomer()
  expect(entered.headers.get('location')).toBe('/welcome')
  for (const path of ['/slides', '/settings', '/', '/notifications']) {
    const response = await visit(path, cookie)
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toMatch(/^\/welcome/)
  }
  expect((await visit('/welcome', cookie)).status).toBe(200)
  // The page they were going to is where they come back to.
  expect((await visit('/settings', cookie)).headers.get('location')).toBe(
    '/welcome?to=settings',
  )
  expect((await visit('/', cookie)).headers.get('location')).toBe(
    '/welcome?to=top',
  )
  expect((await visit('/@rina/talk', cookie)).headers.get('location')).toBe(
    '/welcome?to=%2F%40rina%2Ftalk',
  )
  expect((await visit('/api/slides', cookie)).status).toBe(401)
  const out = await send('/auth/logout', { fields: {}, cookie })
  expect(out.status).toBe(303)
  expect((await visit('/welcome', cookie)).status).toBe(303)
})

test('F28-AC5: Given a first sign-in begun from a slide, When they choose a handle and a name, Then they return to that slide', async () => {
  const { cookie } = await newcomer('newbie', { to: '/@rina/talk' })
  const done = await send('/welcome', {
    fields: { handle: 'newbie', name: 'Newbie', to: '/@rina/talk' },
    cookie,
  })
  expect(done.status).toBe(303)
  expect(done.headers.get('location')).toBe('/@rina/talk')
  expect(
    await orm.select().from(accounts).where(eq(accounts.handle, 'newbie')),
  ).toHaveLength(1)
  expect((await visit('/slides', cookie)).status).toBe(200)
})

test.each([
  'https://evil.example/@rina/talk',
  '//evil.example',
  'javascript:alert(1)',
  '/\\evil.example',
])(
  'F28-AC6: Given a destination %s that is not a path of this origin, When the sign-in ends, Then it goes to /slides',
  async (to) => {
    const { cookie } = await newcomer('newbie', { to })
    const done = await send('/welcome', {
      fields: { handle: 'newbie', name: 'Newbie', to },
      cookie,
    })
    expect(done.headers.get('location')).toBe('/slides')
  },
)

test('F28-AC7: Given an invited and an uninvited address, When each asks for a code, Then the answers are the same page', async () => {
  await invite(db, 'in@mail.example')
  const invited = await ask('in@mail.example')
  const stranger = await ask('out@mail.example')
  expect(stranger.status).toBe(invited.status)
  expect((await stranger.text()).replaceAll('out@', 'in@')).toBe(
    await invited.text(),
  )
})

test('F28-AC8: Given an uninvited address, When it asks for a code, Then nothing is mailed and no user exists', async () => {
  await (await ask('out@mail.example')).text()
  expect(await readOutbox(db, 'out@mail.example')).toEqual([])
  expect(await orm.$count(authUser)).toBe(0)
  const guess = await enter('out@mail.example', '123456')
  expect(cookieOf(guess)).toBe('')
})

test('F28-AC9: Given an invited and an uninvited address, When each asks for a code, Then both leave the same footprint, so the work the answer waits for is the same', async () => {
  await invite(db, 'in@mail.example')
  await (await ask('in@mail.example')).text()
  await (await ask('out@mail.example')).text()
  const rows = await orm.select().from(authVerification)
  expect(rows.map((row) => row.identifier).sort()).toEqual([
    'sign-in-otp-in@mail.example',
    'sign-in-otp-out@mail.example',
  ])
  expect(await orm.$count(loginCodeRequests)).toBe(2)
})

test('F28-AC10: Given a code, When five wrong codes are entered, Then even the right code no longer signs in, and each miss says how many tries are left', async () => {
  const email = emailOf('alice')
  await invite(db, email)
  await (await ask(email)).text()
  const right = await lastCode(db, email)
  const wrong = right === '000000' ? '111111' : '000000'
  const first = await enter(email, wrong)
  expect(first.status).toBe(400)
  expect(await first.text()).toContain('残り 4 回です')
  for (let miss = 2; miss <= 5; miss++) await (await enter(email, wrong)).text()
  const late = await enter(email, right)
  expect(late.status).toBe(400)
  expect(cookieOf(late)).toBe('')
  expect(await late.text()).toContain('使えなくなりました')
})

test('F28-AC11: Given a code sent more than 10 minutes ago, When it is entered, Then it does not sign in', async () => {
  const email = emailOf('alice')
  await invite(db, email)
  await (await ask(email)).text()
  const row = await orm.select().from(authVerification).get()
  const sent = row!.expiresAt.getTime() - 10 * 60 * 1000
  expect(Math.abs(sent - Date.now())).toBeLessThan(60_000)
  await orm
    .update(authVerification)
    .set({ expiresAt: new Date(Date.now() - 1000) })
  expect(cookieOf(await enter(email, await lastCode(db, email)))).toBe('')
})

test('F28-AC12: Given a code that signed someone in, When it is entered again, Then it does not sign in again', async () => {
  const email = emailOf('alice')
  await invite(db, email)
  await (await ask(email)).text()
  const code = await lastCode(db, email)
  expect(cookieOf(await enter(email, code))).not.toBe('')
  expect(cookieOf(await enter(email, code))).toBe('')
})

const limited = (limits: object) =>
  ({ ...env, LOGIN_CODE_LIMITS: limits }) as unknown as Env

test('F28-AC13 F28-AC15: Given a limit of two codes per address set in the settings, When a third is asked for, Then it is refused with the time it can be asked again, and nothing is mailed', async () => {
  const target = limited({ perAddress: 2, perSource: 100 })
  const email = emailOf('alice')
  await invite(db, email)
  await (await ask(email, {}, target)).text()
  await (await ask(email, {}, target)).text()
  const third = await ask(email, {}, target)
  expect(third.status).toBe(429)
  expect(Number(third.headers.get('retry-after'))).toBeGreaterThan(0)
  expect(await third.text()).toMatch(/以降に、もう一度お試しください/)
  expect(await readOutbox(db, email)).toHaveLength(2)
  // The same limit holds for an address that is not invited.
  await (await ask('out@mail.example', {}, target)).text()
  await (await ask('out@mail.example', {}, target)).text()
  expect((await ask('out@mail.example', {}, target)).status).toBe(429)
})

test('F28-AC14: Given a limit of two codes per client, When one client asks for a third, Then it is refused, and another client is not', async () => {
  const target = limited({ perAddress: 100, perSource: 2 })
  const post = (email: string, ip: string) =>
    send('/login', { fields: { email }, ip }, target)
  for (const login of ['a', 'b']) {
    await invite(db, emailOf(login))
    await (await post(emailOf(login), '203.0.113.7')).text()
  }
  await invite(db, emailOf('c'))
  const refused = await post(emailOf('c'), '203.0.113.7')
  expect(refused.status).toBe(429)
  expect(await refused.text()).toContain('以降に')
  expect(await readOutbox(db, emailOf('c'))).toEqual([])
  expect((await post(emailOf('c'), '198.51.100.9')).status).toBe(200)
})

test('F28-AC16: Given Turnstile is set up, When the check fails or passes, Then a code is sent only when it passes, and without a secret it passes', async () => {
  const email = emailOf('alice')
  await invite(db, email)
  const secured = {
    ...env,
    TURNSTILE_SITE_KEY: 'site',
    TURNSTILE_SECRET: 'secret',
  } as unknown as Env
  for (const [success, mailed] of [
    [false, 0],
    [true, 1],
  ] as const) {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('challenges.cloudflare.com/turnstile')
      return Response.json({ success })
    })
    const response = await ask(
      email,
      { 'cf-turnstile-response': 'token' },
      secured,
    )
    expect(response.status).toBe(success ? 200 : 400)
    expect(await readOutbox(db, email)).toHaveLength(mailed)
    vi.unstubAllGlobals()
  }
  // No token, or Cloudflare unreachable: no code.
  vi.stubGlobal('fetch', async () => {
    throw new Error('offline')
  })
  expect((await ask(email, {}, secured)).status).toBe(400)
  expect(
    (await ask(email, { 'cf-turnstile-response': 't' }, secured)).status,
  ).toBe(400)
  expect(await readOutbox(db, email)).toHaveLength(1)
  vi.unstubAllGlobals()
  // The widget and its policy appear only with a site key.
  const page = await send('/login', {}, secured)
  expect(await page.text()).toContain('data-sitekey="site"')
  expect(page.headers.get('content-security-policy')).toContain(
    'challenges.cloudflare.com',
  )
  const plain = await send('/login')
  expect(await plain.text()).not.toContain('data-sitekey')
  expect(plain.headers.get('content-security-policy')).not.toContain(
    'challenges.cloudflare.com',
  )
})

test.each([
  ['ja', '招待制', '運営が登録したメールアドレスでだけログインできます'],
  ['en', 'by invitation', 'email addresses the operator registered'],
])(
  'F28-AC17: Given the %s login page, When it is opened, Then it says sign-in is by invitation, for registered addresses only',
  async (lang, first, second) => {
    const page = await (await send(`/login?lang=${lang}`)).text()
    expect(page).toContain(first)
    expect(page).toContain(second)
  },
)

test('F28-AC20: Given a handle someone holds, When a newcomer asks for it, Then they are told it is taken and no account is made', async () => {
  await seedPerson(db, '1', 'rina')
  await orm
    .insert(accounts)
    .values({ user_id: '1', handle: 'rina', created_at: 1 })
  const { cookie } = await newcomer()
  const response = await send('/welcome', {
    fields: { handle: 'rina', name: 'Newbie' },
    cookie,
  })
  expect(response.status).toBe(409)
  const page = await response.text()
  expect(page).toContain('すでに使われています')
  expect(page).toContain('value="rina"')
  expect(await orm.$count(accounts)).toBe(1)
})

test.each([
  ['Upper', 'a to z'],
  ['', '入力してください'],
  ['a'.repeat(40), '39 文字まで'],
  ['-lead', '- で始められません'],
  ['sp ace', '英小文字、数字、- だけ'],
  ['admin', 'サービスが使うため'],
])(
  'F28-AC18 F28-AC19: Given the handle %j, When a newcomer sends it, Then it is refused with a reason and no account is made',
  async (handle, reason) => {
    const { cookie } = await newcomer()
    const response = await send('/welcome', {
      fields: { handle, name: 'Newbie' },
      cookie,
    })
    expect(response.status).toBe(400)
    if (reason !== 'a to z') expect(await response.text()).toContain(reason)
    expect(await orm.$count(accounts)).toBe(0)
  },
)

test('F28-AC18: Given a display name that is empty or over 50 characters, When a newcomer sends it, Then it is refused, and 50 characters is accepted', async () => {
  const { cookie } = await newcomer()
  for (const name of ['', '   ', 'あ'.repeat(51)]) {
    const response = await send('/welcome', {
      fields: { handle: 'newbie', name },
      cookie,
    })
    expect(response.status).toBe(400)
  }
  const ok = await send('/welcome', {
    fields: { handle: 'newbie', name: 'あ'.repeat(50) },
    cookie,
  })
  expect(ok.status).toBe(303)
})

test('F28-AC21: Given a person with a handle, When they send /welcome again with another handle, Then the handle stays', async () => {
  const { cookie } = await newcomer()
  await send('/welcome', { fields: { handle: 'first', name: 'N' }, cookie })
  const again = await send('/welcome', {
    fields: { handle: 'second', name: 'N' },
    cookie,
  })
  expect(again.status).toBe(303)
  expect((await orm.select().from(accounts)).map((row) => row.handle)).toEqual([
    'first',
  ])
})

test('F28-AC22 F28-AC23: Given a signed-in person, When they open pages and the APIs, Then their email address is in none of them', async () => {
  const cookie = await signIn(env, 'owner')
  const email = emailOf('owner')
  const hashes = async (text: string) => text.includes(email)
  for (const path of [
    '/',
    '/slides',
    '/@owner',
    '/notifications',
    '/help',
    '/api/session',
    '/api/slides',
    '/auth/owner',
    '/api/home',
  ]) {
    const response = await visit(path, cookie)
    expect(await hashes(await response.text()), path).toBe(false)
    expect(JSON.stringify([...response.headers]), path).not.toContain(email)
  }
})

test('F28-AC23: Given the mail service refuses a message, When a code is asked for, Then the log names no address and the page is the same', async () => {
  const email = emailOf('alice')
  await invite(db, email)
  const logs: string[] = []
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    logs.push(args.map(String).join(' '))
  })
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) =>
    String(input).includes('turnstile')
      ? Response.json({ success: true })
      : new Response('no', { status: 500 }),
  )
  const real = {
    ...env,
    MAIL_API_TOKEN: 't',
    MAIL_ACCOUNT_ID: 'a',
    MAIL_FROM: 'login@slide.example',
    TURNSTILE_SITE_KEY: 'site',
    TURNSTILE_SECRET: 'secret',
  } as unknown as Env
  const response = await ask(email, { 'cf-turnstile-response': 't' }, real)
  expect(response.status).toBe(200)
  expect(await response.text()).toContain('name="code"')
  expect(logs.join('\n')).toContain('login_code_unsent')
  expect(logs.join('\n')).not.toContain(email)
  vi.restoreAllMocks()
})

test('F28-AC23: Given the mail service is set up, When a code is asked for, Then it is sent through Cloudflare Email Service as plain text', async () => {
  const email = emailOf('alice')
  await invite(db, email)
  const calls: { url: string; init?: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('siteverify'))
        return Response.json({ success: true })
      calls.push({ url: String(input), init })
      return Response.json({ success: true })
    },
  )
  const real = {
    ...env,
    MAIL_API_TOKEN: 'token',
    MAIL_ACCOUNT_ID: 'acct',
    MAIL_FROM: 'login@slide.example',
    TURNSTILE_SITE_KEY: 'site',
    TURNSTILE_SECRET: 'secret',
  } as unknown as Env
  await (await ask(email, { 'cf-turnstile-response': 't' }, real)).text()
  expect(calls).toHaveLength(1)
  expect(calls[0]?.url).toBe(
    'https://api.cloudflare.com/client/v4/accounts/acct/email/sending/send',
  )
  const body = JSON.parse(String(calls[0]?.init?.body))
  expect(body).toMatchObject({ to: email, from: 'login@slide.example' })
  expect(body.html).toBeUndefined()
  expect(await readOutbox(db, email)).toEqual([])
})

test('Given no mail service and no outbox, When a code is asked for, Then the answer is 503 for every address alike', async () => {
  const bare = { ...env, MAIL_OUTBOX: undefined } as unknown as Env
  await invite(db, 'in@mail.example')
  expect((await ask('in@mail.example', {}, bare)).status).toBe(503)
  expect((await ask('out@mail.example', {}, bare)).status).toBe(503)
})

test('F28-AC26: Given a signed-in person, When the operator takes their address off the invitations, Then their next request is refused and the session is gone', async () => {
  const cookie = await signIn(env, 'owner')
  expect((await visit('/auth/owner', cookie)).status).toBe(200)
  await orm.delete(invitedEmails)
  expect((await visit('/auth/owner', cookie)).status).toBe(401)
  expect(await orm.$count(authSession)).toBe(0)
})

test.each([
  ['/auth/github', '/login'],
  [
    '/auth/github?to=top&drop=abcdefghijklmnop',
    '/login?to=top&drop=abcdefghijklmnop',
  ],
  ['/auth/github/callback?code=c&state=s', '/login'],
  ['/auth/invitation-only', '/login'],
])(
  'F28-AC27: Given the old GitHub route %s, When it is opened, Then it goes to the login page with its destination',
  async (path, to) => {
    const response = await send(path)
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(to)
  },
)

test('F28-AC29 F22-AC42: Given a file kept for sign-in, When the person signs in from /login?to=top, Then they land on the top page with the token that receives it', async () => {
  const token = '9d0b6a51-7c1e-4f55-8a43-5e2f1b7c9a10'
  const cookie = await signIn(env, 'owner')
  const welcome = await send(`/welcome?to=top&${STASH_RETURN_PARAM}=${token}`, {
    cookie,
  })
  expect(welcome.status).toBe(303)
  expect(welcome.headers.get('location')).toBe(
    `/?${STASH_RETURN_PARAM}=${token}`,
  )
  const page = await (
    await send(`/login?to=top&${STASH_RETURN_PARAM}=${token}`)
  ).text()
  expect(page).toContain('name="to" value="top"')
  expect(page).toContain(`name="drop" value="${token}"`)
})

test('F28-AC30: Given an agent’s connection waiting for sign-in, When the person signs in from /login?to=agent, Then they land on the authorization page', async () => {
  const cookie = await signIn(env, 'owner')
  const welcome = await send('/welcome?to=agent', { cookie })
  expect(welcome.headers.get('location')).toBe('/oauth/authorize')
})

test('F28-AC31: Given a visitor, When any page is opened, Then the header’s fallback link is the login page', async () => {
  const page = await (await send('/help')).text()
  expect(page).toContain('<noscript><a href="/login">ログイン</a></noscript>')
})

test('F28-AC33: Given a signed-in person, When they sign out, Then the session is gone and the management pages do not open, and another origin cannot sign them out', async () => {
  const cookie = await signIn(env, 'owner')
  const across = await server.fetch(
    new Request(`${TEST_ORIGIN}/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: 'https://evil.example' },
    }),
    env,
  )
  expect(across.status).toBe(403)
  expect((await visit('/slides', cookie)).status).toBe(200)
  const out = await send('/auth/logout', { fields: {}, cookie })
  expect(out.status).toBe(303)
  expect(await orm.$count(authSession)).toBe(0)
  expect((await visit('/slides', cookie)).status).toBe(401)
  expect((await visit('/auth/owner', cookie)).status).toBe(401)
})

test('Given an earlier session, When the person signs in again, Then only the newer session works', async () => {
  const first = await signIn(env, 'owner')
  const second = await signIn(env, 'owner')
  expect((await visit('/auth/owner', first)).status).toBe(401)
  expect((await visit('/auth/owner', second)).status).toBe(200)
})

test('Given a tampered or expired session cookie, When a protected page is opened, Then it is refused', async () => {
  const cookie = await signIn(env, 'owner')
  expect((await visit('/auth/owner', `${cookie}x`)).status).toBe(401)
  await orm.update(authSession).set({ expiresAt: new Date(1) })
  expect((await visit('/auth/owner', cookie)).status).toBe(401)
})

test('Given a missing or short auth secret, When a code is asked for, Then it fails closed', async () => {
  await invite(db, 'in@mail.example')
  for (const secret of ['', 'short'])
    expect(
      (await ask('in@mail.example', {}, { ...env, BETTER_AUTH_SECRET: secret }))
        .status,
    ).toBe(503)
})

test('Given Better Auth’s own endpoints, When they are requested directly, Then none is reachable', async () => {
  for (const path of [
    '/auth/email-otp/send-verification-otp',
    '/auth/sign-in/email-otp',
    '/auth/sign-in/social',
    '/auth/update-user',
    '/auth/delete-user',
  ])
    expect(
      (await send(path, { fields: { email: 'x@y.example' } })).status,
      path,
    ).toBe(404)
})

test.each(['', 'not an address', 'a@b', `${'a'.repeat(250)}@x.example`])(
  'Given %j typed as the address, When the code is asked for, Then the page says it is not an address and nothing is mailed',
  async (typed) => {
    const response = await ask(typed)
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('形式が正しくありません')
    expect(await orm.$count(loginCodeRequests)).toBe(0)
  },
)

test('Given upper case and spaces around an invited address, When it is typed, Then it is the same address', async () => {
  await invite(db, 'alice@mail.example')
  await (await ask('  Alice@Mail.Example ')).text()
  expect(await readOutbox(db, 'alice@mail.example')).toHaveLength(1)
})

test.each([
  [
    'a real mail service and no Turnstile',
    { MAIL_API_TOKEN: 't', MAIL_ACCOUNT_ID: 'a', MAIL_FROM: 'l@slide.example' },
  ],
  ['a Turnstile secret and no site key', { TURNSTILE_SECRET: 's' }],
  ['a Turnstile site key and no secret', { TURNSTILE_SITE_KEY: 'k' }],
])(
  'F28-AC16: Given %s, When a code is asked for, Then it is refused with 503 and nothing is mailed',
  async (_name, extra) => {
    await invite(db, 'in@mail.example')
    const target = { ...env, ...extra } as unknown as Env
    vi.stubGlobal('fetch', async () => Response.json({ success: true }))
    const response = await ask(
      'in@mail.example',
      { 'cf-turnstile-response': 't' },
      target,
    )
    expect(response.status).toBe(503)
    expect(await readOutbox(db, 'in@mail.example')).toEqual([])
  },
)

test('F28-AC13: Given a limit of 3 per address, When ten requests arrive at once, Then exactly three pass', async () => {
  const target = limited({ perAddress: 3, perSource: 100 })
  const email = emailOf('alice')
  await invite(db, email)
  const answers = await Promise.all(
    Array.from({ length: 10 }, () => ask(email, {}, target)),
  )
  expect(answers.filter((r) => r.status === 200)).toHaveLength(3)
  expect(answers.filter((r) => r.status === 429)).toHaveLength(7)
  expect(await orm.$count(loginCodeRequests)).toBe(3)
})

test('F28-AC14: Given a limit of 2 per client, When six requests for different addresses arrive at once, Then exactly two pass', async () => {
  const target = limited({ perAddress: 100, perSource: 2 })
  const answers = await Promise.all(
    ['a', 'b', 'c', 'd', 'e', 'f'].map((name) =>
      send(
        '/login',
        { fields: { email: emailOf(name) }, ip: '203.0.113.7' },
        target,
      ),
    ),
  )
  expect(answers.filter((r) => r.status === 200)).toHaveLength(2)
})

test('F28-AC9: Given someone holds a live code, When anyone asks for a code for that address again, Then the same code is sent again and theirs still works', async () => {
  const email = emailOf('alice')
  await invite(db, email)
  await (await ask(email)).text()
  const held = await lastCode(db, email)
  await (await ask(email)).text()
  await (await send('/login', { fields: { email }, ip: '198.51.100.9' })).text()
  expect(await readOutbox(db, email)).toHaveLength(3)
  expect(await lastCode(db, email)).toBe(held)
  expect(cookieOf(await enter(email, held))).not.toBe('')
})

test('F28-AC16: Given a Turnstile site key, When the code page is shown, Then the form that sends the code again has the widget too', async () => {
  const secured = {
    ...env,
    TURNSTILE_SITE_KEY: 'site',
    TURNSTILE_SECRET: 'secret',
  } as unknown as Env
  vi.stubGlobal('fetch', async () => Response.json({ success: true }))
  await invite(db, 'in@mail.example')
  const page = await (
    await ask('in@mail.example', { 'cf-turnstile-response': 't' }, secured)
  ).text()
  const resend = page.slice(page.indexOf('action="/login"'))
  expect(resend).toContain('data-sitekey="site"')
  // Without the token the second request is refused like the first.
  const again = await ask('in@mail.example', {}, secured)
  expect(again.status).toBe(400)
})

test('Given codes that ran out, When a code is asked for, Then the expired rows are removed', async () => {
  await invite(db, 'in@mail.example')
  await orm.insert(authVerification).values({
    id: 'old',
    identifier: 'sign-in-otp-old@mail.example',
    value: 'x',
    expiresAt: new Date(1000),
    createdAt: new Date(1),
    updatedAt: new Date(1),
  })
  await (await ask('in@mail.example')).text()
  expect(
    (await orm.select().from(authVerification)).map((r) => r.id),
  ).not.toContain('old')
})

test('F28-AC10: Given ten tries at one address within the hour, When the eleventh comes with the right code, Then it is refused', async () => {
  const email = emailOf('alice')
  await invite(db, email)
  await (await ask(email)).text()
  const right = await lastCode(db, email)
  const target = limited({ attemptsPerAddress: 10 })
  for (let i = 0; i < 10; i++)
    await (await enter(email, '000000', {}, target)).text()
  const late = await enter(email, right, {}, target)
  expect(late.status).toBe(429)
  expect(cookieOf(late)).toBe('')
})

test('F28-AC26: Given an address taken off the invitations after a code went out, When the right code is entered, Then no user and no session are made', async () => {
  const email = emailOf('alice')
  await invite(db, email)
  await (await ask(email)).text()
  await orm.delete(invitedEmails)
  const late = await enter(email, await lastCode(db, email))
  expect(cookieOf(late)).toBe('')
  expect(await orm.$count(authUser)).toBe(0)
  expect(await orm.$count(authSession)).toBe(0)
})
