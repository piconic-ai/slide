import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { decks, deployments, uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  resetTables,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'
import { VERSION_LIMITS } from '../uploads/version-limits'
import { planUpload, type PlannedFile } from './plan'
import {
  sendDrop,
  type Answer,
  type DropTarget,
  type SendInput,
  type SendRequest,
} from './send'

// The flow runs against the real routes, D1 and R2; only the browser's
// fetch is stood in for, by a function that calls the Worker.
const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const base = withInvited(testEnv(platform.env))
let cookie = ''

const bytes = (text: string) => new TextEncoder().encode(text)
async function plan(files: Record<string, string>): Promise<PlannedFile[]> {
  const planned = await planUpload(
    Object.entries(files).map(([path, text]) => ({ path, bytes: bytes(text) })),
    VERSION_LIMITS,
  )
  if (!planned.ok) throw new Error('expected a plan')
  return [...planned.files]
}
const page = '<!doctype html><head><title>My Talk</title></head><p>1</p>'

type Seen = { method: string; path: string; status: number }
/** Sends as the signed-in author's browser does, and notes every exchange. */
function browser(
  options: {
    env?: Env
    cookie?: string
    /** Answers instead of the Worker when it returns something. */
    intercept?: (
      path: string,
      method: string,
      seen: readonly Seen[],
    ) => Promise<Answer | undefined> | Answer | undefined
  } = {},
) {
  const seen: Seen[] = []
  const request: SendRequest = async (path, init) => {
    const instead = await options.intercept?.(path, init.method, seen)
    if (instead) {
      seen.push({ method: init.method, path, status: instead.status })
      return instead
    }
    const response = await server.fetch(
      new Request(`${TEST_ORIGIN}${path}`, {
        method: init.method,
        headers: {
          ...init.headers,
          Cookie: options.cookie ?? cookie,
          Origin: TEST_ORIGIN,
        },
        body: init.body as BodyInit | undefined,
      }),
      options.env ?? base,
    )
    const body: unknown = await response.json().catch(() => null)
    seen.push({ method: init.method, path, status: response.status })
    return { status: response.status, body }
  }
  return { request, seen }
}
let sequence = 0
const input = async (
  request: SendRequest,
  change: Partial<SendInput> = {},
): Promise<SendInput> => ({
  request,
  wait: async () => {},
  target: { kind: 'new' },
  attempt: `send-test-attempt-${String(++sequence).padStart(4, '0')}`,
  name: { title: 'My Talk', fileName: 'talk.html' },
  files: await plan({ 'index.html': page }),
  ...change,
})
const versions = () =>
  db
    .select({
      id: deployments.id,
      state: deployments.state,
      title: deployments.title,
      source: deployments.source,
    })
    .from(deployments)
    .orderBy(deployments.created_at)

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetTables(database)
  cookie = await signIn(base, 'alice')
})
afterAll(() => platform.dispose())

test('F22-AC33: Given a signed-in author and one HTML file, When it is sent, Then a new slide is ready that only the author can read, and the answer names the page to manage it', async () => {
  const { request, seen } = browser()
  const progress: [number, number][] = []

  const result = await sendDrop(
    await input(request, {
      onProgress: (received, total) => progress.push([received, total]),
    }),
  )

  expect(result).toEqual({
    ok: true,
    slug: 'my-talk',
    manageUrl: `${TEST_ORIGIN}/slides/my-talk`,
    viewUrl: `${TEST_ORIGIN}/@alice/my-talk`,
  })
  expect(await versions()).toMatchObject([
    { state: 'ready', title: 'My Talk', source: 'browser' },
  ])
  expect(
    await db
      .select({
        owner: decks.owner_user_id,
        public: decks.public_deployment_id,
      })
      .from(decks),
  ).toEqual([{ owner: OWNER_ID, public: null }])
  expect(seen.map(({ method, status }) => `${method} ${status}`)).toEqual([
    'POST 201',
    'PUT 200',
    'POST 200',
  ])
  expect(progress).toEqual([
    [0, 1],
    [1, 1],
  ])
  // Nobody but the author reaches the slide: it has no public version.
  const anonymous = await server.fetch(
    new Request(`${TEST_ORIGIN}/slides/my-talk`),
    base,
  )
  expect(anonymous.status).toBe(401)
})

