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
import server from '../../server'
import { accounts, citations, decks, uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  seedDeck,
  seedDeployment,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { recordCitations } from './record'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

const READER_ID = '999'
const DID = 'did:plc:z72i7hdynmk6r22z27h6tvur'
const X_POST = 'https://x.com/kfly8/status/1830000000000000000'
const X_EMBED =
  'https://platform.twitter.com/embed/Tweet.html?id=1830000000000000000'

let owner = ''
let talk = ''
let reply = ''

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  // Signing in records the handle "owner" from the stubbed GitHub login.
  owner = await signIn(env)
  talk = await seedPublic(db, 'talk', 1, 'Talk')
  await orm
    .insert(accounts)
    .values({ user_id: READER_ID, handle: 'reader', created_at: 1 })
  reply = await seedPublic(db, 'reply', 2, 'Reply', READER_ID)
})
afterEach(() => vi.unstubAllGlobals())
afterAll(() => platform.dispose())

const cite = (
  deploymentId: string,
  slug: string,
  page: number,
  handle = 'owner',
) =>
  orm.insert(citations).values({
    deployment_id: deploymentId,
    target_handle: handle,
    target_slug: slug,
    target_page: page,
  })

const view = (path: string) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`), env)

const submit = (
  path: string,
  fields: Record<string, string>,
  headers: Record<string, string> = { Cookie: owner, Origin: TEST_ORIGIN },
) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields),
    }),
    env,
  )

const resultOf = (response: Response) =>
  new URL(response.headers.get('location') ?? '', TEST_ORIGIN).search

const frameSources = (response: Response) =>
  /frame-src ([^;]*)/.exec(
    response.headers.get('Content-Security-Policy') ?? '',
  )?.[1]

test('Given a public deck linking to pages, When the cited deck is opened, Then the citing deck runs once under it in a sandboxed frame, without page links', async () => {
  await cite(reply, 'talk', 6)
  await cite(reply, 'talk', 24)

  const response = await view('/@owner/talk')
  const page = await response.text()

  const citing = `https://d-${reply}.content.example`
  expect(page).toContain('このスライドを引用しているスライド')
  expect(page.match(/<iframe\s+data-deck/g)).toHaveLength(1)
  expect(page).toMatch(
    new RegExp(
      `<iframe\\s+data-deck\\s+src="${citing}/"\\s+title="Reply"\\s+loading="lazy"\\s+sandbox="allow-scripts allow-same-origin"`,
    ),
  )
  expect(page).toContain('<a href="/@reader/reply">Reply</a>')
  expect(page).not.toContain('/@owner/talk/6')
  expect(frameSources(response)).toContain(citing)
})

test('Given a public deck linking to several pages of a deck, When the citing deck is opened, Then the cited deck runs once in a sandboxed frame with a link to its viewer', async () => {
  await cite(reply, 'talk', 6)
  await cite(reply, 'talk', 24)
  await cite(reply, 'talk', 0)

  const response = await view('/@reader/reply')
  const page = await response.text()

  const cited = `https://d-${talk}.content.example`
  expect(
    page.match(/<iframe\s+data-deck\s+src="[^"]*"\s+title="Talk"/g),
  ).toEqual([expect.stringContaining(`src="${cited}/"`)])
  expect(page).toMatch(
    /title="Talk"\s+loading="lazy"\s+sandbox="allow-scripts allow-same-origin"/,
  )
  expect(page).toContain('<a href="/@owner/talk">Talk</a>')
  expect(page).not.toContain('/@owner/talk/6')
  expect(frameSources(response)).toContain(cited)
})

test('Given the citing deck stops being public, When the cited deck is opened, Then the citation is gone and the viewer is as before', async () => {
  await cite(reply, 'talk', 6)
  await orm
    .update(decks)
    .set({ public_deployment_id: null })
    .where(eq(decks.id, 'reply'))

  const response = await view('/@owner/talk')
  const page = await response.text()

  expect(page).not.toContain('class="cites"')
  expect(page).not.toContain('Reply')
  expect(page).toContain('まだ反応はありません')
  expect(frameSources(response)).toMatch(/^http\S+content\.example 'self'$/)
})

