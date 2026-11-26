import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { decks, deployments } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { placeFiles } from '../exports/test-upload'
import { HELP_CATALOG } from '../help/default-catalog'
import { callTool, connectAgent, mcpClient } from '../mcp/test-connect'
import {
  INVITED_ID,
  keepInvited,
  OWNER_ID,
  emailOf,
  lastCode,
  resetTables,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

// Each test puts slides up over HTTP; a loaded machine needs more than 5 s.
vi.setConfig({ testTimeout: 30_000 })

type Row = {
  indexes: string[]
  blobs: string[]
  doubles: number[]
}
const written: Row[] = []
const dataset = {
  writeDataPoint: (row: Row) => {
    written.push(structuredClone(row))
  },
}

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const orm = drizzle(database)
const base = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
  UPLOAD_LIMITS: { activeSessions: 20, startsPerDay: 1000, files: 500 },
} as unknown as Env
const env = { ...base, ANALYTICS: dataset } as unknown as Env

beforeAll(() => applyMigrations(database))
afterAll(() => platform.dispose())

let alice = ''
let bob = ''
beforeEach(async () => {
  await resetTables(database)
  alice = await signIn(env, 'alice')
  bob = await signIn(env, 'bob', { id: INVITED_ID })
  written.length = 0
}, 30_000)

/** The rows of one kind of event written since the last reset. */
const eventsOf = (name: string) =>
  written.filter((row) => row.indexes[0] === name)
/** What an event's row holds: detail, referrer, language, subject, screen. */
const blobsOf = (name: string) => eventsOf(name).map((row) => row.blobs)

const request = (
  path: string,
  init: {
    cookie?: string
    referer?: string
    fields?: Record<string, string>
    json?: unknown
    target?: Env
  } = {},
) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      method: init.fields || init.json ? 'POST' : 'GET',
      headers: {
        ...(init.cookie ? { Cookie: init.cookie } : {}),
        ...(init.referer ? { Referer: init.referer } : {}),
        ...(init.fields
          ? {
              Origin: TEST_ORIGIN,
              'Content-Type': 'application/x-www-form-urlencoded',
            }
          : {}),
        ...(init.json
          ? { Origin: TEST_ORIGIN, 'Content-Type': 'application/json' }
          : {}),
      },
      body: init.fields
        ? new URLSearchParams(init.fields).toString()
        : init.json
          ? JSON.stringify(init.json)
          : undefined,
    }),
    init.target ?? env,
  )

const deckIdOf = async (slug: string) =>
  (
    await orm
      .select({ id: decks.id })
      .from(decks)
      .where(eq(decks.slug, slug))
      .get()
  )?.id ?? ''

const HTML = '<!doctype html><title>Talk</title><h1>Hi</h1>'
const publishVersion = (
  slug: string,
  deploymentId: string,
  revision = 0,
  cookie = alice,
  target: Env = env,
) =>
  request(`/api/slides/${slug}/publication`, {
    cookie,
    json: { action: 'publish', deploymentId, expectedRevision: revision },
    target,
  })

test('F40-AC4: Given a person who asks for a login code and enters a wrong one and then the right one, When each is counted, Then the codes sent and the codes entered are counted separately', async () => {
  const address = emailOf('carol')
  await signIn(env, 'carol', { id: '77' }).then(() => (written.length = 0))
  await request('/login', { fields: { email: address } })
  expect(eventsOf('login_code_sent')).toHaveLength(1)
  expect(eventsOf('login_code_entered')).toHaveLength(0)

  await request('/login/code', { fields: { email: address, code: '000000' } })
  expect(blobsOf('login_code_entered').map(([detail]) => detail)).toEqual([
    'rejected',
  ])
  await request('/login/code', {
    fields: { email: address, code: await lastCode(database, address) },
  })
  expect(blobsOf('login_code_entered').map(([detail]) => detail)).toEqual([
    'rejected',
    'accepted',
  ])
  expect(eventsOf('login_code_sent')).toHaveLength(1)
})

