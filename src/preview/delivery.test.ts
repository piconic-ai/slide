import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { contentSessions, uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { applyOperatorCommand } from '../publication/takedown-store'
import {
  resetTables,
  seedDeck,
  seedDeployment,
  signIn,
  TEST_ORIGIN,
  testEnv,
  viewerLaunch,
  postFrameLaunch,
  openOwnerSession,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await seedDeck(db, 'talk')
})
afterAll(() => platform.dispose())

/** A ready deployment with stored files. */
async function deploy(files: Record<string, string>) {
  const id = await seedDeployment(db, 'talk')
  for (const [index, [path, body]] of Object.entries(files).entries()) {
    const key = `deployments/${id}/files/${index}`
    await platform.env.UPLOADS.put(key, body)
    await orm.insert(uploadFiles).values({
      deployment_id: id,
      id: String(index),
      path,
      size: body.length,
      sha256: 'f'.repeat(63) + index,
      media_type: 'text/html; charset=utf-8',
      object_key: key,
    })
  }
  return id
}

const get = (id: string, path: string, headers: HeadersInit = {}) =>
  server.fetch(
    new Request(`https://d-${id}.content.example${path}`, { headers }),
    env,
  )

/**
 * Opens an owner-only session for the deployment, as the viewer's frame
 * does; returns its cookie, empty when the viewer offers none.
 */
const openAsOwner = (owner: string, id: string) =>
  openOwnerSession(env, owner, `/@owner/talk?v=${id}`)

let revision = 0
async function act(owner: string, body: Record<string, unknown>) {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/api/slides/talk/publication`, {
      method: 'POST',
      headers: {
        Cookie: owner,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...body, expectedRevision: revision }),
    }),
    env,
  )
  expect(response.status).toBe(200)
  revision++
}
beforeEach(() => {
  revision = 0
})

test('Given a draft, When fetched, Then only the owner session reads HTML and assets with private headers', async () => {
  const owner = await signIn(env)
  const draft = await deploy({ 'index.html': '<h1>B</h1>', 'a/app.js': 'x' })
  for (const path of ['/', '/index.html', '/a/app.js'])
    expect((await get(draft, path)).status).toBe(404)
  const session = await openAsOwner(owner, draft)
  const page = await get(draft, '/', { Cookie: session })
  expect(page.status).toBe(200)
  expect(await page.text()).toBe('<h1>B</h1>')
  expect(page.headers.get('Cache-Control')).toBe(
    'private, no-store, no-transform',
  )
  expect(page.headers.get('Referrer-Policy')).toBe('no-referrer')
  expect(page.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
  expect(page.headers.get('Content-Security-Policy')).toBe(
    `sandbox allow-scripts allow-same-origin; worker-src 'none'; frame-ancestors ${TEST_ORIGIN}`,
  )
  // Nothing is asked of the browser beyond the policy that is enforced.
  expect(page.headers.get('Content-Security-Policy-Report-Only')).toBeNull()
  expect((await get(draft, '/a/app.js', { Cookie: session })).status).toBe(200)
})

test('Given slides, When a browser posts a report where reports used to go, Then nothing answers there', async () => {
  const owner = await signIn(env)
  const a = await deploy({ 'index.html': 'A' })
  await act(owner, { action: 'publish', deploymentId: a })
  const response = await server.fetch(
    new Request(`https://d-${a}.content.example/_preview/reports`, {
      method: 'POST',
      body: JSON.stringify({
        'csp-report': { 'blocked-uri': 'https://a.example/' },
      }),
    }),
    env,
  )
  expect(response.status).toBe(404)
})

test('Given a public file a browser already holds, When it revalidates, Then the unchanged answer carries the policy', async () => {
  const owner = await signIn(env)
  const a = await deploy({ 'index.html': 'A' })
  await act(owner, { action: 'publish', deploymentId: a })
  const first = await get(a, '/')
  expect(first.status).toBe(200)
  const policy = first.headers.get('Content-Security-Policy')
  expect(policy).toContain('sandbox allow-scripts allow-same-origin')
  const again = await get(a, '/', {
    'If-None-Match': first.headers.get('ETag') ?? '',
  })
  expect(again.status).toBe(304)
  expect(again.headers.get('Content-Security-Policy')).toBe(policy)
})

test('F25-AC1, F25-AC4: Given public slides, When their files are fetched by a reader or by their owner, Then any site may frame them, and the sandbox that holds them stays', async () => {
  const owner = await signIn(env)
  const a = await deploy({ 'index.html': 'A', 'app.js': 'x' })
  const session = await openAsOwner(owner, a)
  await act(owner, { action: 'publish', deploymentId: a })
  const policy = `sandbox allow-scripts allow-same-origin; worker-src 'none'; frame-ancestors *`
  const readers: Record<string, string>[] = [{}, { Cookie: session }]
  for (const headers of readers)
    for (const path of ['/', '/app.js'])
      expect(
        (await get(a, path, headers)).headers.get('Content-Security-Policy'),
      ).toBe(policy)
  // Stopped, the files are gone for readers wherever they are framed.
  await act(owner, { action: 'pause' })
  expect((await get(a, '/')).status).toBe(404)
})