test('Given a link to a draft or unknown deck, When the citing deck is opened, Then nothing tells that the deck exists', async () => {
  await seedDeck(db, 'draft')
  await cite(reply, 'draft', 2)
  await cite(reply, 'missing', 0, 'nobody')

  const page = await (await view('/@reader/reply')).text()

  expect(page).not.toContain('class="cites"')
  expect(page).not.toContain('draft')
})

test('Given a page in the share URL, When opened, Then the deck starts at that page and the page’s URL is the one to share', async () => {
  const page = await (await view('/@owner/talk/6')).text()

  expect(page).toMatch(
    /<iframe\s[^>]*src="https:\/\/d-[^"]+\.content\.example\/#6"/,
  )
  expect(page).toContain('value="https://slide.example/@owner/talk/6"')
})

test('Given more citing decks than are shown, When the cited deck is opened, Then only the latest run in frames and the rest are counted', async () => {
  for (const [index, slug] of ['a', 'b', 'c', 'd', 'e', 'f'].entries())
    await cite(
      await seedPublic(db, `reply-${slug}`, 10 + index, slug, READER_ID),
      'talk',
      0,
    )

  const response = await view('/@owner/talk')
  const page = await response.text()

  expect(page.match(/<iframe\s+data-deck/g)).toHaveLength(4)
  expect(page).toContain('ほか 2 件')
  // The newest was published last; the two oldest are left out.
  expect(page).toContain('href="/@reader/reply-f"')
  expect(page).not.toContain('href="/@reader/reply-a"')
  expect(frameSources(response)?.split(' ')).toHaveLength(1 + 1 + 4)
})

test('Given a deck that is cited and cites another, When opened, Then the decks citing it come before the decks it cites', async () => {
  await cite(reply, 'talk', 6)
  await cite(talk, 'reply', 0, 'reader')

  const page = await (await view('/@owner/talk')).text()

  const citing = page.indexOf('このスライドを引用しているスライド')
  const cited = page.indexOf('このスライドが引用しているスライド')
  expect(citing).toBeGreaterThan(0)
  expect(cited).toBeGreaterThan(citing)
  expect(page.match(/<iframe\s+data-deck/g)).toHaveLength(2)
})

test.each(['/@owner/talk', '/@owner/talk/6', '/@owner/missing'])(
  'Given a deck’s frame follows a link to %s, When answered, Then the frame gets the page that asks the viewer to open it, which only this origin may frame',
  async (path) => {
    const response = await server.fetch(
      new Request(`${TEST_ORIGIN}${path}`, {
        headers: { 'Sec-Fetch-Dest': 'iframe' },
      }),
      env,
    )

    expect(response.status).toBe(200)
    const page = await response.text()
    const nonce = /<script nonce="([A-Za-z0-9_-]{20,})">/.exec(page)?.[1]
    expect(page).toContain("type: 'slide:open', path: location.pathname")
    expect(page).not.toContain('<iframe')
    expect(response.headers.get('Content-Security-Policy')).toBe(
      `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`,
    )
    expect(response.headers.get('X-Frame-Options')).toBe('SAMEORIGIN')
  },
)

test.each(['/@owner', '/decks', '/'])(
  'Given a frame requests %s, which is not a deck, When answered, Then it still may not be framed',
  async (path) => {
    const response = await server.fetch(
      new Request(`${TEST_ORIGIN}${path}`, {
        headers: { 'Sec-Fetch-Dest': 'iframe' },
      }),
      env,
    )

    expect(response.headers.get('X-Frame-Options')).toBe('DENY')
    expect(await response.text()).not.toContain('slide:open')
  },
)

test('Given a reader opens a deck, When answered, Then the viewer itself may not be framed', async () => {
  const response = await view('/@owner/talk')

  expect(response.headers.get('X-Frame-Options')).toBe('DENY')
  expect(response.headers.get('Content-Security-Policy')).toContain(
    "frame-ancestors 'none'",
  )
})