test('F40-AC4: Given an address that is not invited, When it asks for a code, Then no code is counted as sent', async () => {
  await request('/login', { fields: { email: 'stranger@mail.example' } })
  expect(eventsOf('login_code_sent')).toHaveLength(0)
})

test('F40-AC1, F40-AC5: Given an author who puts a new slide up and then a new version of it, When each is counted, Then each start and each finish is one more', async () => {
  const placed = await placeFiles(env, alice, { 'index.html': HTML })
  expect(blobsOf('upload_started')).toEqual([['browser', '', '', '', '']])
  const deckId = await deckIdOf(placed.slug)
  expect(blobsOf('upload_finished')).toEqual([['browser', '', '', deckId, '']])

  await placeFiles(env, alice, { 'index.html': `${HTML}2` }, placed.slug)
  expect(eventsOf('upload_started')).toHaveLength(2)
  expect(eventsOf('upload_finished')).toHaveLength(2)
})

test('F40-AC5: Given an upload that is started and never finished, When it is counted, Then it is a start with no finish', async () => {
  const started = await request('/api/slides', {
    cookie: alice,
    json: {
      attempt: 'metrics-attempt-0000001',
      entry: 'index.html',
      files: [{ path: 'index.html', size: 3, sha256: '0'.repeat(64) }],
    },
  })
  expect(started.status).toBe(201)
  expect(eventsOf('upload_started')).toHaveLength(1)
  expect(eventsOf('upload_finished')).toHaveLength(0)
})

test('F40-AC5: Given a start that is sent again with the same attempt, When it is counted, Then it is not a second start', async () => {
  const send = () =>
    request('/api/slides', {
      cookie: alice,
      json: {
        attempt: 'metrics-attempt-0000002',
        entry: 'index.html',
        files: [{ path: 'index.html', size: 3, sha256: '0'.repeat(64) }],
      },
    })
  expect((await send()).status).toBe(201)
  expect((await send()).status).toBe(201)
  expect(eventsOf('upload_started')).toHaveLength(1)
})

test('F40-AC5: Given a finalize that is sent twice, When it is counted, Then the version is finished once', async () => {
  const bytes = new TextEncoder().encode(HTML)
  const digest = Buffer.from(
    await crypto.subtle.digest('SHA-256', bytes),
  ).toString('hex')
  const started = await request('/api/slides', {
    cookie: alice,
    json: {
      attempt: 'metrics-attempt-0000009',
      entry: 'index.html',
      files: [{ path: 'index.html', size: bytes.length, sha256: digest }],
    },
  })
  const receipt = (await started.json()) as {
    deploymentId: string
    credential: string
  }
  const auth = { Authorization: `Bearer ${receipt.credential}` }
  await server.fetch(
    new Request(`${TEST_ORIGIN}/api/uploads/${receipt.deploymentId}/files/0`, {
      method: 'PUT',
      headers: auth,
      body: bytes,
    }),
    env,
  )
  const finalize = () =>
    server.fetch(
      new Request(
        `${TEST_ORIGIN}/api/uploads/${receipt.deploymentId}/finalize`,
        { method: 'POST', headers: auth },
      ),
      env,
    )
  expect((await finalize()).status).toBe(200)
  expect((await finalize()).status).toBe(200)
  expect(eventsOf('upload_finished')).toHaveLength(1)
})

test.each([
  ['file_too_large', { fileBytes: 10 }, { 'index.html': HTML }],
  ['too_many_files', { files: 1 }, { 'index.html': HTML, 'a.css': 'b{}' }],
  [
    'deployment_too_large',
    { fileBytes: 30, deploymentBytes: 40 },
    { 'index.html': '<!doctype html>', 'a.css': 'x'.repeat(30) },
  ],
])(
  'F40-AC6: Given a start refused for %s, When it is counted, Then that reason is one more and no start is counted',
  async (reason, limits, files) => {
    const limited = {
      ...env,
      UPLOAD_LIMITS: { activeSessions: 20, startsPerDay: 1000, ...limits },
    } as unknown as Env
    await expect(placeFiles(limited, alice, files)).rejects.toThrow(
      /start failed/,
    )
    expect(blobsOf('upload_refused')).toEqual([[reason, '', '', '', '']])
    expect(eventsOf('upload_started')).toHaveLength(0)
  },
)

