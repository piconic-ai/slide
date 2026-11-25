import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { decks } from '../db/schema'
import { readTakedown } from '../publication/takedown-store'
import {
  resetTables,
  seedDeck,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { ACCESS_TOKEN_HEADER } from './access'
import { PAGE_SIZE } from './pagination'
import { accessTeam, AUDIENCE, OPERATOR_ORIGIN, TEAM } from './test-support'

const team = await accessTeam()
vi.mock('./access-client', () => ({ accessKeys: () => team.keys }))

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
  OPERATOR_ORIGIN,
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUDIENCE,
} as unknown as Env

let owner = ''
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  owner = await signIn(env)
  await seedPublic(db, 'talk', 100, 'Talk')
})
afterAll(() => platform.dispose())

const open = async (path = '/') =>
  server.fetch(
    new Request(`${OPERATOR_ORIGIN}${path}`, {
      headers: { [ACCESS_TOKEN_HEADER]: await team.sign() },
    }),
    env,
  )
const post = async (
  path: string,
  fields: Record<string, string>,
  options: {
    token?: boolean
    origin?: string | null
    contentType?: string
    fetchSite?: string
  } = {},
) => {
  const headers = new Headers({
    'Content-Type': options.contentType ?? 'application/x-www-form-urlencoded',
  })
  if (options.fetchSite) headers.set('Sec-Fetch-Site', options.fetchSite)
  if (options.token !== false)
    headers.set(ACCESS_TOKEN_HEADER, await team.sign())
  if (options.origin !== null)
    headers.set('Origin', options.origin ?? OPERATOR_ORIGIN)
  return server.fetch(
    new Request(`${OPERATOR_ORIGIN}${path}`, {
      method: 'POST',
      headers,
      body: new URLSearchParams(fields).toString(),
    }),
    env,
  )
}
const hide = (target = '@owner/talk', reason = 'fake sign-in page') =>
  post('/takedowns', { target, reason })
const authorPage = async () =>
  (
    await server.fetch(
      new Request(`${TEST_ORIGIN}/slides/talk`, { headers: { Cookie: owner } }),
      env,
    )
  ).text()

test('F17-AC14: Given a public deck, When the operator hides it from the form, Then the share URL stops answering and the operator page lists the deck with its reason, time, and operator', async () => {
  const response = await hide(`${TEST_ORIGIN}/@owner/talk`)
  expect(response.status).toBe(303)
  expect(response.headers.get('Location')).toBe('/?result=hidden')
  expect(
    (await server.fetch(new Request(`${TEST_ORIGIN}/@owner/talk`), env)).status,
  ).toBe(404)
  const takedown = await readTakedown(db, 'talk')
  if (!takedown || takedown === 'missing') throw new Error('not hidden')
  const page = await (await open('/?result=hidden')).text()
  expect(page).toContain('@owner/talk')
  expect(page).toContain('fake sign-in page')
  expect(page).toContain('op@example.com')
  expect(page).toContain(new Date(takedown.hiddenAt * 1000).toISOString())
  expect(page).toContain('非表示にしました。')
})

test('F17-AC13: Given a deck the operator hid, When the author opens its page, Then it says the operator hid it, with the reason and the time, and a release removes the notice', async () => {
  expect(await authorPage()).not.toContain('運営がこのスライドを非表示')
  await hide()
  const takedown = await readTakedown(db, 'talk')
  if (!takedown || takedown === 'missing') throw new Error('not hidden')
  const page = await authorPage()
  expect(page).toContain('運営がこのスライドを非表示にしています。')
  expect(page).toContain('fake sign-in page')
  expect(page).toContain(new Date(takedown.hiddenAt * 1000).toISOString())
  // The operator's identity is not the author's to see.
  expect(page).not.toContain('op@example.com')
  await post('/takedowns/talk/release', {})
  expect(await authorPage()).not.toContain('運営がこのスライドを非表示')
})

test('F17-AC11: Given a hidden deck, When the operator releases it from the list, Then the share URL answers again and the list is empty', async () => {
  await hide()
  const response = await post('/takedowns/talk/release', {})
  expect(response.headers.get('Location')).toBe('/?result=released')
  expect(
    (await server.fetch(new Request(`${TEST_ORIGIN}/@owner/talk`), env)).status,
  ).toBe(200)
  expect(await (await open()).text()).toContain(
    '非表示にしているスライドはありません。',
  )
})

test('Given a reason with markup, When it is shown to the operator and the author, Then it is text, not markup', async () => {
  await hide('@owner/talk', '<script>alert(1)</script>')
  for (const page of [await (await open()).text(), await authorPage()]) {
    expect(page).not.toContain('<script>alert(1)</script>')
    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  }
})