test('Given a zero-padded page, When opened, Then it redirects to the one spelling of that page', async () => {
  const response = await view('/@owner/talk/06')

  expect(response.status).toBe(301)
  expect(response.headers.get('location')).toBe('/@owner/talk/6')
})

test('Given the owner pastes a post on X for a page, When the deck is opened, Then the post is framed from X on the timeline', async () => {
  const added = await submit('/decks/talk/reactions', {
    url: X_POST,
    page: '6',
  })

  expect(added.status).toBe(303)
  expect(resultOf(added)).toBe('?result=added')
  const response = await view('/@owner/talk')
  const page = await response.text()
  expect(page).toContain(`src="${X_EMBED}&amp;dnt=true"`)
  expect(frameSources(response)).toContain('https://platform.twitter.com')
  expect(frameSources(response)).not.toContain('bsky')
})

test('Given a post already shown, When pasted again under another spelling, Then it is not added twice', async () => {
  await submit('/decks/talk/reactions', { url: X_POST, page: '6' })

  const again = await submit('/decks/talk/reactions', {
    url: 'https://twitter.com/i/web/status/1830000000000000000',
    page: '',
  })

  expect(resultOf(again)).toBe('?result=exists')
  const page = await (await view('/@owner/talk')).text()
  expect(page.match(/data-embed/g)).toHaveLength(1)
})

test.each([
  ['a page that is not a post', { url: 'https://example.com/post', page: '' }],
  ['a script URL', { url: 'javascript:alert(1)', page: '' }],
  ['page zero', { url: X_POST, page: '0' }],
  ['a page beyond the limit', { url: X_POST, page: '10000' }],
  ['no URL', { page: '3' }],
])('Given %s, When pasted, Then nothing is added', async (_, fields) => {
  const response = await submit('/decks/talk/reactions', fields)

  expect(resultOf(response)).toBe('?result=invalid')
  expect(await (await view('/@owner/talk')).text()).not.toContain('data-embed')
})

test('Given a Bluesky post named by handle, When pasted, Then it is stored under the account the handle resolves to', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ did: DID }))

  const added = await submit('/decks/talk/reactions', {
    url: 'https://bsky.app/profile/bsky.app/post/3l6oveex3ii2l',
    page: '',
  })

  expect(resultOf(added)).toBe('?result=added')
  const response = await view('/@owner/talk')
  expect(await response.text()).toContain(
    `src="https://embed.bsky.app/embed/${DID}/app.bsky.feed.post/3l6oveex3ii2l"`,
  )
  expect(frameSources(response)).toContain('https://embed.bsky.app')
})

test.each([
  ['nobody holds the handle', async () => new Response('{}', { status: 400 })],
  ['the answer is not a DID', async () => Response.json({ did: '"><script>' })],
  [
    'Bluesky cannot be reached',
    async () => {
      throw new Error('offline')
    },
  ],
])(
  'Given %s, When a Bluesky post is pasted, Then nothing is added',
  async (_, answer) => {
    vi.stubGlobal('fetch', answer)

    const response = await submit('/decks/talk/reactions', {
      url: 'https://bsky.app/profile/bsky.app/post/3l6oveex3ii2l',
    })

    expect(resultOf(response)).toBe('?result=unresolved')
  },
)

test('Given posts on Bluesky linking to the deck, When collected, Then each is on the timeline once and a repeat adds nothing', async () => {
  const searched: string[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    searched.push(String(input instanceof Request ? input.url : input))
    return Response.json({
      posts: [
        {
          uri: `at://${DID}/app.bsky.feed.post/3l6oveex3ii2l`,
          record: {
            facets: [{ features: [{ uri: `${TEST_ORIGIN}/@owner/talk/3` }] }],
          },
        },
        { uri: `at://${DID}/app.bsky.feed.post/3l6oveex3ii2m`, record: {} },
        { uri: 'not a post' },
        'not an object',
      ],
    })
  })

  const collected = await submit('/decks/talk/reactions/collect', { query: '' })
  const again = await submit('/decks/talk/reactions/collect', { query: '' })

  expect(resultOf(collected)).toBe('?result=collected&count=2')
  expect(resultOf(again)).toBe('?result=collected&count=0')
  expect(new URL(searched[0] ?? '').searchParams.get('q')).toBe(
    'slide.example/@owner/talk',
  )
  const page = await (await view('/@owner/talk')).text()
  expect(page.match(/data-embed/g)).toHaveLength(2)
})