test('F40-AC6: Given a start refused because the day’s starts are used up, When it is counted, Then daily_starts_exceeded is one more', async () => {
  const limited = {
    ...env,
    UPLOAD_LIMITS: { activeSessions: 20, startsPerDay: 1 },
  } as unknown as Env
  await placeFiles(limited, alice, { 'index.html': HTML })
  await expect(
    placeFiles(limited, alice, { 'index.html': `${HTML}2` }),
  ).rejects.toThrow(/start failed/)
  expect(blobsOf('upload_refused').map(([detail]) => detail)).toEqual([
    'daily_starts_exceeded',
  ])
})

test('F40-AC6: Given an author who holds as many slides as allowed, When they start another, Then deck_limit is one more', async () => {
  const limited = {
    ...env,
    UPLOAD_LIMITS: { activeSessions: 20, startsPerDay: 1000, decks: 1 },
  } as unknown as Env
  await placeFiles(limited, alice, { 'index.html': HTML })
  await expect(
    placeFiles(limited, alice, { 'index.html': `${HTML}2` }),
  ).rejects.toThrow(/start failed/)
  expect(blobsOf('upload_refused').map(([detail]) => detail)).toEqual([
    'deck_limit',
  ])
})

test('F40-AC6: Given someone who is not an author, When they start an upload, Then not_allowed is one more', async () => {
  // Signed in, then taken off the invitations since.
  const stranger = await signIn(env, 'dave', { id: '4242' })
  await keepInvited(database, [OWNER_ID, INVITED_ID])
  written.length = 0
  const response = await request('/api/slides', {
    cookie: stranger,
    json: {
      attempt: 'metrics-attempt-0000003',
      entry: 'index.html',
      files: [{ path: 'index.html', size: 3, sha256: '0'.repeat(64) }],
    },
  })
  expect(response.status).toBe(403)
  expect(blobsOf('upload_refused')).toEqual([['not_allowed', '', '', '', '']])
  expect(eventsOf('upload_started')).toHaveLength(0)
})

test('F40-AC2, F40-AC7: Given a version put up two minutes ago, When it is made public, Then the published slide is one more, with the wait', async () => {
  const placed = await placeFiles(env, alice, { 'index.html': HTML })
  await orm
    .update(deployments)
    .set({ ready_at: Math.floor(Date.now() / 1000) - 120 })
    .where(eq(deployments.id, placed.deploymentId))
  expect((await publishVersion(placed.slug, placed.deploymentId)).status).toBe(
    200,
  )

  const [row] = eventsOf('deck_published')
  expect(row?.blobs).toEqual(['', '', 'ja', await deckIdOf(placed.slug), ''])
  expect(row?.doubles[0]).toBeGreaterThanOrEqual(120)
  expect(row?.doubles[0]).toBeLessThan(130)
  expect(eventsOf('deck_published')).toHaveLength(1)

  // The same version again changes nothing, so it counts nothing.
  await publishVersion(placed.slug, placed.deploymentId, 1)
  expect(eventsOf('deck_published')).toHaveLength(1)
})

test('F40-AC3, F40-AC10: Given a public slide, When a reader opens it from another site, Then the opened slide is one more with the referrer’s host only', async () => {
  const placed = await placeFiles(env, alice, { 'index.html': HTML })
  await publishVersion(placed.slug, placed.deploymentId)
  written.length = 0

  const opened = await request(`/@alice/${placed.slug}`, {
    referer: 'https://news.example/path/to/post?utm=1&who=someone#frag',
  })
  expect(opened.status).toBe(200)
  expect(blobsOf('deck_opened')).toEqual([
    ['page', 'news.example', 'ja', await deckIdOf(placed.slug), ''],
  ])

  await request(`/@alice/${placed.slug}`, { referer: `${TEST_ORIGIN}/@bob/x` })
  await request(`/@alice/${placed.slug}`)
  expect(blobsOf('deck_opened').map(([, referrer]) => referrer)).toEqual([
    'news.example',
    'internal',
    '',
  ])
})

