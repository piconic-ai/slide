import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { decks, deployments, suspensions, uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  keepInvited,
  OWNER_ID,
  resetTables,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'
import { startUpload } from './api'
import { parseInventoryStructure } from './inventory'
import { attemptSchema } from './start-request'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const base = withInvited(testEnv(platform.env))
const html = '<!doctype html><title>Stored &amp; shown</title><h1>Hi</h1>'
const sha256 = async (text: string) =>
  Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  ).toString('hex')
const inventory = async (body = html) => ({
  entry: 'index.html',
  files: [
    {
      path: 'index.html',
      size: new TextEncoder().encode(body).length,
      sha256: await sha256(body),
    },
  ],
})
let sequence = 0
const nextAttempt = () =>
  `new-slide-attempt-${String(++sequence).padStart(4, '0')}`
let alice = ''
let bob = ''

type Started = {
  deploymentId: string
  credential: string
  slug: string
  manageUrl: string
  code?: string
  reason?: string
}
const start = async (
  name: Record<string, unknown> | undefined,
  options: { cookie?: string; env?: Env; attempt?: string; body?: string } = {},
) => {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/api/slides`, {
      method: 'POST',
      headers: {
        Cookie: options.cookie ?? alice,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        attempt: options.attempt ?? nextAttempt(),
        ...(name && { name }),
        ...(await inventory(options.body)),
      }),
    }),
    options.env ?? base,
  )
  return { status: response.status, body: (await response.json()) as Started }
}
const limited = (limits: Record<string, number>) =>
  ({ ...base, UPLOAD_LIMITS: limits }) as unknown as Env
const many = limited({ activeSessions: 10 })
const slugs = async (owner = OWNER_ID) =>
  (
    await db
      .select({ slug: decks.slug })
      .from(decks)
      .where(eq(decks.owner_user_id, owner))
      .orderBy(decks.created_at, decks.slug)
  ).map(({ slug }) => slug)

const liveDecks = async (owner = OWNER_ID) =>
  (
    await db
      .select({ slug: decks.slug, deleted: decks.deleted_at })
      .from(decks)
      .where(eq(decks.owner_user_id, owner))
      .orderBy(decks.slug)
  )
    .filter(({ deleted }) => deleted === null)
    .map(({ slug }) => slug)
beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetTables(database)
  alice = await signIn(base, 'alice')
  bob = await signIn(base, 'bob', { id: INVITED_ID })
}, 30_000)
afterAll(() => platform.dispose())

test('F22-AC1: Given a signed-in author, When they start an upload of a new slide, Then a slide of their own is made that nobody else can read yet, with the page to manage it', async () => {
  const { status, body } = await start({ title: 'My Talk', fileName: 'x.html' })

  expect(status).toBe(201)
  expect(body).toMatchObject({
    slug: 'my-talk',
    manageUrl: `${TEST_ORIGIN}/my/slides/my-talk`,
  })
  expect(
    await db
      .select({
        slug: decks.slug,
        owner: decks.owner_user_id,
        public: decks.public_deployment_id,
        firstPublished: decks.first_published_at,
      })
      .from(decks),
  ).toEqual([
    {
      slug: 'my-talk',
      owner: OWNER_ID,
      public: null,
      firstPublished: null,
    },
  ])
  expect(
    await db
      .select({ source: deployments.source, state: deployments.state })
      .from(deployments),
  ).toEqual([{ source: 'browser', state: 'uploading' }])
  const page = await server.fetch(
    new Request(body.manageUrl, { headers: { Cookie: alice } }),
    base,
  )
  expect(page.status).toBe(200)
  const others = await server.fetch(
    new Request(body.manageUrl, { headers: { Cookie: bob } }),
    base,
  )
  expect(others.status).toBe(404)
})

test('F22-AC13: Given a new slide whose files are received, When it is finalized, Then its title is the <title> of index.html', async () => {
  const { body } = await start({ title: 'ignored for the title' })
  const auth = { Authorization: `Bearer ${body.credential}` }
  const put = await server.fetch(
    new Request(`${TEST_ORIGIN}/api/uploads/${body.deploymentId}/files/0`, {
      method: 'PUT',
      headers: auth,
      body: html,
    }),
    base,
  )
  expect(put.status).toBe(200)

  const ready = await server.fetch(
    new Request(`${TEST_ORIGIN}/api/uploads/${body.deploymentId}/finalize`, {
      method: 'POST',
      headers: auth,
    }),
    base,
  )

  expect(ready.status).toBe(200)
  expect(
    await db.select({ title: deployments.title }).from(deployments),
  ).toEqual([{ title: 'Stored & shown' }])
})

test.each([
  [
    'its title',
    { title: 'RubyKaigi 2026 LT', fileName: 'deck.html' },
    'rubykaigi-2026-lt',
  ],
  [
    'the dropped file when the title spells nothing',
    { title: '発表資料', fileName: 'kaigi-talk.zip' },
    'kaigi-talk',
  ],
  [
    'the dropped file when there is no title',
    { fileName: 'Deck Final.HTML' },
    'deck-final',
  ],
  [
    '"slide" when neither spells a slug',
    { title: '発表', fileName: '発表.html' },
    'slide',
  ],
  ['"slide" when the sender names nothing', undefined, 'slide'],
])(
  'F22-AC13: Given a new slide, When its URL name is decided, Then it comes from %s',
  async (_name, name, expected) => {
    const { status, body } = await start(name)

    expect(status).toBe(201)
    expect(body.slug).toBe(expected)
  },
)

test('F22-AC13: Given the author already has slides of the name, When more with the same title are started, Then each gets the next number and none collide', async () => {
  const first = await start({ title: 'Talk' }, { env: many })
  const second = await start({ title: 'Talk' }, { env: many })
  const third = await start({ title: 'talk!' }, { env: many })

  expect([first.body.slug, second.body.slug, third.body.slug]).toEqual([
    'talk',
    'talk-2',
    'talk-3',
  ])
  expect(new Set(await slugs()).size).toBe(3)
})

test('F22-AC13: Given two starts of one title at the same moment, When both are made, Then they get different names', async () => {
  const [one, other] = await Promise.all([
    start({ title: 'Talk' }, { env: many }),
    start({ title: 'Talk' }, { env: many }),
  ])

  expect([one.status, other.status]).toEqual([201, 201])
  expect([one.body.slug, other.body.slug].sort()).toEqual(['talk', 'talk-2'])
})

test('F22-AC13: Given a slide of the name waits to be purged, When a new one with that title is started, Then the name still counts as used', async () => {
  await db.insert(decks).values({
    id: 'gone',
    slug: 'talk',
    owner_user_id: OWNER_ID,
    created_at: 1,
    deleted_at: 2,
  })

  expect((await start({ title: 'Talk' })).body.slug).toBe('talk-2')
})

test.each(['Following', 'followers', 'NEW', 'connect'])(
  'F21-AC20: Given a new slide titled %j, When its URL name is decided, Then it gets -2 and never the reserved name',
  async (title) => {
    const { status, body } = await start({ title })

    expect(status).toBe(201)
    expect(body.slug).toBe(`${title.toLowerCase()}-2`)
  },
)

test('F21-AC65: Given a new slide titled "Communities", When its URL name is decided, Then it gets -2 and never the reserved name', async () => {
  const { status, body } = await start({ title: 'Communities' })

  expect(status).toBe(201)
  expect(body.slug).toBe('communities-2')
})

test('F22-AC25: Given two authors, When each starts a new slide with the same title, Then each gets the name itself', async () => {
  const mine = await start({ title: 'Talk' }, { env: many })
  const theirs = await start({ title: 'Talk' }, { env: many, cookie: bob })

  expect([mine.body.slug, theirs.body.slug]).toEqual(['talk', 'talk'])
  expect(await slugs(INVITED_ID)).toEqual(['talk'])
})

test('Given a start of a new slide whose answer was lost, When the same attempt starts again, Then it continues the same upload and makes no second slide', async () => {
  const first = await start(
    { title: 'Talk' },
    { attempt: 'lost-answer-attempt' },
  )
  const again = await start(
    { title: 'Talk' },
    { attempt: 'lost-answer-attempt' },
  )

  expect(again.status).toBe(201)
  expect(again.body.deploymentId).toBe(first.body.deploymentId)
  expect(again.body.slug).toBe('talk')
  expect(again.body.credential).not.toBe(first.body.credential)
  expect(await slugs()).toEqual(['talk'])
  expect(await db.$count(deployments)).toBe(1)
})

test('Given an attempt that made a new slide, When it starts again with other files, Then the conflict has a code and nothing more is made', async () => {
  await start({ title: 'Talk' }, { attempt: 'conflicting-attempt-1' })

  const again = await start(
    { title: 'Talk' },
    { attempt: 'conflicting-attempt-1', body: '<!doctype html><p>other</p>' },
  )

  expect(again.status).toBe(409)
  expect(again.body.code).toBe('inventory_conflict')
  expect(await slugs()).toEqual(['talk'])
})

test('Given an attempt made a new slide the author then deleted, When it starts again, Then it is refused and the slide is not brought back', async () => {
  await start({ title: 'Talk' }, { attempt: 'deleted-slide-attempt' })
  await db.update(decks).set({ deleted_at: 5 })

  const again = await start(
    { title: 'Talk' },
    { attempt: 'deleted-slide-attempt' },
  )

  expect(again.status).toBe(403)
  expect(await db.$count(decks)).toBe(1)
})

test('F22-AC6: Given the author has as many slides as allowed, When they start another, Then it is refused naming the limit on slides and nothing is made', async () => {
  const env = limited({ decks: 1, activeSessions: 10 })
  expect((await start({ title: 'One' }, { env })).status).toBe(201)

  const { status, body } = await start({ title: 'Two' }, { env })

  expect(status).toBe(409)
  expect(body.code).toBe('deck_limit')
  expect(await slugs()).toEqual(['one'])
  expect(await db.$count(deployments)).toBe(1)
})

test('F22-AC6: Given a slide waiting to be purged, When the limit on slides is counted, Then it does not count', async () => {
  const env = limited({ decks: 1, activeSessions: 10 })
  await db.insert(decks).values({
    id: 'gone',
    slug: 'gone',
    owner_user_id: OWNER_ID,
    created_at: 1,
    deleted_at: 2,
  })

  expect((await start({ title: 'One' }, { env })).status).toBe(201)
})

test.each([
  ['one file is larger than allowed', { fileBytes: 10 }, 413, 'file_too_large'],
  [
    'the version is larger than allowed',
    { fileBytes: 10, deploymentBytes: 10 },
    413,
    'file_too_large',
  ],
  [
    'what the author stores would exceed the total',
    { authorBytes: 10, deploymentBytes: 10, fileBytes: 10 },
    413,
    'file_too_large',
  ],
])(
  'F22-AC6: Given %s, When a new slide is started, Then it is refused naming the limit and neither a slide nor a version is made',
  async (_name, limits, expectedStatus, reason) => {
    const { status, body } = await start(
      { title: 'Talk' },
      { env: limited(limits) },
    )

    expect(status).toBe(expectedStatus)
    expect(body).toMatchObject({ code: 'start_rejected', reason })
    expect(body.deploymentId).toBeUndefined()
    expect(await db.$count(decks)).toBe(0)
    expect(await db.$count(deployments)).toBe(0)
  },
)

test('F22-AC6: Given the author’s stored files leave no room, When a new slide is started, Then it is refused naming the total and no slide is left behind', async () => {
  const size = new TextEncoder().encode(html).length
  const env = limited({
    authorBytes: size + 1,
    deploymentBytes: size + 1,
    fileBytes: size + 1,
    activeSessions: 10,
  })
  expect((await start({ title: 'One' }, { env })).status).toBe(201)
  await db.update(deployments).set({ state: 'ready', ready_at: 1 })

  const { status, body } = await start({ title: 'Two' }, { env })

  expect(status).toBe(409)
  expect(body).toMatchObject({
    code: 'start_rejected',
    reason: 'author_bytes_exceeded',
  })
  expect(await slugs()).toEqual(['one'])
  expect(await db.$count(deployments)).toBe(1)
})

test('Given another upload of the author is receiving a file, When a new slide is started, Then it is asked to retry and no slide is left behind', async () => {
  expect((await start({ title: 'One' })).status).toBe(201)
  await db
    .update(deployments)
    .set({ lease_id: 'receiving', lease_until: 9999999999 })

  const { status, body } = await start({ title: 'Two' })

  expect(status).toBe(429)
  expect(body.code).toBe('upload_busy')
  expect(await slugs()).toEqual(['one'])
})

test('Given an upload a stopped sender left open, When a new slide is started, Then the new one starts at once, the old upload is given up and the slide it left empty is released', async () => {
  const stuck = await start({ title: 'One' })

  const { status, body } = await start({ title: 'Two' })

  expect(status).toBe(201)
  expect(body.slug).toBe('two')
  expect(await liveDecks()).toEqual(['two'])
  expect(
    await db
      .select({ id: deployments.id, state: deployments.state })
      .from(deployments)
      .orderBy(deployments.state),
  ).toEqual([
    { id: stuck.body.deploymentId, state: 'expired' },
    { id: body.deploymentId, state: 'uploading' },
  ])
})

test.each([
  ['another site', 'https://evil.example'],
  ['a sandboxed frame', 'null'],
  ['a sender that names no origin', ''],
])(
  'Given JSON from %s with the author’s cookie, When it reaches the start of a new slide, Then it is refused and nothing is made',
  async (_name, origin) => {
    const response = await server.fetch(
      new Request(`${TEST_ORIGIN}/api/slides`, {
        method: 'POST',
        headers: {
          Cookie: alice,
          Origin: origin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attempt: nextAttempt(),
          ...(await inventory()),
        }),
      }),
      base,
    )

    expect(response.status).toBe(403)
    expect(await db.$count(decks)).toBe(0)
  },
)

test.each(['/api/slides', '/api/slides/talk/uploads'])(
  'F22-AC38: Given an author taken off the registration while signed in, When they send a start to %s, Then it is refused as invitation-only and nothing is made',
  async (path) => {
    await db.insert(decks).values({
      id: 'talk',
      slug: 'talk',
      owner_user_id: INVITED_ID,
      created_at: 1,
    })
    // Bob is taken off the invitations while he is signed in.
    await keepInvited(platform.env.DB, [OWNER_ID])
    const response = await server.fetch(
      new Request(`${TEST_ORIGIN}${path}`, {
        method: 'POST',
        headers: {
          Cookie: bob,
          Origin: TEST_ORIGIN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attempt: nextAttempt(),
          ...(await inventory()),
        }),
      }),
      testEnv(platform.env),
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'invitation_only' })
    expect(await db.$count(decks)).toBe(1)
    expect(await db.$count(deployments)).toBe(0)
  },
)

test.each([
  ['no cookie', ''],
  ['a cookie that names no session', '__Host-slide_owner=forged'],
])(
  'F22-AC17: Given %s, When a new slide is started, Then it is refused as signed out and nothing is made',
  async (_name, cookie) => {
    const { status, body } = await start({ title: 'Talk' }, { cookie })

    expect(status).toBe(401)
    expect(body.code).toBeUndefined()
    expect(await db.$count(decks)).toBe(0)
  },
)

test('Given a suspended author, When they start a new slide, Then it is refused and nothing is made', async () => {
  await db.insert(suspensions).values({
    user_id: OWNER_ID,
    reason: 'test',
    suspended_at: 1,
    suspended_by: 'operator',
  })

  expect((await start({ title: 'Talk' })).status).toBe(403)
  expect(await db.$count(decks)).toBe(0)
})

test.each([
  [
    'a form another site submits',
    'https://evil.example',
    'application/x-www-form-urlencoded',
    403,
  ],
  ['plain text from the service itself', TEST_ORIGIN, 'text/plain', 415],
])(
  'Given %s with the author’s cookie, When it reaches the start of a new slide, Then it is refused and nothing is made',
  async (_name, origin, type, status) => {
    const response = await server.fetch(
      new Request(`${TEST_ORIGIN}/api/slides`, {
        method: 'POST',
        headers: { Cookie: alice, Origin: origin, 'Content-Type': type },
        body: JSON.stringify({
          attempt: nextAttempt(),
          ...(await inventory()),
        }),
      }),
      base,
    )

    expect(response.status).toBe(status)
    expect(await db.$count(decks)).toBe(0)
  },
)

test.each([
  ['a name that is not an object', { name: 'talk' }],
  ['a name with a key it does not know', { name: { slug: 'talk' } }],
  ['no attempt', { attempt: undefined }],
])(
  'Given a start of a new slide with %s, When it arrives, Then it is refused and nothing is made',
  async (_name, change) => {
    const response = await server.fetch(
      new Request(`${TEST_ORIGIN}/api/slides`, {
        method: 'POST',
        headers: {
          Cookie: alice,
          Origin: TEST_ORIGIN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attempt: nextAttempt(),
          ...(await inventory()),
          ...change,
        }),
      }),
      base,
    )

    expect(response.status).toBe(400)
    expect(await db.$count(decks)).toBe(0)
  },
)

// Another entry, such as MCP, calls the start with an author it has checked.
const directStart = async (ownerUserId: string, env: Env = base) =>
  startUpload(
    { env, req: { url: `${TEST_ORIGIN}/mcp` } },
    {
      ownerUserId,
      source: 'mcp',
      target: { kind: 'new', name: { title: 'From an agent' } },
      attempt: attemptSchema.parse(nextAttempt()),
      inventory: parseInventoryStructure(await inventory()),
    },
  )

test('Given an entry other than the browser, When it starts a new slide for a registered author, Then the slide is theirs and the version records where it was sent from', async () => {
  const started = await directStart(INVITED_ID)

  expect(started).toMatchObject({
    slug: 'from-an-agent',
    manageUrl: `${TEST_ORIGIN}/my/slides/from-an-agent`,
  })
  expect(await slugs(INVITED_ID)).toEqual(['from-an-agent'])
  expect(
    await db.select({ source: deployments.source }).from(deployments),
  ).toEqual([{ source: 'mcp' }])
  expect(await db.$count(uploadFiles)).toBe(1)
})

test('F22-AC40: Given an entry that names someone who is not an invited author, When it starts a new slide, Then it is refused and nothing is made', async () => {
  await keepInvited(platform.env.DB, [OWNER_ID])
  await expect(
    directStart(INVITED_ID, testEnv(platform.env)),
  ).rejects.toMatchObject({ status: 403 })
  expect(await db.$count(decks)).toBe(0)
})

const listed = async () => {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/my/slides`, { headers: { Cookie: alice } }),
    base,
  )
  // One edit link per row.
  return (
    (await response.text()).match(
      /class="deck-row-edit"\s+href="\/my\/slides\/[a-z0-9-]+"/g,
    ) ?? []
  )
}