test('F22-AC7: Given a sent HTML file, When the stored index.html is read back, Then it loads the page script exactly once', async () => {
  const { request } = browser()
  const sent = await input(request)

  const result = await sendDrop(sent)

  expect(result.ok).toBe(true)
  const [file] = await db.select().from(uploadFiles)
  const stored = await (await platform.env.UPLOADS.get(
    file!.object_key!,
  ))!.text()
  expect(stored.split('/_preview/pages.js').length - 1).toBe(1)
  expect(stored).toBe(new TextDecoder().decode(sent.files[0]!.bytes))
})

test('Given a slide with several files, When it is sent, Then each is received and the progress counts them', async () => {
  const { request } = browser()
  const progress: number[] = []
  const files = await plan({
    'index.html': page,
    'assets/site.css': 'body{margin:0}',
    'assets/photo.png': 'not really a png',
  })

  const result = await sendDrop(
    await input(request, {
      files,
      onProgress: (received) => progress.push(received),
    }),
  )

  expect(result.ok).toBe(true)
  expect(progress).toEqual([0, 1, 2, 3])
  expect(
    (await db.select({ path: uploadFiles.path }).from(uploadFiles)).map(
      ({ path }) => path,
    ),
  ).toEqual(
    expect.arrayContaining([
      'index.html',
      'assets/site.css',
      'assets/photo.png',
    ]),
  )
})

const versionOf = (slug: string): DropTarget => ({ kind: 'version', slug })

test('F22-AC15: Given a public slide, When a new version is sent to it, Then the version is ready and what readers see stays the earlier one', async () => {
  const first = browser()
  expect((await sendDrop(await input(first.request))).ok).toBe(true)
  const [earlier] = await versions()
  await db
    .update(decks)
    .set({ public_deployment_id: earlier!.id, first_published_at: 1 })

  const second = browser()
  const result = await sendDrop(
    await input(second.request, {
      target: versionOf('my-talk'),
      files: await plan({ 'index.html': page.replace('<p>1</p>', '<p>2</p>') }),
    }),
  )

  expect(result).toMatchObject({ ok: true, slug: 'my-talk' })
  expect((await versions()).map(({ state }) => state)).toEqual([
    'ready',
    'ready',
  ])
  expect(
    await db.select({ public: decks.public_deployment_id }).from(decks),
  ).toEqual([{ public: earlier!.id }])
  expect(await db.$count(decks)).toBe(1)
})

test('Given a file whose send fails once with a server error, When the drop is sent, Then that request is tried again and the drop finishes', async () => {
  let failed = false
  const { request, seen } = browser({
    intercept: (_path, method) => {
      if (method !== 'PUT' || failed) return undefined
      failed = true
      return { status: 500, body: null }
    },
  })
  const waits: number[] = []

  const result = await sendDrop(
    await input(request, { wait: async (ms) => void waits.push(ms) }),
  )

  expect(result.ok).toBe(true)
  expect(seen.filter(({ method }) => method === 'PUT')).toHaveLength(2)
  expect(waits).toEqual([500])
  expect(await db.$count(deployments)).toBe(1)
})

test('Given the network drops one request, When the drop is sent, Then it is tried again and the drop finishes', async () => {
  let dropped = false
  const real = browser()
  const request: SendRequest = async (path, init) => {
    if (init.method === 'PUT' && !dropped) {
      dropped = true
      throw new TypeError('Failed to fetch')
    }
    return real.request(path, init)
  }

  expect((await sendDrop(await input(request))).ok).toBe(true)
})

