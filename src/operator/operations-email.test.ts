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
import { addInvite } from '../auth/invites-store'
import { emailCryptoOf } from '../db/email-settings'
import { applyMigrations } from '../db/test-migrations'
import type { EmailAddress } from '../mail/address'
import {
  emailOf,
  resetTables,
  seedPerson,
  testEnv,
} from '../publication/test-support'
import { ACCESS_TOKEN_HEADER } from './access'
import { accessTeam, AUDIENCE, OPERATOR_ORIGIN, TEAM } from './test-support'

const team = await accessTeam()
vi.mock('./access-client', () => ({ accessKeys: () => team.keys }))

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const orm = drizzle(database)

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
const base = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
  OPERATOR_ORIGIN,
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUDIENCE,
}
const off = base as unknown as Env
const on = { ...base, ...KEYS } as unknown as Env

beforeAll(() => applyMigrations(database))
beforeEach(() => resetTables(database))
afterEach(() => vi.restoreAllMocks())
afterAll(() => platform.dispose())

const get = async (path: string, env: Env) =>
  server.fetch(
    new Request(`${OPERATOR_ORIGIN}${path}`, {
      headers: { [ACCESS_TOKEN_HEADER]: await team.sign() },
    }),
    env,
  )
async function post(
  path: string,
  env: Env,
  options: { token?: boolean; origin?: string | null } = {},
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  }
  if (options.token !== false) headers[ACCESS_TOKEN_HEADER] = await team.sign()
  if (options.origin !== null)
    headers.Origin = options.origin ?? OPERATOR_ORIGIN
  return server.fetch(
    new Request(`${OPERATOR_ORIGIN}${path}`, {
      method: 'POST',
      headers,
      body: new URLSearchParams(),
    }),
    env,
  )
}
const frameOf = (page: string) =>
  page.slice(
    page.indexOf('<section id="email">'),
    page.indexOf('</section>', page.indexOf('<section id="email">')),
  )

test('F41-AC13: Given no keys, When the operations page is opened, Then the frame says not set and offers nothing to press', async () => {
  const frame = frameOf(await (await get('/operations', off)).text())
  expect(frame).toContain('未設定')
  expect(frame).not.toContain('<button')
})

test('F41-AC10, F41-AC8: Given keys and plain rows, When the operations page is opened and the operator rewrites, Then the count shows, falls and the button goes', async () => {
  await seedPerson(database, 'u-a', 'a')
  await seedPerson(database, 'u-b', 'b')
  const first = frameOf(await (await get('/operations', on)).text())
  expect(first).toMatch(/平文の行\(残り\)<\/dt>\s*<dd>4 件/)
  expect(first).toContain('<button')
  const pressed = await post('/operations/email/rewrite', on)
  expect(pressed.status).toBe(303)
  expect(pressed.headers.get('location')).toBe('/operations#email')
  const after = frameOf(await (await get('/operations', on)).text())
  expect(after).toMatch(/平文の行\(残り\)<\/dt>\s*<dd>0 件/)
  expect(after).not.toContain('<button')
  expect(after).not.toContain('mail.example')
})

test('F41-AC9: Given a rewrite pressed twice, When the second finishes, Then the log of it counts nothing more and holds no address', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  await seedPerson(database, 'u-a', 'a')
  await post('/operations/email/rewrite', on)
  await post('/operations/email/rewrite', on)
  const lines = log.mock.calls.map((call) => String(call[0]))
  expect(lines).toHaveLength(2)
  expect(JSON.parse(lines[1]!)).toMatchObject({
    sealed: 0,
    resealed: 0,
    failed: 0,
  })
  expect(lines.join('\n')).not.toContain('mail.example')
})

test('F41-AC5: Given a sealed invitation, When the operator opens the home page, Then the invitation list shows the address', async () => {
  await addInvite(
    database,
    {
      email: emailOf('shown') as EmailAddress,
      invitedBy: 'op@example.com',
      now: 1,
    },
    emailCryptoOf(on),
  )
  expect(await (await get('/', on)).text()).toContain(emailOf('shown'))
})