test('Given a new slide whose first upload was left open and never finished, When the author starts the same slide again, Then it gets the name itself, and the empty slide is gone from their list', async () => {
  const stuck = await start({ title: 'Talk' })
  expect(stuck.body.slug).toBe('talk')

  const again = await start({ title: 'Talk' })

  expect(again.status).toBe(201)
  expect(again.body.slug).toBe('talk')
  expect(again.body.deploymentId).not.toBe(stuck.body.deploymentId)
  expect(await liveDecks()).toEqual(['talk'])
  expect(await listed()).toHaveLength(1)
  // The upload that was left open no longer takes files.
  const late = await server.fetch(
    new Request(
      `${TEST_ORIGIN}/api/uploads/${stuck.body.deploymentId}/files/0`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${stuck.body.credential}` },
        body: html,
      },
    ),
    base,
  )
  expect([403, 409]).toContain(late.status)
})

test('F22-AC6: Given starts of new slides that never finished, When the author keeps starting others, Then the unfinished ones do not count toward the limit on slides', async () => {
  const env = limited({ decks: 2 })

  for (const title of ['One', 'Two', 'Three', 'Four', 'Five']) {
    const { status, body } = await start({ title }, { env })
    expect([title, status, body.code]).toEqual([title, 201, undefined])
  }

  expect(await liveDecks()).toEqual(['five'])
})

test('F22-AC6: Given the author has as many slides with a received version as allowed, When they start another, Then the limit still refuses it', async () => {
  const env = limited({ decks: 1 })
  expect((await start({ title: 'Kept' }, { env })).status).toBe(201)
  await db.update(deployments).set({ state: 'ready', ready_at: 1 })

  const { status, body } = await start({ title: 'More' }, { env })

  expect(status).toBe(409)
  expect(body.code).toBe('deck_limit')
  expect(await liveDecks()).toEqual(['kept'])
})

test('Given a first upload that failed or expired, When the author starts another new slide, Then the slide left without any version is released and its name can be used again', async () => {
  const failed = await start({ title: 'Broken' })
  await db
    .update(deployments)
    .set({ state: 'expired', expires_at: 1 })
    .where(eq(deployments.id, failed.body.deploymentId))

  expect((await start({ title: 'Other' })).body.slug).toBe('other')
  expect(await liveDecks()).toEqual(['other'])
  expect((await start({ title: 'Broken' }, { env: many })).body.slug).toBe(
    'broken',
  )
})

test('Given slides that have a received version, are receiving a file, or belong to someone else, When the author starts a new slide, Then none of them is released', async () => {
  const kept = await start({ title: 'Kept' }, { env: many })
  await db
    .update(deployments)
    .set({ state: 'ready', ready_at: 1 })
    .where(eq(deployments.id, kept.body.deploymentId))
  const receiving = await start({ title: 'Receiving' }, { env: many })
  await db
    .update(deployments)
    .set({ lease_id: 'receiving', lease_until: 9999999999 })
    .where(eq(deployments.id, receiving.body.deploymentId))
  const theirs = await start({ title: 'Theirs' }, { env: many, cookie: bob })
  await db
    .update(deployments)
    .set({ state: 'expired', expires_at: 1 })
    .where(eq(deployments.id, theirs.body.deploymentId))

  expect((await start({ title: 'Fresh' }, { env: many })).status).toBe(201)

  expect(await liveDecks()).toEqual(['fresh', 'kept', 'receiving'])
  expect(await liveDecks(INVITED_ID)).toEqual(['theirs'])
})

test('Given an entry other than the browser left a new slide unfinished, When it starts the slide again, Then the empty slide is released the same way', async () => {
  const first = await directStart(INVITED_ID)

  const again = await directStart(INVITED_ID)

  expect(again.slug).toBe('from-an-agent')
  expect(again.deploymentId).not.toBe(first.deploymentId)
  expect(await liveDecks(INVITED_ID)).toEqual(['from-an-agent'])
})

test.each([
  ['a title that is null', { name: { title: null } }, 201],
  ['a file name that is null', { name: { fileName: null } }, 201],
  ['a name that is null', { name: null }, 201],
])(
  'Given a start of a new slide with %s, When it arrives, Then it is taken as not given',
  async (_name, change, status) => {
    const response = await server.fetch(
      new Request(`${TEST_ORIGIN}/api/slides`, {
        method: 'POST',
        headers: {
          Cookie: alice,
          Origin: TEST_ORIGIN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attempt: nextAttempt(),
          ...(await inventory()),
          ...change,
        }),
      }),
      base,
    )

    expect(response.status).toBe(status)
    expect(((await response.json()) as Started).slug).toBe('slide')
  },
)

test.each([
  ['a title of 1001 characters', 'name', { name: { title: 'a'.repeat(1001) } }],
  ['a title that is a number', 'name', { name: { title: 7 } }],
  ['a name that is text', 'name', { name: 'talk' }],
  ['a name with a key it does not know', 'name', { name: { slug: 'x' } }],
  ['no attempt', 'attempt', { attempt: undefined }],
  ['an attempt that is too short', 'attempt', { attempt: 'short' }],
])(
  'Given a start of a new slide with %s, When it is refused, Then the error names what is wrong: the %s',
  async (_name, field, change) => {
    const response = await server.fetch(
      new Request(`${TEST_ORIGIN}/api/slides`, {
        method: 'POST',
        headers: {
          Cookie: alice,
          Origin: TEST_ORIGIN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attempt: nextAttempt(),
          ...(await inventory()),
          ...change,
        }),
      }),
      base,
    )

    expect(response.status).toBe(400)
    const { error } = (await response.json()) as { error: string }
    expect(error).toContain(`"${field}"`)
    expect(error).not.toContain(field === 'name' ? '"attempt"' : '"name"')
    expect(await db.$count(decks)).toBe(0)
  },
)
