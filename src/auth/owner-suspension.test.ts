import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import {
  accounts,
  decks,
  previewLaunches,
  profiles,
  reactionPosts,
  reports,
  suspensions,
} from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { applySuspensionCommand } from '../publication/suspension-store'
import {
  INVITED_ID,
  OWNER_ID,
  resetTables,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = withInvited(testEnv(platform.env))
const reason = 'Repeated abuse <script>alert("stop")</script> & impersonation'
const operator = 'private-operator@example.com'
const suspendedAt = 1794952800
const title = 'Private management title'
const slug = 'private-talk'
const deckId = 'owner-deck'
const slide = '/@reader/public-talk'
let cookie = ''
let reader = ''
let deploymentId = ''

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetTables(database)
  cookie = await signIn(env)
  reader = await signIn(env, 'reader', { id: INVITED_ID })
  deploymentId = await seedPublic(database, deckId, 1, title, OWNER_ID, slug)
  await seedPublic(
    database,
    'reader-deck',
    1,
    'Reader talk',
    INVITED_ID,
    'public-talk',
  )
  await applySuspensionCommand(database, {
    userId: OWNER_ID,
    command: { kind: 'suspend', reason, operator },
    now: suspendedAt,
  })
})
afterAll(() => platform.dispose())

const send = (path: string, session = cookie, init: RequestInit = {}) => {
  const headers = new Headers(init.headers)
  headers.set('Cookie', session)
  return server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, { ...init, headers }),
    env,
  )
}

const post = (
  path: string,
  fields: Record<string, string> = {},
  session = cookie,
  origin: string | null = TEST_ORIGIN,
) =>
  send(path, session, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(origin === null ? {} : { Origin: origin }),
    },
    body: new URLSearchParams(fields),
  })

const ownerDeck = () =>
  db.select().from(decks).where(eq(decks.id, deckId)).get()
const suspensionRows = () => db.select().from(suspensions)

test.each([
  ['ja', 'アカウントは停止中です', '停止した日時'],
  ['en', 'Your account is suspended', 'Suspended at'],
])(
  'F17-AC32: Given a suspended owner using %s, When opening the dashboard, Then only the escaped notice, contact and account actions are shown',
  async (lang, heading, timeLabel) => {
    const response = await send(`/slides?lang=${lang}`)
    expect(response.status).toBe(403)
    expect(response.headers.get('Content-Type')).toContain('text/html')
    expect(response.headers.get('Cache-Control')).toContain('no-store')
    expect(response.headers.get('Content-Security-Policy')).toContain(
      "form-action 'self'",
    )
    const page = await response.text()
    expect(page).toContain(`<html lang="${lang}">`)
    expect(page).toContain(`<h1>${heading}</h1>`)
    expect(page).toContain('Repeated abuse &lt;script&gt;')
    expect(page).toContain('&lt;/script&gt; &amp; impersonation')
    expect(page).not.toContain('<script>')
    expect(page).toContain(timeLabel)
    expect(page).toContain(
      `datetime="${new Date(suspendedAt * 1000).toISOString()}"`,
    )
    expect(page).toContain('href="/contact"')
    expect(page).toContain('contact@slide.community')
    expect(page).toContain('action="/account/delete"')
    expect(page).toContain('name="confirm"')
    expect(page).toContain('action="/auth/logout"')
    // The header shows no account area: asking who is signed in is refused
    // for a suspended owner, and would draw them the way in, or a menu kept
    // from before. Signing out and leaving are in the page itself.
    expect(page).toContain('<header class="site-header">')
    expect(page).not.toContain('data-account')
    expect(page).not.toContain('href="/auth/github"')
    expect(page).not.toContain('<noscript>')
    for (const absent of [
      title,
      slug,
      operator,
      '/slides/new',
      '/slides/connect',
      '/publication',
      '/uploads',
    ])
      expect(page).not.toContain(absent)
  },
)

test.each(['/slides', `/slides/${slug}`, '/settings', '/auth/owner'])(
  'F17-AC32: Given a suspended owner, When opening %s, Then the same suspended page is returned',
  async (path) => {
    const response = await send(path)
    expect(response.status).toBe(403)
    expect(await response.text()).toContain('アカウントは停止中です')
  },
)