test('F40-AC3: Given a public slide, When its author opens it, Then it is not counted as read', async () => {
  const placed = await placeFiles(env, alice, { 'index.html': HTML })
  await publishVersion(placed.slug, placed.deploymentId)
  written.length = 0
  await request(`/@alice/${placed.slug}`, { cookie: alice })
  expect(eventsOf('deck_opened')).toHaveLength(0)
})

test('F40-AC11: Given a public slide, When it is opened in an embed on another site, Then it is counted apart from the page views', async () => {
  const placed = await placeFiles(env, alice, { 'index.html': HTML })
  await publishVersion(placed.slug, placed.deploymentId)
  written.length = 0

  const embedded = await request(`/embed/@alice/${placed.slug}`, {
    referer: 'https://blog.example/entry/1',
  })
  expect(embedded.status).toBe(200)
  expect(blobsOf('deck_opened')).toEqual([
    ['embed', 'blog.example', 'ja', await deckIdOf(placed.slug), ''],
  ])
  await request(`/@alice/${placed.slug}`)
  expect(blobsOf('deck_opened').map(([detail]) => detail)).toEqual([
    'embed',
    'page',
  ])
})

test('F40-AC3: Given a slide that is not public, When someone opens it, Then nothing is counted', async () => {
  const placed = await placeFiles(env, alice, { 'index.html': HTML })
  written.length = 0
  const response = await request(`/@alice/${placed.slug}`, {
    referer: 'https://news.example/',
  })
  expect(response.status).toBe(404)
  expect(eventsOf('deck_opened')).toHaveLength(0)
})

test('F40-AC8: Given an author who adds a related link, When it is counted, Then one more related link is counted, and a refused link is not', async () => {
  const placed = await placeFiles(env, alice, { 'index.html': HTML })
  written.length = 0
  await request(`/slides/${placed.slug}/links`, {
    cookie: alice,
    fields: { kind: 'video', url: 'not a url', title: '' },
  })
  expect(eventsOf('related_link_added')).toHaveLength(0)
  await request(`/slides/${placed.slug}/links`, {
    cookie: alice,
    fields: {
      kind: 'video',
      url: 'https://www.youtube.com/watch?v=abc',
      title: '',
    },
  })
  expect(blobsOf('related_link_added')).toEqual([
    ['', '', 'ja', await deckIdOf(placed.slug), ''],
  ])
})

test('F40-AC8: Given an author who saves and publishes the article of a slide, When it is counted, Then one more article is counted, and a stale press is not', async () => {
  const placed = await placeFiles(env, alice, { 'index.html': HTML })
  const send = (path: string, fields: Record<string, string>) =>
    request(`/slides/${placed.slug}/article${path}`, { cookie: alice, fields })
  expect(
    (await send('/autosave', { body: 'Hello', revision: '' })).status,
  ).toBe(200)
  const stale = await send('/publication', { action: 'publish', revision: '9' })
  expect(stale.status).toBe(409)
  expect(eventsOf('article_published')).toHaveLength(0)

  const done = await send('/publication', { action: 'publish', revision: '1' })
  expect(done.status).toBe(303)
  expect(blobsOf('article_published')).toEqual([
    ['', '', 'ja', await deckIdOf(placed.slug), ''],
  ])
})

test('F40-AC8: Given a person who follows an author, When it is counted, Then one more follow is counted, and following again is not', async () => {
  const follow = () =>
    request('/follows', {
      cookie: bob,
      fields: { handle: 'alice', slide: '/@alice' },
    })
  await follow()
  expect(eventsOf('author_followed')).toHaveLength(1)
  await follow()
  expect(eventsOf('author_followed')).toHaveLength(1)
})