test('Given public A and draft B, When each is fetched, Then A is anonymous and revalidated, and B stays owner-only', async () => {
  const owner = await signIn(env)
  const a = await deploy({ 'index.html': 'A' })
  const b = await deploy({ 'index.html': 'B' })
  await act(owner, { action: 'publish', deploymentId: a })
  const publicPage = await get(a, '/')
  expect(publicPage.status).toBe(200)
  expect(publicPage.headers.get('Cache-Control')).toBe('no-cache, no-transform')
  const etag = publicPage.headers.get('ETag') ?? ''
  const revalidated = await get(a, '/', { 'If-None-Match': etag })
  expect(revalidated.status).toBe(304)
  expect(revalidated.headers.get('Cache-Control')).toBe(
    'no-cache, no-transform',
  )
  expect((await get(b, '/')).status).toBe(404)
  const session = await openAsOwner(owner, b)
  expect(await (await get(b, '/', { Cookie: session })).text()).toBe('B')
  // The session belongs to B's origin only.
  expect(
    (await get(a, '/', { Cookie: session })).headers.get('Cache-Control'),
  ).toBe('no-cache, no-transform')
}, 15_000)

test('Given B is published, When its owner session is used, Then it is revoked and A is no longer served', async () => {
  const owner = await signIn(env)
  const a = await deploy({ 'index.html': 'A' })
  const b = await deploy({ 'index.html': 'B' })
  await act(owner, { action: 'publish', deploymentId: a })
  const session = await openAsOwner(owner, b)
  await act(owner, { action: 'publish', deploymentId: b })
  expect((await get(b, '/', { Cookie: session })).status).toBe(200)
  expect(await orm.$count(contentSessions)).toBe(0)
  expect((await get(a, '/index.html')).status).toBe(404)
  // An explicit rollback brings A back.
  await act(owner, { action: 'publish', deploymentId: a })
  expect((await get(a, '/')).status).toBe(200)
  expect((await get(b, '/')).status).toBe(404)
})

test('Given a pause, When fetched, Then anonymous reads stop, owner sessions end, and the owner can reopen', async () => {
  const owner = await signIn(env)
  const a = await deploy({ 'index.html': 'A', 'img.png': 'png' })
  await act(owner, { action: 'publish', deploymentId: a })
  const b = await deploy({ 'index.html': 'B' })
  const session = await openAsOwner(owner, b)
  await act(owner, { action: 'pause' })
  for (const path of ['/', '/img.png'])
    expect((await get(a, path)).status).toBe(404)
  const ended = await get(b, '/', { Cookie: session })
  expect(ended.status).toBe(401)
  expect(await ended.text()).toContain('開き直してください')
  const reopened = await openAsOwner(owner, a)
  expect((await get(a, '/', { Cookie: reopened })).status).toBe(200)
  await act(owner, { action: 'resume' })
  expect((await get(a, '/')).status).toBe(200)
})

test('Given a launch issued before publishing, When used afterwards, Then it opens nothing', async () => {
  const owner = await signIn(env)
  const b = await deploy({ 'index.html': 'B' })
  const { action, token } = await viewerLaunch(
    env,
    owner,
    `/@owner/talk?v=${b}`,
  )
  await act(owner, { action: 'publish', deploymentId: b })
  const launched = await postFrameLaunch(env, action, token)
  expect(launched.status).toBe(403)
})

test('F02-AC33: Given an owner session of the viewer’s frame, When it is used near its end, Then it is not extended, and an expired one asks to reopen', async () => {
  const owner = await signIn(env)
  const b = await deploy({ 'index.html': 'B' })
  const session = await openAsOwner(owner, b)
  const now = Math.floor(Date.now() / 1000)
  await orm.update(contentSessions).set({ expires_at: now + 60 })
  expect((await get(b, '/', { Cookie: session })).status).toBe(200)
  const kept = await orm
    .select({ expires_at: contentSessions.expires_at })
    .from(contentSessions)
    .get()
  expect(kept?.expires_at).toBe(now + 60)
  await orm.update(contentSessions).set({ created_at: 0, expires_at: 1 })
  expect((await get(b, '/', { Cookie: session })).status).toBe(401)
})

