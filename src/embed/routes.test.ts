import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { suspensions } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  resetTables,
  seedDeck,
  seedDeployment,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'
import { limitGroupOf } from '../site/rate-limit-policy'
import { embedCodeOf } from './code'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

let owner = ''
let revision = 0
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await seedDeck(db, 'talk')
  // Signing in records the handle "owner" from the stubbed GitHub login.
  owner = await signIn(env)
  revision = 0
})
afterAll(() => platform.dispose())

const open = (path: string, headers: Record<string, string> = {}, e = env) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`, { headers }), e)

async function act(body: Record<string, unknown>) {
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

/** Publishes a deployment of the deck under the given title. */
async function publish(title: string | null = 'Good talk') {
  const id = await seedDeployment(db, 'talk')
  await db
    .prepare('UPDATE deployments SET title = ? WHERE id = ?')
    .bind(title, id)
    .run()
  await act({ action: 'publish', deploymentId: id })
  return id
}

const frameTag = (page: string) => /<iframe\s[^>]*>/.exec(page)?.[0] ?? ''
const attribute = (tag: string, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null

/** The viewer's own 404, which no site may frame. */
async function expectUnavailable(response: Response) {
  expect(response.status).toBe(404)
  const body = await response.text()
  expect(body).toContain('この資料は公開されていません')
  expect(body).not.toContain('<iframe')
  expect(response.headers.get('X-Robots-Tag')).toBe('noindex')
  expect(response.headers.get('X-Frame-Options')).toBe('DENY')
  expect(response.headers.get('Content-Security-Policy')).toContain(
    "frame-ancestors 'none'",
  )
}

test('F25-AC1: Given public slides, When the page to frame is opened, Then it frames the deployment in the viewer’s sandbox, under a policy that lets any site frame it and names no source for requests or forms', async () => {
  const id = await publish()
  const response = await open('/embed/@owner/talk')
  expect(response.status).toBe(200)
  const page = await response.text()
  const origin = `https://d-${id}.content.example`
  const frame = frameTag(page)
  expect(attribute(frame, 'src')).toBe(`${origin}/`)
  // The same frame as the viewer's: no top navigation, popups, or forms.
  const viewer = frameTag(await (await open('/@owner/talk')).text())
  for (const name of ['sandbox', 'allow', 'referrerpolicy'])
    expect(attribute(frame, name)).toBe(attribute(viewer, name))
  expect(attribute(frame, 'sandbox')).toBe('allow-scripts allow-same-origin')
  expect(page.match(/<iframe\b/g)).toHaveLength(1)
  expect(response.headers.get('Content-Security-Policy')).toBe(
    `default-src 'none'; frame-src ${origin}; script-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors *`,
  )
  expect(response.headers.get('X-Frame-Options')).toBeNull()
  expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform')
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
  // The article is what a search lists, not the frame in it.
  expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
  expect(limitGroupOf('/embed/@owner/talk')).toBe('viewer')
})

test('F25-AC1: Given public slides whose title holds markup, When the page to frame is opened, Then the line under the slides shows the title, the author and one link that opens the viewer in a new tab', async () => {
  await publish('<b>Bold</b> & "quoted"')
  const page = await (await open('/embed/@owner/talk')).text()
  expect(page).not.toContain('<b>Bold</b>')
  expect(page).toContain(
    '<span class="embed-title">&lt;b&gt;Bold&lt;/b&gt; &amp; &quot;quoted&quot;</span>',
  )
  expect(page).toMatch(/<span class="embed-author"\s*>@owner<\/span\s*>/)
  const links = page.match(/<a\s[^>]*>/g) ?? []
  expect(links).toHaveLength(1)
  expect(attribute(links[0] ?? '', 'href')).toBe(`${TEST_ORIGIN}/@owner/talk`)
  expect(attribute(links[0] ?? '', 'target')).toBe('_blank')
  expect(attribute(links[0] ?? '', 'rel')).toBe('noopener')
  expect(page).toMatch(/>Slide で開く<\/a\s*>/)
  const english = await (await open('/embed/@owner/talk?lang=en')).text()
  expect(english).toMatch(/>Open on Slide<\/a\s*>/)
})