test('F40-AC8: Given a person who makes a community and another who follows it, When they are counted, Then each is one more', async () => {
  const made = await request('/communities/new', {
    cookie: alice,
    fields: {
      handle: 'kanagawapm',
      name: 'Kanagawa.pm',
      link: 'https://kanagawapm.connpass.com/',
    },
  })
  expect(made.status).toBe(303)
  expect(eventsOf('community_created')).toHaveLength(1)
  const [created] = blobsOf('community_created')
  expect(created?.[3]).toMatch(/^\d+$/)

  await request('/communities/follows', {
    cookie: bob,
    fields: { handle: 'kanagawapm', back: '/@kanagawapm' },
  })
  expect(blobsOf('community_followed')).toEqual([
    ['', '', 'ja', created?.[3] ?? '', ''],
  ])
})

test('F40-AC8: Given a slide that links to another slide, When it is put up, Then one more citation is counted', async () => {
  const target = await placeFiles(env, alice, { 'index.html': HTML })
  await publishVersion(target.slug, target.deploymentId)
  written.length = 0
  await placeFiles(env, alice, {
    'index.html': `<!doctype html><title>B</title><a href="${TEST_ORIGIN}/@alice/${target.slug}">see</a>`,
  })
  expect(eventsOf('citation_made')).toHaveLength(1)
  await placeFiles(env, alice, { 'index.html': `${HTML} no link` })
  expect(eventsOf('citation_made')).toHaveLength(1)
})

test('F40-AC8: Given an author who downloads an export, When it is counted, Then one more download of that kind is counted, and a HEAD is not', async () => {
  const placed = await placeFiles(env, alice, { 'index.html': HTML })
  await publishVersion(placed.slug, placed.deploymentId)
  written.length = 0
  const account = await request('/account/export/account.json', {
    cookie: alice,
  })
  expect(account.status).toBe(200)
  await request(`/slides/${placed.slug}/export/slide.json`, { cookie: alice })
  const head = await server.fetch(
    new Request(`${TEST_ORIGIN}/slides/${placed.slug}/export/published.zip`, {
      method: 'HEAD',
      headers: { Cookie: alice },
    }),
    env,
  )
  await head.arrayBuffer()
  await request(`/slides/${placed.slug}/export/published.zip`, {
    cookie: alice,
  }).then((response) => response.arrayBuffer())
  expect(blobsOf('export_downloaded').map(([detail]) => detail)).toEqual([
    'account',
    'info',
    'slide',
  ])
  // Someone who is not signed in gets nothing, so nothing is counted.
  written.length = 0
  await request('/account/export/account.json')
  expect(eventsOf('export_downloaded')).toHaveLength(0)
})

test('F40-AC8: Given a site that asks how to embed a public slide, When it is answered, Then one more embed is counted, and an unknown slide is not', async () => {
  const placed = await placeFiles(env, alice, { 'index.html': HTML })
  await publishVersion(placed.slug, placed.deploymentId)
  written.length = 0
  const ask = (slug: string) =>
    request(
      `/oembed?url=${encodeURIComponent(`${TEST_ORIGIN}/@alice/${slug}`)}&format=json`,
    )
  expect((await ask(placed.slug)).status).toBe(200)
  expect((await ask('nothing')).status).toBe(404)
  expect(eventsOf('oembed_served')).toHaveLength(1)
})

test('F40-AC9: Given an agent that calls tools, When they are counted, Then each call is counted under its tool', async () => {
  const { tokens } = await connectAgent(env, alice)
  const client = await mcpClient(env, tokens.access_token)
  written.length = 0
  await callTool(client, 'list_slides')
  await callTool(client, 'list_slides')
  await callTool(client, 'put_slide', {
    files: [{ path: 'index.html', text: HTML }],
  })
  expect(blobsOf('mcp_tool_called').map(([detail]) => detail)).toEqual([
    'list_slides',
    'list_slides',
    'put_slide',
  ])
  // The upload the agent made is counted as one that came from an agent.
  expect(blobsOf('upload_started').map(([detail]) => detail)).toEqual(['mcp'])
  expect(blobsOf('upload_finished').map(([detail]) => detail)).toEqual(['mcp'])
  await client.close()
})