test.each([
  [
    'a target that names no deck',
    { target: 'nothing', reason: 'r' },
    'invalid_target',
  ],
  [
    'a deck that does not exist',
    { target: '@owner/missing', reason: 'r' },
    'not_found',
  ],
  [
    "another author's handle",
    { target: '@other/talk', reason: 'r' },
    'not_found',
  ],
  [
    'an empty reason',
    { target: '@owner/talk', reason: '  ' },
    'invalid_reason',
  ],
  ['no fields at all', {}, 'invalid_target'],
])(
  'Given %s, When the form is posted, Then nothing is hidden and the page says why',
  async (_, fields, result) => {
    const response = await post('/takedowns', fields as Record<string, string>)
    expect(response.headers.get('Location')).toBe(`/?result=${result}`)
    expect(await readTakedown(db, 'talk')).toBeNull()
  },
)

test('Given a hidden deck, When it is hidden again, Then the first record stays and the page says nothing changed', async () => {
  await hide('@owner/talk', 'first')
  const again = await hide('@owner/talk', 'second')
  expect(again.headers.get('Location')).toBe('/?result=unchanged')
  expect(await readTakedown(db, 'talk')).toMatchObject({ reason: 'first' })
})

test.each([
  ['a form posted from another origin', { origin: 'https://evil.example' }],
  ['a form posted from the management origin', { origin: TEST_ORIGIN }],
  ['no Origin header', { origin: null }],
  [
    'a JSON body from another origin',
    { origin: 'https://evil.example', contentType: 'application/json' },
  ],
  [
    'another origin that claims to be same-origin',
    { origin: 'https://evil.example', fetchSite: 'same-origin' },
  ],
])(
  'F17-AC12: Given %s, When hide and release are posted with a verified token, Then they are forbidden and nothing changes',
  async (_, options) => {
    const denied = await post(
      '/takedowns',
      { target: '@owner/talk', reason: 'r' },
      options,
    )
    expect(denied.status).toBe(403)
    expect(denied.headers.get('Cache-Control')).toBe('no-store')
    expect(await readTakedown(db, 'talk')).toBeNull()
    await hide()
    const release = await post('/takedowns/talk/release', {}, options)
    expect(release.status).toBe(403)
    expect(await readTakedown(db, 'talk')).not.toBeNull()
  },
)

test('F17-AC12: Given no token, When hide and release are posted from the operator origin, Then they answer like a missing page and nothing changes', async () => {
  const denied = await post(
    '/takedowns',
    { target: '@owner/talk', reason: 'r' },
    { token: false },
  )
  expect(denied.status).toBe(404)
  expect(await readTakedown(db, 'talk')).toBeNull()
  await hide()
  const release = await post('/takedowns/talk/release', {}, { token: false })
  expect(release.status).toBe(404)
  expect(await readTakedown(db, 'talk')).not.toBeNull()
})

test('F17-AC19: Given the management origin, When the operator paths are posted with a verified token, Then no deck is hidden', async () => {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/takedowns`, {
      method: 'POST',
      headers: {
        [ACCESS_TOKEN_HEADER]: await team.sign(),
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'target=%40owner%2Ftalk&reason=r',
    }),
    env,
  )
  expect(response.status).toBe(404)
  expect(await readTakedown(db, 'talk')).toBeNull()
})

/** Hides `count` more decks, `deck-0` first, so it is the oldest. */
async function hideMany(count: number) {
  const orm = drizzle(db)
  for (let index = 0; index < count; index++) {
    const id = `deck-${index}`
    await seedDeck(db, id)
    await orm
      .update(decks)
      .set({
        hidden_at: 1000 + index,
        hidden_reason: `reason ${index}`,
        hidden_by: 'op@example.com',
      })
      .where(eq(decks.id, id))
  }
}

test('F17-AC14: Given more hidden decks than one page shows, When the pages are followed, Then every deck is listed once with its reason, and the oldest can be released from the last page', async () => {
  await hideMany(PAGE_SIZE + 1)

  const first = await (await open('/')).text()
  expect(first).toContain(`（${PAGE_SIZE + 1} 件）`)
  expect(first).toContain(`@owner/deck-${PAGE_SIZE}`)
  expect(first).not.toContain('@owner/deck-0<')
  expect(first).toContain('href="/?page=2"')

  const second = await (await open('/?page=2')).text()
  expect(second).toContain('@owner/deck-0<')
  expect(second).toContain('reason 0')
  expect(second).toContain('action="/takedowns/deck-0/release"')
  expect(second).toContain('href="/?page=1"')
  expect(second).not.toContain('href="/?page=3"')
  const listed = (first + second).match(/@owner\/deck-\d+</g) ?? []
  expect(new Set(listed).size).toBe(PAGE_SIZE + 1)
  expect(listed).toHaveLength(PAGE_SIZE + 1)

  await post('/takedowns/deck-0/release', {})
  expect(await readTakedown(db, 'deck-0')).toBeNull()
  // The page asked for no longer exists; the last one that does is shown.
  const after = await (await open('/?page=2')).text()
  expect(after).toContain(`（${PAGE_SIZE} 件）`)
  expect(after).toContain(`@owner/deck-${PAGE_SIZE}`)
})