test.each([
  '/api/slides',
  `/api/slides/${slug}/publication`,
  `/api/slides/${slug}/deployments`,
  '/api/session',
])(
  'F17-AC32: Given a suspended owner, When reading %s, Then JSON says Account suspended without private details',
  async (path) => {
    const response = await send(path)
    expect(response.status).toBe(403)
    expect(response.headers.get('Content-Type')).toContain('application/json')
    expect(response.headers.get('Cache-Control')).toContain('no-store')
    expect(await response.json()).toEqual({ error: 'Account suspended' })
  },
)

test.each(['publish', 'pause', 'resume', 'set_mode'])(
  'F17-AC32: Given a suspended owner, When posting %s through the publication form and API, Then both refuse it and stored publication is unchanged',
  async (action) => {
    const before = await ownerDeck()
    expect(before).toBeDefined()
    const fields: Record<string, string> = {
      action,
      expectedRevision: String(before?.revision),
      ...(action === 'publish' ? { deploymentId } : {}),
      ...(action === 'set_mode' ? { mode: 'repository' } : {}),
    }
    const form = await post(`/slides/${slug}/publication`, fields)
    expect(form.status).toBe(403)
    expect(await form.text()).toContain('アカウントは停止中です')
    const api = await send(`/api/slides/${slug}/publication`, cookie, {
      method: 'POST',
      headers: { Origin: TEST_ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fields, expectedRevision: before?.revision }),
    })
    expect(api.status).toBe(403)
    expect(await api.json()).toEqual({ error: 'Account suspended' })
    expect(await ownerDeck()).toEqual(before)
  },
)

test('F17-AC32: Given a suspended owner, When launching a preview, Then no preview is created', async () => {
  const response = await post(
    `/slides/${slug}/deployments/${deploymentId}/preview`,
  )
  expect(response.status).toBe(403)
  expect(response.headers.get('Location')).toBeNull()
  expect(await response.text()).toContain('アカウントは停止中です')
  expect(await db.select().from(previewLaunches)).toEqual([])
})

test('F17-AC33: Given a suspended owner, When deleting one deck, Then it is refused and the entire deck row remains unchanged', async () => {
  const before = await ownerDeck()
  expect(before?.deleted_at).toBeNull()
  const response = await post(`/slides/${slug}/delete`, { confirm: slug })
  expect(response.status).toBe(403)
  expect(await response.text()).toContain('アカウントは停止中です')
  expect(await ownerDeck()).toEqual(before)
})

test('F17-AC33: Given a suspended owner, When confirming account deletion, Then their decks and profile disappear but the suspension remains', async () => {
  const before = await suspensionRows()
  expect(
    await db.select().from(profiles).where(eq(profiles.user_id, OWNER_ID)),
  ).toHaveLength(1)
  const response = await post('/account/delete', { confirm: 'Owner' })
  expect(response.status).toBe(303)
  expect(response.headers.get('Location')).toBe('/')
  // Account deletion keeps deck rows for the existing asynchronous purge.
  expect(await ownerDeck()).toMatchObject({
    deleted_at: expect.any(Number),
    public_deployment_id: null,
  })
  expect(
    await db.select().from(accounts).where(eq(accounts.user_id, OWNER_ID)),
  ).toEqual([])
  expect(
    await db.select().from(profiles).where(eq(profiles.user_id, OWNER_ID)),
  ).toEqual([])
  expect(await suspensionRows()).toEqual(before)
  expect((await send('/api/slides')).status).toBe(401)
  expect((await send('/@owner')).status).toBe(404)
  expect((await send(`/@owner/${slug}`)).status).toBe(404)
  expect((await send(slide, reader)).status).toBe(200)
})

test.each([null, 'https://elsewhere.example'])(
  'F17-AC33: Given a suspended owner and Origin %j, When posting account deletion, Then CSRF protection refuses it and the account remains',
  async (origin) => {
    const before = await ownerDeck()
    const response = await post(
      '/account/delete',
      { confirm: 'owner' },
      cookie,
      origin,
    )
    expect(response.status).toBe(403)
    expect(await ownerDeck()).toEqual(before)
    expect(
      await db.select().from(accounts).where(eq(accounts.user_id, OWNER_ID)),
    ).toHaveLength(1)
  },
)

test('F17-AC33: Given a suspended owner, When the account confirmation is wrong, Then deletion is refused and the account remains', async () => {
  const before = await ownerDeck()
  const response = await post('/account/delete', { confirm: 'someone-else' })
  expect(response.status).toBe(400)
  expect(await response.text()).toContain('一致しません')
  expect(await ownerDeck()).toEqual(before)
  expect(
    await db.select().from(accounts).where(eq(accounts.user_id, OWNER_ID)),
  ).toHaveLength(1)
})