test('F25-AC1: Given public slides without a title, When the page to frame is opened, Then the line names them as their URL does', async () => {
  await publish(null)
  const page = await (await open('/embed/@owner/talk')).text()
  expect(page).toContain('<span class="embed-title">talk</span>')
  expect(attribute(frameTag(page), 'title')).toBe('talk')
})

test('F25-AC3: Given slides that are a draft, then public, then stopped, When the page to frame is opened at each step, Then only the public step shows them', async () => {
  const id = await seedDeployment(db, 'talk')
  await expectUnavailable(await open('/embed/@owner/talk'))
  await act({ action: 'publish', deploymentId: id })
  expect((await open('/embed/@owner/talk')).status).toBe(200)
  await act({ action: 'pause' })
  await expectUnavailable(await open('/embed/@owner/talk'))
  await expectUnavailable(await open('/embed/@owner/talk/3'))
})

test('F25-AC3: Given public slides an operator hid, When the page to frame is opened, Then it is the 404 a share URL gives', async () => {
  await publish()
  await db
    .prepare(
      "UPDATE decks SET hidden_at = 1, hidden_reason = 'check', hidden_by = 'op' WHERE id = 'talk'",
    )
    .run()
  await expectUnavailable(await open('/embed/@owner/talk'))
})

test('F25-AC3: Given public slides of an author who is suspended, When the page to frame is opened, Then it is the 404 a share URL gives, and it shows again once the suspension ends', async () => {
  await publish()
  await drizzle(db).insert(suspensions).values({
    user_id: OWNER_ID,
    reason: 'fake sign-in page',
    suspended_at: 300,
    suspended_by: 'op@example.com',
  })
  await expectUnavailable(await open('/embed/@owner/talk'))
  await drizzle(db).delete(suspensions)
  expect((await open('/embed/@owner/talk')).status).toBe(200)
})

test.each([
  '/embed/@owner/missing',
  '/embed/@someone/talk',
  '/embed/@owner',
  '/embed/@owner/talk/3/4',
  '/embed/owner/talk',
  '/embed/',
  '/embed/%E0%A4%A/talk',
])(
  'F25-AC3: Given %s, When opened, Then it is the same 404 as slides that are not public',
  async (path) => {
    await publish()
    await expectUnavailable(await open(path))
  },
)

test('F25-AC3: Given content delivery is not configured, When the page to frame is opened, Then it is unavailable', async () => {
  await publish()
  const without = { ...env, CONTENT_ORIGIN: undefined } as unknown as Env
  await expectUnavailable(await open('/embed/@owner/talk', {}, without))
})

test('F25-AC5: Given a signed-in reader, the author and a visitor, When each opens the page to frame, Then all get the same page, with no way to follow, report or mute, no form and no request to the service', async () => {
  await publish()
  const invited = withInvited(env)
  const reader = await signIn(invited, 'reader', { id: INVITED_ID })
  const visitor = await open('/embed/@owner/talk', {}, invited)
  const page = await visitor.text()
  for (const cookie of [reader, owner]) {
    const response = await open(
      '/embed/@owner/talk',
      { Cookie: cookie },
      invited,
    )
    expect(await response.text()).toBe(page)
    expect(response.headers.get('Set-Cookie')).toBeNull()
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform')
  }
  // The viewer of the same slides offers all three to this reader.
  const viewer = await (
    await open('/@owner/talk', { Cookie: reader }, invited)
  ).text()
  for (const action of ['/follows/new', '/reports/new', '/mutes/new']) {
    expect(viewer).toContain(action)
    expect(page).not.toContain(action)
  }
  for (const absent of [
    'data-follow-handle',
    'data-mute-handle',
    'フォロー',
    '通報',
    'ミュート',
    '<form',
    '<button',
    '/share.js',
    'site-header',
    '/api/',
  ])
    expect(page).not.toContain(absent)
  // The only script is the one that lets touches reach the slides.
  expect(page.match(/<script\b[^>]*>/g)).toEqual([
    '<script src="/embed.js" defer>',
  ])
  const policy = visitor.headers.get('Content-Security-Policy') ?? ''
  expect(policy).toContain("default-src 'none'")
  expect(policy).toContain("form-action 'none'")
  expect(policy).not.toContain('connect-src')
  expect(policy).not.toContain('img-src')
})