test('F40-AC12: Given a help search that finds nothing, When it is counted, Then the word is kept up to 50 characters, and a search that finds something is not kept', async () => {
  const word = 'ぜんぜんそんなものはない'.repeat(6)
  expect((await request(`/help?q=${encodeURIComponent(word)}`)).status).toBe(
    200,
  )
  const [kept] = blobsOf('help_search_empty')
  expect([...(kept?.[0] ?? '')]).toHaveLength(50)
  expect(kept?.[0]).toBe(word.slice(0, 50))

  written.length = 0
  const title = HELP_CATALOG[0]?.article.ja.title ?? ''
  const found = await request(`/help?q=${encodeURIComponent(title)}`)
  expect(found.status).toBe(200)
  expect(await found.text()).toContain(title)
  expect(eventsOf('help_search_empty')).toHaveLength(0)
})

test('F40-AC12, F40-AC15: Given a help search for an email address or an IP address, When it finds nothing, Then nothing of it is kept', async () => {
  await request(`/help?q=${encodeURIComponent('me@example.com')}`)
  await request(`/help?q=${encodeURIComponent('203.0.113.9')}`)
  await request('/help?q=%20%20')
  expect(eventsOf('help_search_empty')).toHaveLength(0)
})

test('F40-AC13: Given a help article that is opened, and the contact page opened from it, When they are counted, Then each is one more under the article', async () => {
  const entry = HELP_CATALOG[0]!
  const path = `/help/${entry.aim}/${entry.slug}`
  expect((await request(path)).status).toBe(200)
  expect(blobsOf('help_article_viewed')).toEqual([
    [`${entry.aim}/${entry.slug}`, '', 'ja', '', ''],
  ])

  await request('/contact', { referer: `${TEST_ORIGIN}${path}?q=a` })
  expect(blobsOf('help_to_contact').map(([detail]) => detail)).toEqual([
    `${entry.aim}/${entry.slug}`,
  ])
  // From the footer, or from another site, the contact page is no sign of it.
  await request('/contact', { referer: TEST_ORIGIN })
  await request('/contact', { referer: `https://other.example${path}` })
  await request('/contact')
  expect(eventsOf('help_to_contact')).toHaveLength(1)
  // An article that does not exist is not counted as viewed.
  expect((await request(`/help/${entry.aim}/no-such-article`)).status).toBe(404)
  expect(eventsOf('help_article_viewed')).toHaveLength(1)
})

test('F40-AC14: Given a page that is missing and a page that fails, When they are counted, Then each is one more error under its kind and its route', async () => {
  const missing = await request('/no-such-page-at-all')
  expect(missing.status).toBe(404)
  const [absent] = blobsOf('screen_error')
  expect(absent?.[0]).toBe('not_found')

  written.length = 0
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const broken = { ...env, DB: undefined } as unknown as Env
  const failed = await request('/slides/anything', {
    cookie: alice,
    target: broken,
  })
  expect(failed.status).toBe(500)
  expect(blobsOf('screen_error').map(([detail]) => detail)).toEqual([
    'server_error',
  ])
  vi.restoreAllMocks()
})