test('Given Bluesky refuses the search, When collected, Then the owner is told and nothing is added', async () => {
  vi.stubGlobal('fetch', async () => new Response('no', { status: 403 }))

  const response = await submit('/decks/talk/reactions/collect', {
    query: '#tokyotojs',
  })

  expect(resultOf(response)).toBe('?result=search_failed')
})

test('Given a shown post, When the owner removes it, Then readers no longer see it', async () => {
  await submit('/decks/talk/reactions', { url: X_POST })
  const manage = await (
    await server.fetch(
      new Request(`${TEST_ORIGIN}/decks/talk/reactions`, {
        headers: { Cookie: owner },
      }),
      env,
    )
  ).text()
  const action = /action="(\/decks\/talk\/reactions\/[^"]+\/remove)"/.exec(
    manage,
  )?.[1]

  const removed = await submit(action ?? '', {})

  expect(resultOf(removed)).toBe('?result=removed')
  expect(await (await view('/@owner/talk')).text()).not.toContain('data-embed')
})

test('Given no owner session, When a post is pasted, Then the sign-in page answers and nothing is added', async () => {
  const response = await submit(
    '/decks/talk/reactions',
    { url: X_POST },
    { Origin: TEST_ORIGIN },
  )

  expect(response.status).toBe(401)
  expect(await (await view('/@owner/talk')).text()).not.toContain('data-embed')
})

test('Given a form posted from another site, When received, Then it is refused', async () => {
  const response = await submit(
    '/decks/talk/reactions',
    { url: X_POST },
    { Cookie: owner, Origin: 'https://elsewhere.example' },
  )

  expect(response.status).toBe(403)
  expect(await (await view('/@owner/talk')).text()).not.toContain('data-embed')
})

test.each(['reply', 'missing', 'Not-A-Deck'])(
  'Given the deck %s that is not the owner’s, When a post is pasted, Then it looks like no deck',
  async (deck) => {
    const response = await submit(`/decks/${deck}/reactions`, { url: X_POST })

    expect(response.status).toBe(404)
    expect(await (await view('/@reader/reply')).text()).not.toContain(
      'data-embed',
    )
  },
)

test('Given uploaded HTML files linking to decks, When citations are recorded, Then links from every file are kept once and links to the deck itself are not', async () => {
  const deployment = await seedDeployment(db, 'talk')
  const files = {
    'index.html': `<a href="${TEST_ORIGIN}/@reader/reply/2">reply</a>
      <a href="${TEST_ORIGIN}/@owner/talk/9">self</a>`,
    'slides/001.html': `<a href="${TEST_ORIGIN}/@reader/reply/2">again</a>
      <a href="${TEST_ORIGIN}/@reader/reply">whole</a>`,
    'notes.txt': `<a href="${TEST_ORIGIN}/@reader/reply/7">not HTML</a>`,
  }
  for (const [index, [path, body]] of Object.entries(files).entries()) {
    const key = `${deployment}/${index}/lease`
    await platform.env.UPLOADS.put(key, body)
    await orm.insert(uploadFiles).values({
      deployment_id: deployment,
      id: String(index),
      path,
      size: body.length,
      sha256: 'x',
      media_type: path.endsWith('.html')
        ? 'text/html; charset=utf-8'
        : 'text/plain; charset=utf-8',
      object_key: key,
    })
  }

  await recordCitations(env, deployment)
  await recordCitations(env, deployment)

  const kept = await orm
    .select()
    .from(citations)
    .where(eq(citations.deployment_id, deployment))
  expect(
    kept
      .map(
        (row) => `${row.target_handle}/${row.target_slug}/${row.target_page}`,
      )
      .sort(),
  ).toEqual(['reader/reply/0', 'reader/reply/2'])
})