test('F25-AC10: Given public slides, When the page to frame is opened at /3, Then the slides start at #3 and the link opens the viewer on page 3', async () => {
  const id = await publish()
  const page = await (await open('/embed/@owner/talk/3')).text()
  expect(attribute(frameTag(page), 'src')).toBe(
    `https://d-${id}.content.example/#3`,
  )
  expect(page).toContain(`<a href="${TEST_ORIGIN}/@owner/talk/3"`)
  expect(page).toContain(
    `<link rel="canonical" href="${TEST_ORIGIN}/@owner/talk/3" />`,
  )
})

test.each(['0', '10000', '03', 'abc', '3/', '9999', '1'])(
  'F25-AC10: Given the page number spelled %s, When the page to frame is opened, Then it answers as the share URL with that number does',
  async (number) => {
    await publish()
    const [embed, share] = await Promise.all([
      open(`/embed/@owner/talk/${number}`),
      open(`/@owner/talk/${number}`),
    ])
    expect(embed.status).toBe(share.status)
    const moved = share.headers.get('Location')
    expect(embed.headers.get('Location')).toBe(moved && `/embed${moved}`)
  },
)

test('F25-AC10: Given the path spelled with capitals, an encoded @ and a trailing slash, When opened, Then it moves to the one spelling under /embed', async () => {
  await publish()
  const response = await open('/embed/%40Owner/Talk/')
  expect(response.status).toBe(301)
  expect(response.headers.get('Location')).toBe('/embed/@owner/talk')
})

const oembed = (url: string, more = '') =>
  open(`/oembed?url=${encodeURIComponent(url)}${more}`)
const SHARE = `${TEST_ORIGIN}/@owner/talk`
/** A value as the browser reads it from an attribute. */
const unescaped = (value: string) =>
  value
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')

test('F25-AC6: Given public slides, When oEmbed is asked about their share URL, Then the JSON has type, version, html, width, height, title and author_name, and html is the embed code', async () => {
  await publish('Talk "one" <two>')
  for (const url of [SHARE, `${SHARE}/3`]) {
    const response = await oembed(url, '&format=json')
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('application/json')
    expect(response.headers.get('Cache-Control')).toBe('no-cache')
    expect(await response.json()).toEqual({
      type: 'rich',
      version: '1.0',
      title: 'Talk "one" <two>',
      author_name: '@owner',
      author_url: `${TEST_ORIGIN}/@owner`,
      provider_name: 'Slide',
      provider_url: TEST_ORIGIN,
      html: embedCodeOf(SHARE, 'Talk "one" <two>'),
      width: 960,
      height: 540,
    })
  }
  expect(limitGroupOf('/oembed')).toBe('viewer')
})

test.each([
  ['maxwidth=320', 320, 180],
  ['maxwidth=652.8', 652, 366],
  ['maxwidth=640.0', 640, 360],
  ['maxheight=300.5', 533, 299],
  ['maxwidth=400&maxheight=90', 160, 90],
  ['maxwidth=5000&maxheight=5000', 960, 540],
])(
  'F25-AC6: Given public slides and the limits %s, When oEmbed is asked, Then width and height fit them, and the code names the same size in its attributes',
  async (limits, width, height) => {
    await publish('Good talk')
    const answer = (await (await oembed(SHARE, `&${limits}`)).json()) as {
      html: string
      width: number
      height: number
    }
    expect([answer.width, answer.height]).toEqual([width, height])
    expect(answer.html).toBe(embedCodeOf(SHARE, 'Good talk', { width, height }))
    expect(answer.html).toContain(` width="${width}" height="${height}" `)
    // Still one frame that stays 16:9 where the style is kept.
    expect(answer.html).toContain('aspect-ratio:16/9')
  },
)