test('F40-AC15: Given a run through the login, the upload, the publication, the reading, the export and the help with an IP address and a cookie on every request, When every row is read, Then no row holds an IP address, an email address, a user id or a cookie', async () => {
  const ip = '203.0.113.99'
  const trace = { 'CF-Connecting-IP': ip, 'X-Forwarded-For': ip }
  const call = (path: string, init: RequestInit = {}) =>
    server.fetch(
      new Request(`${TEST_ORIGIN}${path}`, {
        ...init,
        headers: { ...trace, ...(init.headers as object) },
      }),
      env,
    )
  const address = emailOf('erin')
  const cookie = await signIn(env, 'erin', { id: '99887766' })
  const placed = await placeFiles(env, cookie, { 'index.html': HTML })
  await publishVersion(placed.slug, placed.deploymentId, 0, cookie)
  await call(`/@erin/${placed.slug}`, {
    headers: {
      Referer: `https://203.0.113.5/x?email=${address}`,
      Cookie: 'language=ja; session=SECRET-COOKIE-VALUE',
    },
  })
  await call('/account/export/account.json', { headers: { Cookie: cookie } })
  await call(`/help?q=${encodeURIComponent(`${address} ${ip}`)}`)
  await call(`/help?q=${encodeURIComponent('見つからない')}`, {
    headers: { Cookie: cookie },
  })
  await call('/no-such-page', { headers: { Cookie: cookie } })

  expect(written.length).toBeGreaterThan(5)
  const everything = JSON.stringify(written)
  const secret = cookie.split('=')[1] ?? ''
  expect(secret.length).toBeGreaterThan(10)
  for (const forbidden of [
    ip,
    '203.0.113.5',
    address,
    'erin@',
    '99887766',
    secret,
    'SECRET-COOKIE-VALUE',
    OWNER_ID,
  ])
    expect(everything, forbidden).not.toContain(forbidden)
  expect(everything).not.toMatch(/\d{1,3}(\.\d{1,3}){3}/)
  expect(everything).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/)
  for (const row of written) {
    expect(row.indexes).toHaveLength(1)
    expect(row.blobs).toHaveLength(5)
    expect(row.doubles.length).toBeLessThanOrEqual(1)
  }
})

test('F40-AC22: Given a service with no dataset bound, When the pages and the actions are used, Then they answer as before and nothing is written', async () => {
  const bare = { ...base, ANALYTICS: undefined } as unknown as Env
  const cookie = await signIn(bare, 'frank', { id: '555' })
  expect(cookie).not.toBe('')
  const placed = await placeFiles(bare, cookie, { 'index.html': HTML })
  expect(
    (await publishVersion(placed.slug, placed.deploymentId, 0, cookie, bare))
      .status,
  ).toBe(200)
  expect(
    (await request(`/@frank/${placed.slug}`, { target: bare })).status,
  ).toBe(200)
  expect((await request('/no-such-page', { target: bare })).status).toBe(404)
  expect(written).toEqual([])
})

test('F40-AC24: Given a dataset whose writes all throw, When the pages and the actions are used, Then they answer as before', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const broken = {
    ...base,
    ANALYTICS: {
      writeDataPoint: () => {
        throw new Error('analytics is down')
      },
    },
  } as unknown as Env
  const cookie = await signIn(broken, 'gina', { id: '556' })
  expect(cookie).not.toBe('')
  const placed = await placeFiles(broken, cookie, { 'index.html': HTML })
  expect(
    (await publishVersion(placed.slug, placed.deploymentId, 0, cookie, broken))
      .status,
  ).toBe(200)
  const opened = await request(`/@gina/${placed.slug}`, { target: broken })
  expect(opened.status).toBe(200)
  expect(await opened.text()).toContain('iframe')
  expect((await request('/no-such-page', { target: broken })).status).toBe(404)
  vi.restoreAllMocks()
})

test('F40-AC24: Given a slow read that the publication count needs, When the version is published, Then the answer does not wait for the count', async () => {
  const placed = await placeFiles(env, alice, { 'index.html': HTML })
  const waited: Promise<unknown>[] = []
  const context = { waitUntil: (work: Promise<unknown>) => waited.push(work) }
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/api/slides/${placed.slug}/publication`, {
      method: 'POST',
      headers: {
        Cookie: alice,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'publish',
        deploymentId: placed.deploymentId,
        expectedRevision: 0,
      }),
    }),
    env,
    context as unknown as ExecutionContext,
  )
  expect(response.status).toBe(200)
  // The count was handed to the platform to finish after the answer.
  expect(waited).toHaveLength(1)
  await Promise.all(waited)
  expect(eventsOf('deck_published')).toHaveLength(1)
})