test('F17-AC30: Given a suspended owner who deleted their account, When signing in again with the same GitHub ID, Then the same suspension reason is shown', async () => {
  const before = await suspensionRows()
  expect((await post('/account/delete', { confirm: 'owner' })).status).toBe(303)
  const again = await signIn(env)
  expect(again).not.toBe('')
  const response = await send('/slides', again)
  expect(response.status).toBe(403)
  expect(await response.text()).toContain('Repeated abuse &lt;script&gt;')
  expect(await suspensionRows()).toEqual(before)
})

test('F17-AC31: Given a suspended reader of another author’s deck, When opening or submitting a report, Then the suspended notice is shown and nothing is stored', async () => {
  const form = await send(`/reports/new?slide=${encodeURIComponent(slide)}`)
  const submitted = await post('/reports', { slide, reason: 'nuisance' })
  for (const response of [form, submitted]) {
    expect(response.status).toBe(403)
    expect(await response.text()).toContain('アカウントは停止中です')
  }
  expect(await db.select().from(reports)).toEqual([])
})

test('F17-AC31: Given a suspended owner, When posting a reaction, Then the suspended notice is shown and nothing is stored', async () => {
  const response = await post(`/slides/${slug}/reactions`, {
    url: 'https://x.com/owner/status/1830000000000000000',
  })
  expect(response.status).toBe(403)
  expect(await response.text()).toContain('アカウントは停止中です')
  expect(await db.select().from(reactionPosts)).toEqual([])
})

test('F17-AC32: Given a suspended owner, When signing in and opening their slides, Then sign-in succeeds and the list is the suspended page', async () => {
  const again = await signIn(env)
  expect(again).not.toBe('')
  const dashboard = await send('/slides', again)
  expect(dashboard.status).toBe(403)
  expect(await dashboard.text()).toContain('アカウントは停止中です')
})

test('F17-AC32: Given a suspended owner, When signing out, Then the session is ended', async () => {
  const response = await post('/auth/logout')
  expect(response.status).toBe(303)
  expect(response.headers.get('Location')).toBe('/')
  expect(
    response.headers
      .getSetCookie()
      .some((value) => /^__Host-slide_owner=;.*Max-Age=0/.test(value)),
  ).toBe(true)
  expect((await send('/auth/owner')).status).toBe(401)
  expect((await send('/api/slides')).status).toBe(401)
})

test.each([slide, '/@reader'])(
  'F17-AC32: Given a suspended reader, When opening another author’s public page %s, Then it remains readable',
  async (path) => {
    const response = await send(path)
    expect(response.status).toBe(200)
    const page = await response.text()
    expect(page).toContain('Reader talk')
    expect(page).not.toContain('アカウントは停止中です')
  },
)

test('F17-AC32: Given a suspended owner with an active session, When the suspension row is deleted, Then the same session can manage and publish again', async () => {
  expect((await send('/slides')).status).toBe(403)
  await db.delete(suspensions).where(eq(suspensions.user_id, OWNER_ID))
  const response = await send('/slides')
  expect(response.status).toBe(200)
  expect(await response.text()).toContain(slug)
  const before = await ownerDeck()
  const publication = await post(`/slides/${slug}/publication`, {
    action: 'pause',
    expectedRevision: String(before?.revision),
  })
  expect(publication.status).toBe(303)
  expect(publication.headers.get('Location')).toContain('result=applied')
  expect((await ownerDeck())?.paused_at).toEqual(expect.any(Number))
})

test('F17-AC32: Given another owner who is not suspended, When reading their management pages and API, Then their normal access is unaffected', async () => {
  for (const path of ['/slides', '/slides/public-talk', '/settings']) {
    const response = await send(path, reader)
    expect(response.status).toBe(200)
    expect(await response.text()).not.toContain('アカウントは停止中です')
  }
  const owner = await send('/auth/owner', reader)
  expect(owner.status).toBe(200)
  expect(await owner.json()).toEqual({ userId: INVITED_ID, login: 'reader' })
  expect((await send('/api/slides', reader)).status).toBe(200)
  expect(
    (await send('/api/slides/public-talk/publication', reader)).status,
  ).toBe(200)
})