test.each([
  'maxwidth=0',
  'maxheight=0',
  'maxwidth=-1',
  'maxwidth=0.5',
  'maxwidth=',
  'maxwidth=wide',
  'maxwidth=480&maxheight=tall',
  'maxwidth=1e3',
])(
  'F25-AC6: Given the limits %s, which no frame can be promised to fit, When oEmbed is asked about public slides, Then it is a bad request and no code is answered',
  async (limits) => {
    await publish()
    const response = await oembed(SHARE, `&${limits}`)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'maxwidth and maxheight must be positive numbers',
    })
  },
)

test('F25-AC6: Given slides that are a draft, stopped, hidden by an operator, or of a suspended author, When oEmbed is asked about their share URL, Then it is not found', async () => {
  const id = await seedDeployment(db, 'talk')
  expect((await oembed(SHARE)).status).toBe(404)
  await act({ action: 'publish', deploymentId: id })
  expect((await oembed(SHARE)).status).toBe(200)
  await db
    .prepare(
      "UPDATE decks SET hidden_at = 1, hidden_reason = 'check', hidden_by = 'op'",
    )
    .run()
  expect((await oembed(SHARE)).status).toBe(404)
  await db
    .prepare(
      'UPDATE decks SET hidden_at = NULL, hidden_reason = NULL, hidden_by = NULL',
    )
    .run()
  await drizzle(db).insert(suspensions).values({
    user_id: OWNER_ID,
    reason: 'fake sign-in page',
    suspended_at: 300,
    suspended_by: 'op@example.com',
  })
  expect((await oembed(SHARE)).status).toBe(404)
  await drizzle(db).delete(suspensions)
  await act({ action: 'pause' })
  const stopped = await oembed(SHARE)
  expect(stopped.status).toBe(404)
  expect(await stopped.json()).toEqual({ error: 'Not found' })
})

test.each([
  [
    'another site’s URL',
    '?url=https%3A%2F%2Felsewhere.example%2F%40owner%2Ftalk',
  ],
  ['a profile', `?url=${encodeURIComponent(`${TEST_ORIGIN}/@owner`)}`],
  [
    'slides nobody has',
    `?url=${encodeURIComponent(`${TEST_ORIGIN}/@owner/missing`)}`,
  ],
  [
    'the page to frame',
    `?url=${encodeURIComponent(`${TEST_ORIGIN}/embed/@owner/talk`)}`,
  ],
  ['no URL', ''],
  ['an empty URL', '?url='],
  [
    'a URL given twice, the first elsewhere',
    `?url=https%3A%2F%2Felsewhere.example%2F&url=${encodeURIComponent(SHARE)}`,
  ],
])(
  'F25-AC6: Given %s, When oEmbed is asked, Then it is not found',
  async (_, query) => {
    await publish()
    expect((await open(`/oembed${query}`)).status).toBe(404)
  },
)

test('F25-AC6: Given public slides, When oEmbed is asked for XML, Then it says it is not implemented, as the specification asks', async () => {
  await publish()
  expect((await oembed(SHARE, '&format=xml')).status).toBe(501)
})

test('F25-AC6: Given content delivery is not configured, When oEmbed is asked about a share URL, Then it is not found', async () => {
  await publish()
  const without = { ...env, CONTENT_ORIGIN: undefined } as unknown as Env
  const response = await open(
    `/oembed?url=${encodeURIComponent(SHARE)}`,
    {},
    without,
  )
  expect(response.status).toBe(404)
})