test('Given the credential expires while files are being sent, When the drop goes on, Then the same attempt is started again and the same upload is finished', async () => {
  let expired = false
  const { request, seen } = browser({
    intercept: async (_path, method) => {
      if (method !== 'PUT' || expired) return undefined
      expired = true
      await db.update(deployments).set({ credential_expires_at: 1 })
      return undefined
    },
  })

  const result = await sendDrop(await input(request))

  expect(result.ok).toBe(true)
  expect(seen.map(({ method, status }) => `${method} ${status}`)).toEqual([
    'POST 201',
    'PUT 401',
    'POST 201',
    'PUT 200',
    'POST 200',
  ])
  expect(await versions()).toMatchObject([{ state: 'ready' }])
  expect(await db.$count(decks)).toBe(1)
})

test('Given a received file is lost before the finalize, When the drop goes on, Then only that file is sent again and the drop finishes', async () => {
  let lost = false
  const { request, seen } = browser({
    intercept: async (path) => {
      if (!path.endsWith('/finalize') || lost) return undefined
      lost = true
      const [file] = await db
        .select()
        .from(uploadFiles)
        .where(eq(uploadFiles.path, 'assets/site.css'))
      await platform.env.UPLOADS.delete(file!.object_key!)
      return undefined
    },
  })

  const result = await sendDrop(
    await input(request, {
      files: await plan({ 'index.html': page, 'assets/site.css': 'a{}' }),
    }),
  )

  expect(result.ok).toBe(true)
  const puts = seen.filter(({ method }) => method === 'PUT')
  // Two files, then the lost one once more.
  expect(puts).toHaveLength(3)
  expect(await versions()).toMatchObject([{ state: 'ready' }])
})

test('Given every request keeps failing, When the drop is sent, Then it gives up after a bounded number of tries and nothing is ready', async () => {
  const { request, seen } = browser({
    intercept: (_path, method) =>
      method === 'PUT' ? { status: 503, body: null } : undefined,
  })
  const waits: number[] = []

  const result = await sendDrop(
    await input(request, { wait: async (ms) => void waits.push(ms) }),
  )

  expect(result).toMatchObject({ ok: false, reason: 'failed' })
  expect(seen.filter(({ method }) => method === 'PUT')).toHaveLength(5)
  expect(waits).toEqual([500, 1000, 2000, 4000])
  expect((await versions()).map(({ state }) => state)).toEqual(['uploading'])
})

test('F22-AC17: Given nobody is signed in, When a drop is sent, Then it is refused as signed out and nothing is made', async () => {
  const { request } = browser({ cookie: '' })

  expect(await sendDrop(await input(request))).toMatchObject({
    ok: false,
    reason: 'sign_in',
  })
  expect(await db.$count(decks)).toBe(0)
})

test('F22-AC16: Given an author taken off the registration while signed in, When they send a drop, Then it is refused as invitation-only and nothing is received', async () => {
  const removed = await signIn(base, 'bob', { id: INVITED_ID })
  // Only the first author is registered now.
  const { request, seen } = browser({
    cookie: removed,
    env: testEnv(platform.env),
  })

  expect(await sendDrop(await input(request))).toMatchObject({
    ok: false,
    reason: 'invitation_only',
  })
  expect(seen).toHaveLength(1)
  expect(await db.$count(decks)).toBe(0)
  expect(await db.$count(deployments)).toBe(0)
})

test('F22-AC6: Given the author has as many slides as allowed, When they send another, Then it is refused naming the limit on slides', async () => {
  const env = { ...base, UPLOAD_LIMITS: { decks: 1 } } as unknown as Env
  expect((await sendDrop(await input(browser({ env }).request))).ok).toBe(true)

  const result = await sendDrop(
    await input(browser({ env }).request, { name: { title: 'Another' } }),
  )

  expect(result).toMatchObject({ ok: false, reason: 'deck_limit' })
  expect(await db.$count(decks)).toBe(1)
})