test('Given an owner session cookie, When it is sent to the management API, Then it authenticates nothing', async () => {
  const owner = await signIn(env)
  const b = await deploy({ 'index.html': 'B' })
  const session = await openAsOwner(owner, b)
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/api/slides`, { headers: { Cookie: session } }),
    env,
  )
  expect(response.status).toBe(401)
})

test.each([
  ['a missing file', '/missing.html'],
  ['an encoded parent segment', '/a%2F..%2Findex.html'],
  ['the reserved prefix', '/_preview/launch'],
])(
  'Given %s, When the public deployment is fetched, Then it is not found',
  async (_, path) => {
    const owner = await signIn(env)
    const a = await deploy({ 'index.html': 'A' })
    await act(owner, { action: 'publish', deploymentId: a })
    expect((await get(a, path)).status).toBe(404)
  },
)

test('Given any deployment origin, When the script for pages is requested, Then it is served to everyone and tells only the viewer origin', async () => {
  const response = await get(crypto.randomUUID(), '/_preview/pages.js')
  expect(response.status).toBe(200)
  expect(response.headers.get('Content-Type')).toBe(
    'text/javascript; charset=utf-8',
  )
  expect(response.headers.get('Cache-Control')).toBe('public, max-age=300')
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  const script = await response.text()
  expect(script).toContain(`{ type: "slide:page", page }, "${TEST_ORIGIN}")`)
})

const hide = () =>
  applyOperatorCommand(db, {
    deckId: 'talk',
    command: { kind: 'hide', reason: 'fake sign-in page', operator: 'op' },
    now: 1,
  })

test.each([
  ['an owner-only draft', async () => {}],
  [
    'a public deck',
    async (owner: string, id: string) => {
      await act(owner, { action: 'publish', deploymentId: id })
    },
  ],
  [
    'a paused deck',
    async (owner: string, id: string) => {
      await act(owner, { action: 'publish', deploymentId: id })
      await act(owner, { action: 'pause' })
    },
  ],
])(
  'F17-AC7: Given %s, When an operator hides it, Then neither an anonymous reader nor the author reads its files, and the author cannot open it again',
  async (_, arrange) => {
    const owner = await signIn(env)
    const id = await deploy({ 'index.html': 'secret page' })
    await arrange(owner, id)
    // A session opened before the takedown, where the state allows one.
    const session = await openAsOwner(owner, id)
    await hide()

    const anonymous = await get(id, '/')
    expect(anonymous.status).toBe(404)
    expect(await anonymous.text()).not.toContain('secret page')
    if (session) {
      const asOwner = await get(id, '/', { Cookie: session })
      expect(asOwner.status).not.toBe(200)
      expect(await asOwner.text()).not.toContain('secret page')
    }
    const reopened = await viewerLaunch(env, owner, `/@owner/talk?v=${id}`)
    expect(reopened.status).toBe(404)
  },
)

const metadata = (site: string, mode: string, dest: string) => ({
  'Sec-Fetch-Site': site,
  'Sec-Fetch-Mode': mode,
  'Sec-Fetch-Dest': dest,
})

test.each([
  ['a script another deployment pulls in', 'same-site', 'no-cors', 'script'],
  ['a fetch from another deployment', 'same-site', 'cors', 'empty'],
  ['an image on another site', 'cross-site', 'no-cors', 'image'],
  ['a frame inside another deployment', 'same-site', 'navigate', 'iframe'],
  [
    'a frame of another site, or through one',
    'cross-site',
    'navigate',
    'iframe',
  ],
  ['an address typed at the top level', 'none', 'navigate', 'document'],
  ['a top-level link from another site', 'cross-site', 'navigate', 'document'],
])(
  'F17-AC1: Given a draft and its owner session, When the request is %s, Then the draft is answered as to an anonymous reader',
  async (_, site, mode, dest) => {
    const owner = await signIn(env)
    const draft = await deploy({ 'index.html': '<h1>B</h1>', 'a/app.js': 'x' })
    const session = await openAsOwner(owner, draft)
    // The same request without the session: a frame is told apart, so it is
    // answered by the same request without the cookie.
    const anonymous = await get(draft, '/a/app.js', metadata(site, mode, dest))
    const response = await get(draft, '/a/app.js', {
      Cookie: session,
      ...metadata(site, mode, dest),
    })
    expect(response.status).toBe(anonymous.status)
    // Each answer carries its own nonce.
    const bare = async (answer: Response) =>
      (await answer.text()).replace(/nonce="[^"]+"/, '')
    expect(await bare(response)).toBe(await bare(anonymous))
    expect(response.status).not.toBe(200)
  },
)

test.each([
  ['the draft’s own subresource', 'same-origin', 'no-cors', 'script'],
  [
    'the frame moving itself after the launch',
    'same-origin',
    'navigate',
    'iframe',
  ],
])(
  'F17-AC1: Given a draft and its owner session, When the request is %s, Then the owner reads the file and no other origin may embed it',
  async (_, site, mode, dest) => {
    const owner = await signIn(env)
    const draft = await deploy({ 'index.html': '<h1>B</h1>', 'a/app.js': 'x' })
    const session = await openAsOwner(owner, draft)
    const response = await get(draft, '/a/app.js', {
      Cookie: session,
      ...metadata(site, mode, dest),
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('x')
    expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe(
      'same-origin',
    )
  },
)

test('F17-AC1: Given a published deck and its owner session, When another deployment pulls in a file, Then it gets the public file, as any reader would', async () => {
  const owner = await signIn(env)
  const a = await deploy({ 'index.html': 'A', 'a/app.js': 'x' })
  const session = await openAsOwner(owner, a)
  await act(owner, { action: 'publish', deploymentId: a })
  const response = await get(a, '/a/app.js', {
    Cookie: session,
    ...metadata('same-site', 'no-cors', 'script'),
  })
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).not.toContain('private')
})