test('F25-AC9, F03-AC17: Given public slides opened on page 3, When the viewer’s head is read, Then it links to oEmbed for the slides, and the html answered there is the code the share menu copies', async () => {
  await publish('Talk "one" <two>')
  const page = await (await open('/@owner/talk/3')).text()
  const head = page.slice(0, page.indexOf('</head>'))
  const link =
    /<link\s+rel="alternate"\s+type="application\/json\+oembed"[^>]*>/.exec(
      head,
    )?.[0] ?? ''
  const href = unescaped(attribute(link, 'href') ?? '')
  expect(href).toBe(
    `${TEST_ORIGIN}/oembed?url=${encodeURIComponent(SHARE).replaceAll('%40', '%40')}&format=json`,
  )
  expect(unescaped(attribute(link, 'title') ?? '')).toBe('Talk "one" <two>')
  const answer = (await (
    await open(href.slice(TEST_ORIGIN.length))
  ).json()) as { html: string }
  const field = /<input\b[^>]*id="embed-code"[^>]*>/.exec(page)?.[0] ?? ''
  expect(field).toMatch(/\shidden\b/)
  expect(unescaped(attribute(field, 'value') ?? '')).toBe(answer.html)
  expect(answer.html).toContain(`src="${TEST_ORIGIN}/embed/@owner/talk"`)
  expect(page).toMatch(
    /<button type="button" data-copy="embed-code"[^>]*>\s*埋め込みコードをコピー\s*<\/button>/,
  )
})

test('F03-AC17: Given slides that were stopped, When their share URL is opened, Then there is no viewer, and so no way to copy an embed code', async () => {
  const id = await seedDeployment(db, 'talk')
  await act({ action: 'publish', deploymentId: id })
  expect(await (await open('/@owner/talk')).text()).toContain('id="embed-code"')
  await act({ action: 'pause' })
  const page = await (await open('/@owner/talk')).text()
  expect(page).not.toContain('embed-code')
  expect(page).not.toContain('埋め込みコード')
})

test('F25-AC7: Given the author’s page of slides, When they are a draft and then public, Then one line says embedding comes with publishing, and then the embed code shows with its copy button, the same code oEmbed answers', async () => {
  const deckPage = async (lang = 'ja') =>
    (await open(`/slides/talk?lang=${lang}`, { Cookie: owner })).text()
  const frameOf = (page: string) =>
    /<section class="panel" data-deck-frame="embed-code">([\s\S]*?)<\/section>/.exec(
      page,
    )?.[1] ?? ''
  const id = await seedDeployment(db, 'talk')
  await db
    .prepare('UPDATE deployments SET title = ? WHERE id = ?')
    .bind('Talk "one" <two>', id)
    .run()
  const draft = frameOf(await deckPage())
  expect(draft).toContain('埋め込みコード')
  expect(draft.match(/<p\b/g)).toHaveLength(1)
  expect(draft).toContain(
    '公開すると、このスライドをブログなどに埋め込めます。',
  )
  expect(draft).not.toContain('<input')
  expect(draft).not.toContain('<button')
  expect(frameOf(await deckPage('en'))).toContain(
    'Once published, the slides can be embedded in a blog post.',
  )

  await act({ action: 'publish', deploymentId: id })
  const shown = frameOf(await deckPage())
  expect(shown).not.toContain('公開すると')
  const field = /<input\b[^>]*id="embed-code"[^>]*>/.exec(shown)?.[0] ?? ''
  expect(field).toContain('readonly')
  expect(field).not.toMatch(/\shidden\b/)
  const answer = (await (await oembed(SHARE)).json()) as { html: string }
  expect(unescaped(attribute(field, 'value') ?? '')).toBe(answer.html)
  expect(shown).toMatch(
    /<button\s+class="button-secondary"\s+type="button"\s+data-copy="embed-code"\s+data-copied="コピーしました"\s*>\s*コピー\s*<\/button>/,
  )
  expect(frameOf(await deckPage('en'))).toMatch(/>\s*Copy\s*<\/button>/)

  await act({ action: 'pause' })
  expect(frameOf(await deckPage())).toContain('公開すると')
})