test.each([
  ['one file', { fileBytes: 10 }, 'file_too_large'],
  ['the number of files', { files: 1 }, 'too_many_files'],
  [
    'one version',
    { deploymentBytes: 200, fileBytes: 200 },
    'deployment_too_large',
  ],
])(
  'F22-AC6: Given the service’s limit on %s is lower than the sender’s, When a drop over it is sent, Then it is refused naming that limit and nothing is made',
  async (_name, limits, limit) => {
    const env = { ...base, UPLOAD_LIMITS: limits } as unknown as Env
    const { request } = browser({ env })

    const result = await sendDrop(
      await input(request, {
        files: await plan({ 'index.html': page, 'a.css': 'a{}'.repeat(40) }),
      }),
    )

    expect(result).toMatchObject({ ok: false, reason: 'limit', limit })
    expect(await db.$count(decks)).toBe(0)
  },
)

test('F22-AC17: Given a slug the author has no slide for, When a new version is sent to it, Then it is refused as not found', async () => {
  const { request } = browser()

  expect(
    await sendDrop(await input(request, { target: versionOf('not-mine') })),
  ).toMatchObject({ ok: false, reason: 'not_found' })
})

test('Given a file the service does not take, When the drop is sent, Then it is refused as invalid and nothing is made', async () => {
  const { request } = browser()
  const [index] = await plan({ 'index.html': page })

  const result = await sendDrop(
    await input(request, {
      files: [index!, { ...index!, path: '.git/config.json' }],
    }),
  )

  expect(result).toMatchObject({ ok: false, reason: 'invalid' })
  expect(await db.$count(decks)).toBe(0)
})

test('Given another upload of the author is receiving a file, When a drop is sent, Then it waits, and is refused as busy when that does not end', async () => {
  expect((await sendDrop(await input(browser().request))).ok).toBe(true)
  await db.update(deployments).set({
    state: 'uploading',
    ready_at: null,
    expires_at: 9999999999,
    lease_id: 'receiving',
    lease_until: 9999999999,
  })
  const { request, seen } = browser()

  const result = await sendDrop(
    await input(request, { name: { title: 'Another' } }),
  )

  expect(result).toMatchObject({ ok: false, reason: 'busy' })
  expect(seen).toHaveLength(5)
})

test('Given a start whose answer is not a receipt, When the drop is sent, Then it fails without sending files', async () => {
  const { request, seen } = browser({
    intercept: (_path, method) =>
      method === 'POST'
        ? { status: 201, body: { deploymentId: 'x' } }
        : undefined,
  })

  expect(await sendDrop(await input(request))).toMatchObject({
    ok: false,
    reason: 'failed',
  })
  expect(seen).toHaveLength(1)
})

test('Given a drop that failed halfway, When the same files are sent again under the same attempt, Then the same upload is finished and no second slide is made', async () => {
  let failing = true
  const { request } = browser({
    intercept: (_path, method) =>
      method === 'PUT' && failing ? { status: 503, body: null } : undefined,
  })
  const first = await input(request)

  const failed = await sendDrop(first)
  expect(failed).toEqual({ ok: false, reason: 'failed', resumable: true })
  failing = false
  const again = await sendDrop({ ...first })

  expect(again).toMatchObject({ ok: true, slug: 'my-talk' })
  expect(await versions()).toMatchObject([{ state: 'ready' }])
  expect(await db.$count(decks)).toBe(1)
})

test.each(['session_expired', 'session_failed'])(
  'Given the service closed the upload (%s), When the send ends, Then it says the attempt cannot be continued',
  async (code) => {
    const { request } = browser({
      intercept: (_path, method) =>
        method === 'PUT' ? { status: 409, body: { code } } : undefined,
    })

    expect(await sendDrop(await input(request))).toEqual({
      ok: false,
      reason: 'failed',
      resumable: false,
    })
  },
)

test('Given an attempt whose upload expired, When it is started again, Then the failure says a new attempt is needed', async () => {
  const { request } = browser({
    intercept: (_path, method) =>
      method === 'PUT' ? { status: 503, body: null } : undefined,
  })
  const first = await input(request)
  await sendDrop(first)
  await db.update(deployments).set({ state: 'expired', expires_at: 1 })

  expect(await sendDrop({ ...first, request: browser().request })).toEqual({
    ok: false,
    reason: 'failed',
    resumable: false,
  })
})