test('F41-AC14: Given keys that do not fit the sealed rows, When the page is opened and a rewrite pressed, Then the frame says they do not fit and no row changes', async () => {
  await seedPerson(database, 'u-a', 'a')
  await post('/operations/email/rewrite', on)
  // Written straight in: `addInvite` refuses to add a plain row beside sealed ones.
  await orm.run(sql`INSERT INTO auth_user
    (id, name, email, email_verified, created_at, updated_at)
    VALUES ('u-b', '', ${emailOf('b')}, 1, 1, 1)`)
  const wrong = { ...on, EMAIL_CIPHER_KEYS: `1:${b64(2)}` } as unknown as Env
  const before = await orm.all(sql`SELECT * FROM auth_user ORDER BY id`)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(frameOf(await (await get('/operations', wrong)).text())).toContain(
    '合いません',
  )
  expect((await post('/operations/email/rewrite', wrong)).status).toBe(303)
  expect(await orm.all(sql`SELECT * FROM auth_user ORDER BY id`)).toEqual(
    before,
  )
})

test('F41-AC14: Given keys set but unusable, When the page is opened, Then the frame names the problem', async () => {
  const broken = { ...on, EMAIL_CIPHER_CURRENT: '9' } as unknown as Env
  const frame = frameOf(await (await get('/operations', broken)).text())
  expect(frame).toContain('EMAIL_CIPHER_CURRENT')
  expect(frame).not.toContain(b64(1))
})

test.each([
  ['a request from another origin', { origin: 'https://evil.example' }],
  ['a request with no origin', { origin: null }],
])(
  'F41-AC13: Given %s, When it presses rewrite, Then it is refused and nothing changes',
  async (_name, options) => {
    await seedPerson(database, 'u-a', 'a')
    expect((await post('/operations/email/rewrite', on, options)).status).toBe(
      403,
    )
    expect(await orm.all(sql`SELECT email FROM auth_user`)).toEqual([
      { email: emailOf('a') },
    ])
  },
)

test('F41-AC13: Given no Access token, When rewrite is pressed, Then it is answered like a missing page', async () => {
  const response = await post('/operations/email/rewrite', on, { token: false })
  expect(response.status).toBe(404)
})

const postInvite = async (path: string, email: string, env: Env) =>
  server.fetch(
    new Request(`${OPERATOR_ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: OPERATOR_ORIGIN,
        [ACCESS_TOKEN_HEADER]: await team.sign(),
      },
      body: new URLSearchParams({ email }),
    }),
    env,
  )

test('F41-AC14: Given keys set but not usable, When the operator opens the home page, Then it is drawn, the invitations say they cannot be read and the other lists are still there', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const broken = { ...on, EMAIL_CIPHER_CURRENT: '9' } as unknown as Env
  const response = await get('/', broken)
  expect(response.status).toBe(200)
  const page = await response.text()
  expect(page).toContain('読めません')
  expect(page).toContain('href="/operations#email"')
  expect(page).toContain('action="/takedowns"')
  expect(page).toContain('action="/suspensions"')
  expect(page).not.toContain('招待している人（')
})

test('F41-AC14: Given one invitation the keys cannot open, When the operator opens the home page, Then it is drawn with the same notice and nothing else is lost', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const add = (login: string, target: Env) =>
    addInvite(
      database,
      {
        email: emailOf(login) as EmailAddress,
        invitedBy: 'op@example.com',
        now: 1,
      },
      emailCryptoOf(target),
    )
  await add('old', on)
  const v2 = {
    ...on,
    EMAIL_CIPHER_KEYS: `2:${b64(2)}`,
    EMAIL_CIPHER_CURRENT: '2',
  } as unknown as Env
  // Version 1's key is gone while one row is still under it; a row under
  // version 2 opens. The sealed row of version 1 stops the list, not the page.
  await expect(add('new', v2)).rejects.toThrow('email crypto')
  const response = await get('/', v2)
  expect(response.status).toBe(200)
  expect(await response.text()).toContain('読めません')
})

test('F41-AC14: Given keys that do not work, When the operator adds or takes off an invitation, Then it says so and changes nothing', async () => {
  const broken = { ...on, EMAIL_CIPHER_CURRENT: '9' } as unknown as Env
  for (const path of ['/invites', '/invites/remove']) {
    const response = await postInvite(path, 'a@mail.example', broken)
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/?result=invite_keys')
  }
  expect(await orm.all(sql`SELECT email FROM invited_emails`)).toEqual([])
  const shown = await (await get('/?result=invite_keys', off)).text()
  expect(shown).toContain('鍵が使えない')
})
