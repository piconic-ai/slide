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
  await seedPerson(database, 'u-b', 'b')
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
