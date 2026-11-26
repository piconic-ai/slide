import { and, eq } from 'drizzle-orm'
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
import type { Client } from '@modelcontextprotocol/client'
import server from '../app/routes'
import { decks, mcpGrants, suspensions, uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  bodyBytes,
  placeFiles,
  publish,
  sha256Hex,
  type TestFiles,
} from '../exports/test-upload'
import {
  INVITED_ID,
  OWNER_ID,
  seedDeck,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'
import { hashToken } from './authorization'
import { fileUrlKey, signFileUrl } from './file-url'
import { revokeConnection } from './connections-store'
import { callTool, connectAgent, mcpClient, type Tokens } from './test-connect'

// Each test puts slides up over HTTP; a loaded machine needs more than 5 s.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = {
  ...withInvited(testEnv(platform.env)),
  UPLOAD_LIMITS: { activeSessions: 20, startsPerDay: 1000, files: 500 },
} as unknown as Env
const SECRET = env.BETTER_AUTH_SECRET as string

let aliceCookie = ''
let bobCookie = ''
let aliceTokens: Tokens
let bobTokens: Tokens
let alice: Client
let bob: Client

const PNG = Uint8Array.from({ length: 3000 }, (_, i) => (i * 37 + 11) % 256)
const files: TestFiles = {
  'index.html':
    '<!doctype html><html><head><title>Talk</title></head><body><img src="img/pic.png"></body></html>',
  'app.js': 'console.log("FILE-CONTENT-MARKER")\n'.repeat(20),
  'img/pic.png': PNG,
  '日本語/資料 (1).html': '<p>こんにちは</p>',
}
const bytesOf = (value: string | Uint8Array) =>
  typeof value === 'string' ? new TextEncoder().encode(value) : value

type Listed = {
  slide: string
  versions: {
    role: 'published' | 'prepared'
    deploymentId: string
    receivedAt: string
    fileCount: number
    totalBytes: number
    files: {
      path: string
      size: number
      sha256: string
      mediaType: string
      url: string
    }[]
  }[]
  urlsExpireAt: string
  nextCursor: string | null
  next: string
}
const slideFiles = async (
  who: Client,
  slide: string,
  cursor?: string,
): Promise<{ isError: boolean; data: Record<string, unknown> }> =>
  callTool(who, 'get_slide_files', { slide, ...(cursor ? { cursor } : {}) })
const listed = async (who: Client, slide: string, cursor?: string) => {
  const answer = await slideFiles(who, slide, cursor)
  if (answer.isError) throw new Error(JSON.stringify(answer.data))
  return answer.data as unknown as Listed
}
const fetchUrl = (url: string, init: RequestInit = {}) =>
  server.fetch(new Request(url, init), env)

const logs = {
  log: vi.spyOn(console, 'log'),
  error: vi.spyOn(console, 'error'),
  warn: vi.spyOn(console, 'warn'),
  info: vi.spyOn(console, 'info'),
  debug: vi.spyOn(console, 'debug'),
}
const everythingLogged = () =>
  JSON.stringify(Object.values(logs).flatMap((spy) => spy.mock.calls))

let talk: { slug: string; published: string; prepared: string }
let privateSlug = ''
let bobSlug = ''
beforeAll(async () => {
  await applyMigrations(database)
  aliceCookie = await signIn(env, 'alice')
  bobCookie = await signIn(env, 'bob', { id: INVITED_ID })
  aliceTokens = (await connectAgent(env, aliceCookie, 'Alice agent')).tokens
  bobTokens = (await connectAgent(env, bobCookie, 'Bob agent')).tokens
  alice = await mcpClient(env, aliceTokens.access_token)
  bob = await mcpClient(env, bobTokens.access_token)
  const first = await placeFiles(env, aliceCookie, files)
  await publish(database, first.slug, first.deploymentId)
  const second = await placeFiles(
    env,
    aliceCookie,
    { ...files, 'app.js': 'console.log("NEWER")\n' },
    first.slug,
  )
  expect(second.slug).toBe(first.slug)
  talk = {
    slug: first.slug,
    published: first.deploymentId,
    prepared: second.deploymentId,
  }
  // A slide only the author has seen, and one that is Bob's.
  privateSlug = (
    await placeFiles(env, aliceCookie, { 'index.html': '<p>PRIVATE-ONE</p>' })
  ).slug
  const bobs = await placeFiles(env, bobCookie, {
    'index.html':
      '<!doctype html><title>Bobs secret talk</title><p>BOBS-SECRET</p>',
  })
  // Names are the author's own, so two authors may both have "slide"; give
  // Bob's a name no one else has, so a leak could not hide behind a clash.
  bobSlug = 'bobs-secret-talk'
  await db
    .update(decks)
    .set({ slug: bobSlug })
    .where(and(eq(decks.slug, bobs.slug), eq(decks.owner_user_id, INVITED_ID)))
})
beforeEach(async () => {
  await db.delete(suspensions)
  for (const spy of Object.values(logs)) spy.mockClear()
})
afterEach(() => vi.useRealTimers())
afterAll(async () => {
  await alice.close()
  await bob.close()
  await platform.dispose()
})

test('F35-AC33, F35-AC35: Given a slide with a published and a newer version, When the agent calls get_slide_files, Then each version lists every file with path, size, sha256 and an address, and no file’s content is in the answer', async () => {
  const answer = await slideFiles(alice, talk.slug)
  expect(answer.isError).toBe(false)
  const data = answer.data as unknown as Listed
  expect(data.slide).toBe(talk.slug)
  expect(data.nextCursor).toBeNull()
  expect(data.versions.map((v) => [v.role, v.deploymentId])).toEqual([
    ['published', talk.published],
    ['prepared', talk.prepared],
  ])
  for (const version of data.versions) {
    expect(version.fileCount).toBe(4)
    expect(version.files.map((f) => f.path)).toEqual([
      'app.js',
      'img/pic.png',
      'index.html',
      '日本語/資料 (1).html',
    ])
    const expected =
      version.role === 'published'
        ? files
        : { ...files, 'app.js': 'console.log("NEWER")\n' }
    for (const file of version.files) {
      const put = bytesOf(expected[file.path as keyof typeof expected]!)
      expect(file.size).toBe(put.length)
      expect(file.sha256).toBe(await sha256Hex(put))
      expect(file.url).toMatch(
        new RegExp(
          `^${TEST_ORIGIN}/mcp/files/[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]{43}$`,
        ),
      )
    }
    expect(version.totalBytes).toBe(
      version.files.reduce((sum, file) => sum + file.size, 0),
    )
  }
  const text = JSON.stringify(data)
  expect(text).not.toContain('FILE-CONTENT-MARKER')
  expect(text).not.toContain('NEWER')
  expect(text).not.toMatch(/objectKey|object_key|uploads\//)
  expect(answer.data.next).toEqual(expect.stringContaining('sha256'))
})

test('F35-AC36: Given the addresses get_slide_files returned, When each is fetched, Then the bytes match the answer’s sha256 and are what was put up, and the page script of the viewer is not added', async () => {
  const data = await listed(alice, talk.slug)
  for (const version of data.versions)
    for (const file of version.files) {
      const response = await fetchUrl(file.url)
      expect(response.status).toBe(200)
      const bytes = await bodyBytes(response)
      expect(bytes.length).toBe(file.size)
      expect(await sha256Hex(bytes)).toBe(file.sha256)
    }
  const index = data.versions[0]!.files.find((f) => f.path === 'index.html')!
  const body = new TextDecoder().decode(
    await bodyBytes(await fetchUrl(index.url)),
  )
  expect(body).toBe(files['index.html'])
  const png = data.versions[0]!.files.find((f) => f.path === 'img/pic.png')!
  expect(Array.from(await bodyBytes(await fetchUrl(png.url)))).toEqual(
    Array.from(PNG),
  )
})

test('F35-AC36, F35-AC27: Given a fetched file, When its headers are read, Then it is saved, never shown, and kept out of every cache', async () => {
  const data = await listed(alice, talk.slug)
  const html = data.versions[0]!.files.find((f) => f.path === 'index.html')!
  expect(html.mediaType).toContain('text/html')
  const response = await fetchUrl(html.url)
  const header = (name: string) => response.headers.get(name)
  expect(header('Content-Type')).toBe('application/octet-stream')
  expect(header('Content-Disposition')).toMatch(/^attachment;/)
  expect(header('Cache-Control')).toContain('no-store')
  expect(header('X-Content-Type-Options')).toBe('nosniff')
  expect(header('Content-Security-Policy')).toBe("default-src 'none'; sandbox")
  expect(header('Referrer-Policy')).toBe('no-referrer')
  expect(header('Content-Length')).toBe(String(html.size))
  await response.arrayBuffer()
})

test('F35-AC40: Given a slide that is only private, one the author paused and one an operator hid, When the agent asks for their files, Then the files list and fetch', async () => {
  const privateOne = await listed(alice, privateSlug)
  expect(privateOne.versions.map((v) => v.role)).toEqual(['prepared'])
  const file = privateOne.versions[0]!.files[0]!
  expect(
    new TextDecoder().decode(await bodyBytes(await fetchUrl(file.url))),
  ).toBe('<p>PRIVATE-ONE</p>')
  const paused = await placeFiles(env, aliceCookie, {
    'index.html': '<p>PAUSED</p>',
  })
  await publish(database, paused.slug, paused.deploymentId)
  await db
    .update(decks)
    .set({
      public_deployment_id: null,
      resume_deployment_id: paused.deploymentId,
      paused_at: 5,
    })
    .where(eq(decks.slug, paused.slug))
  const resting = await listed(alice, paused.slug)
  expect(resting.versions.map((v) => [v.role, v.deploymentId])).toEqual([
    ['published', paused.deploymentId],
  ])
  const hidden = await placeFiles(env, aliceCookie, {
    'index.html': '<p>HIDDEN</p>',
  })
  await publish(database, hidden.slug, hidden.deploymentId)
  await db
    .update(decks)
    .set({ hidden_at: 9 })
    .where(eq(decks.slug, hidden.slug))
  const taken = await listed(alice, hidden.slug)
  const url = taken.versions[0]!.files[0]!.url
  expect(new TextDecoder().decode(await bodyBytes(await fetchUrl(url)))).toBe(
    '<p>HIDDEN</p>',
  )
})

test('F35-AC33: Given a slide with no version, When get_slide_files is called, Then no version is listed and the answer says so', async () => {
  await seedDeck(database, 'bare', OWNER_ID)
  const data = await listed(alice, 'bare')
  expect(data.versions).toEqual([])
  expect(data.nextCursor).toBeNull()
  expect(String(data.next)).toContain('no version to export')
})

test('F35-AC33, F35-AC38: Given a slide name that is another author’s or that is not there, When get_slide_files is called, Then it is unknown_slide, the same for both, and nothing of the slide comes back', async () => {
  const foreign = await slideFiles(alice, bobSlug)
  const missing = await slideFiles(alice, 'no-such-slide')
  expect(foreign).toEqual(missing)
  expect(foreign.data.error).toBe('unknown_slide')
  expect(JSON.stringify(foreign)).not.toContain('BOBS')
  const theirs = await slideFiles(bob, talk.slug)
  expect(theirs.data.error).toBe('unknown_slide')
  await db.update(decks).set({ deleted_at: 1 }).where(eq(decks.slug, 'bare'))
  expect((await slideFiles(alice, 'bare')).data.error).toBe('unknown_slide')
})

test('F35-AC34: Given a version of more files than one answer holds, When the agent follows nextCursor, Then every file comes once, in order, with the whole count on each page, and a cursor from before a new version is refused', async () => {
  const many: Record<string, string> = {}
  for (let i = 0; i < 100; i++)
    many[`pages/p${String(i).padStart(3, '0')}.html`] = `<p>${i}</p>`
  many['index.html'] = '<p>many</p>'
  const placed = await placeFiles(env, aliceCookie, many)
  const first = await listed(alice, placed.slug)
  expect(first.versions).toHaveLength(1)
  expect(first.versions[0]!.files).toHaveLength(100)
  expect(first.versions[0]!.fileCount).toBe(101)
  expect(first.nextCursor).toEqual(expect.any(String))
  expect(String(first.next)).toContain('nextCursor')
  const second = await listed(alice, placed.slug, first.nextCursor!)
  expect(second.versions[0]!.files).toHaveLength(1)
  expect(second.versions[0]!.fileCount).toBe(101)
  expect(second.nextCursor).toBeNull()
  const paths = [...first.versions[0]!.files, ...second.versions[0]!.files].map(
    (f) => f.path,
  )
  expect(new Set(paths).size).toBe(101)
  expect(paths).toEqual(Object.keys(many).sort())
  // The files of the second page fetch like any other.
  const last = second.versions[0]!.files.at(-1)!
  expect(await sha256Hex(await bodyBytes(await fetchUrl(last.url)))).toBe(
    last.sha256,
  )
  // A newer version makes the cursor stale.
  await placeFiles(
    env,
    aliceCookie,
    { 'index.html': '<p>newer</p>' },
    placed.slug,
  )
  const stale = await slideFiles(alice, placed.slug, first.nextCursor!)
  expect(stale.isError).toBe(true)
  expect(stale.data.error).toBe('stale_cursor')
  expect(String(stale.data.message)).toContain('without a cursor')
})

test.each([
  ['text that is not a cursor', 'hello world'],
  ['base64url of something else', 'e30'],
  [
    'a cursor of another slide’s kind',
    btoa('{"r":"published","d":"x","a":"y"}').replaceAll('=', ''),
  ],
])(
  'F35-AC34: Given %s as the cursor, When get_slide_files is called, Then it is refused with a reason and lists nothing',
  async (_, cursor) => {
    const answer = await slideFiles(alice, talk.slug, cursor)
    expect(answer.isError).toBe(true)
    expect(['invalid_cursor', 'stale_cursor']).toContain(answer.data.error)
    expect(answer.data.versions).toBeUndefined()
  },
)

test('F35-AC37: Given an address, When it is used just before and just after its hour, Then it opens, then says it has run out, and says so without naming anything', async () => {
  const data = await listed(alice, talk.slug)
  const url = data.versions[0]!.files[0]!.url
  const expires = Date.parse(data.urlsExpireAt)
  expect(expires - Date.now()).toBeGreaterThan(3_590_000)
  expect(expires - Date.now()).toBeLessThanOrEqual(3_600_000)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(expires - 1000)
  const before = await fetchUrl(url)
  expect(before.status).toBe(200)
  await before.arrayBuffer()
  vi.setSystemTime(expires)
  const after = await fetchUrl(url)
  expect(after.status).toBe(410)
  const body = await after.text()
  expect(body).toContain('get_slide_files')
  expect(body).not.toContain(url.split('/').at(-1)!)
  expect(after.headers.get('Cache-Control')).toContain('no-store')
})

const tamper = (url: string, change: (value: string) => string) =>
  url.replace(/[^/]+$/, change)

test('F35-AC39: Given an address, When its value is changed in any way, Then nothing is returned and the answer is the same empty 404 as for any other failure', async () => {
  const data = await listed(alice, talk.slug)
  const url = data.versions[0]!.files[0]!.url
  const flip = (c: string) => (c === 'A' ? 'B' : 'A')
  const values = [
    tamper(url, (v) => flip(v[0]!) + v.slice(1)),
    tamper(url, (v) => v.slice(0, -2) + flip(v.at(-2)!) + v.at(-1)),
    tamper(url, (v) => v.slice(0, -1) + flip(v.at(-1)!)),
    tamper(url, (v) => v.split('.')[0]!),
    tamper(url, (v) => `${v}.${v}`),
    tamper(url, (v) => `${v}A`),
    tamper(url, () => 'x'),
    tamper(url, (v) => v.toUpperCase()),
    tamper(url, (v) => `${v.split('.')[1]}.${v.split('.')[0]}`),
  ]
  for (const changed of values) {
    const response = await fetchUrl(changed)
    expect(response.status, changed).toBe(404)
    expect(await response.text()).toBe('')
  }
  expect((await fetchUrl(`${TEST_ORIGIN}/mcp/files/`)).status).toBe(404)
})

test('F35-AC39, F35-AC38: Given an address, When the file or version it names is swapped for another without signing again, Then it opens nothing', async () => {
  const data = await listed(alice, talk.slug)
  const [payload, mac] = data.versions[0]!.files[0]!.url.split('/')
    .at(-1)!
    .split('.')
  const claims = JSON.parse(
    atob(payload!.replaceAll('-', '+').replaceAll('_', '/')),
  )
  const swapped = (changed: unknown[]) =>
    `${TEST_ORIGIN}/mcp/files/${btoa(JSON.stringify(changed)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}.${mac}`
  for (const changed of [
    [claims[0], claims[1], claims[2], '1', claims[4]],
    [claims[0], claims[1], talk.prepared, claims[3], claims[4]],
    [claims[0], 'another-grant', claims[2], claims[3], claims[4]],
    [claims[0], claims[1], claims[2], claims[3], claims[4] + 3600],
  ])
    expect((await fetchUrl(swapped(changed))).status).toBe(404)
})

test('F35-AC38: Given an address signed for one connection, When it names a file of another author’s slide, Then the file is not returned, even though the signature is the service’s own', async () => {
  const [grant] = await db
    .select({ id: mcpGrants.id })
    .from(mcpGrants)
    .where(
      eq(
        mcpGrants.access_token_hash,
        await hashToken(aliceTokens.access_token),
      ),
    )
  const bobData = await listed(bob, bobSlug)
  const bobsFile = bobData.versions[0]!.files[0]!
  const bobsClaims = JSON.parse(
    atob(
      bobsFile.url
        .split('/')
        .at(-1)!
        .split('.')[0]!
        .replaceAll('-', '+')
        .replaceAll('_', '/'),
    ),
  ) as [string, string, string, string, number]
  const key = await fileUrlKey(SECRET)
  const forged = await signFileUrl(key, {
    grantId: grant!.id,
    deploymentId: bobsClaims[2],
    fileId: bobsClaims[3],
    expiresAt: Math.floor(Date.now() / 1000) + 600,
  })
  const response = await fetchUrl(`${TEST_ORIGIN}/mcp/files/${forged}`)
  expect(response.status).toBe(404)
  expect(await response.text()).toBe('')
  // Bob’s own address, signed for Bob’s connection, does return his file.
  expect(
    new TextDecoder().decode(await bodyBytes(await fetchUrl(bobsFile.url))),
  ).toBe('<!doctype html><title>Bobs secret talk</title><p>BOBS-SECRET</p>')
})

test('F35-AC38: Given a file the row of which names an object outside its version, When it is fetched, Then nothing is read', async () => {
  const placed = await placeFiles(env, aliceCookie, {
    'index.html': '<p>x</p>',
  })
  const data = await listed(alice, placed.slug)
  const url = data.versions[0]!.files[0]!.url
  expect((await fetchUrl(url)).status).toBe(200)
  await db
    .update(uploadFiles)
    .set({ object_key: `${talk.published}/index.html` })
    .where(eq(uploadFiles.deployment_id, placed.deploymentId))
  const response = await fetchUrl(url)
  expect(response.status).toBe(404)
  expect(await response.text()).not.toContain('<p>')
})

test('F35-AC37: Given a connection the author ended, When an address made for it is fetched, Then it opens nothing at once, an hour or not', async () => {
  const { tokens, clientId } = await connectAgent(
    env,
    aliceCookie,
    'Short-lived agent',
  )
  const client = await mcpClient(env, tokens.access_token)
  const url = (await listed(client, talk.slug)).versions[0]!.files[0]!.url
  expect((await fetchUrl(url)).status).toBe(200)
  const [grant] = await db
    .select({ id: mcpGrants.id })
    .from(mcpGrants)
    .where(eq(mcpGrants.client_id, clientId))
  await revokeConnection(
    database,
    OWNER_ID,
    grant!.id,
    Math.floor(Date.now() / 1000),
  )
  const response = await fetchUrl(url)
  expect(response.status).toBe(404)
  expect(await response.text()).toBe('')
  await client.close()
})

test('F23-AC49: Given an author suspended after an address was made, When it is fetched and when the tool is called, Then neither gives anything', async () => {
  const data = await listed(alice, talk.slug)
  const url = data.versions[0]!.files[0]!.url
  await db.insert(suspensions).values({
    user_id: OWNER_ID,
    reason: 'phishing',
    suspended_at: 1,
    suspended_by: 'operator',
  })
  expect((await fetchUrl(url)).status).toBe(404)
  const refused = await slideFiles(alice, talk.slug)
  expect(refused.isError).toBe(true)
  expect(refused.data.error).toBe('not_allowed')
  expect(JSON.stringify(refused.data)).not.toContain('/mcp/files/')
})

test('F23-AC47: Given a connection made before the export scope, When it calls get_slide_files, Then it is told to connect again and gets no address; and an address made before it lost the scope stops too', async () => {
  const data = await listed(alice, talk.slug)
  const url = data.versions[0]!.files[0]!.url
  await db.update(mcpGrants).set({ scope: 'slides:upload' })
  const refused = await slideFiles(alice, talk.slug)
  expect(refused.isError).toBe(true)
  expect(refused.data.error).toBe('reconnect_required')
  expect(String(refused.data.message)).toContain('connect it again')
  expect(JSON.stringify(refused.data)).not.toContain('/mcp/files/')
  expect((await fetchUrl(url)).status).toBe(404)
  await db.update(mcpGrants).set({ scope: 'slides:upload slides:export' })
})

test('D-08: Given a service with no secret to sign with, When get_slide_files is called and an address is fetched, Then the tool says it is unavailable, the address opens nothing, and the other export tool still works', async () => {
  const data = await listed(alice, talk.slug)
  const url = data.versions[0]!.files[0]!.url
  const bare = { ...env, BETTER_AUTH_SECRET: undefined } as unknown as Env
  const client = await mcpClient(bare, aliceTokens.access_token)
  const refused = await slideFiles(client, talk.slug)
  expect(refused.isError).toBe(true)
  expect(refused.data.error).toBe('unavailable')
  expect((await callTool(client, 'export_account')).isError).toBe(false)
  expect((await server.fetch(new Request(url), bare)).status).toBe(404)
  const short = { ...env, BETTER_AUTH_SECRET: 'short' } as unknown as Env
  expect((await server.fetch(new Request(url), short)).status).toBe(404)
  await client.close()
})

test('F35-AC33: Given a published version whose file has an unsafe path and a newer version that is sound, When get_slide_files is called, Then the sound version lists its files and the other says why it does not, and no address is made for it', async () => {
  const placed = await placeFiles(env, aliceCookie, {
    'index.html': '<p>x</p>',
    'a.html': '<p>a</p>',
  })
  await publish(database, placed.slug, placed.deploymentId)
  const newer = await placeFiles(
    env,
    aliceCookie,
    { 'index.html': '<p>newer</p>' },
    placed.slug,
  )
  await db
    .update(uploadFiles)
    .set({ path: '../escape.html' })
    .where(
      and(
        eq(uploadFiles.deployment_id, placed.deploymentId),
        eq(uploadFiles.path, 'a.html'),
      ),
    )
  const answer = await slideFiles(alice, placed.slug)
  expect(answer.isError).toBe(false)
  const versions = answer.data.versions as Record<string, unknown>[]
  expect(versions.map((v) => [v.role, v.status])).toEqual([
    ['published', 'unavailable'],
    ['prepared', 'listed'],
  ])
  expect(versions[0]).toMatchObject({
    deploymentId: placed.deploymentId,
    reason: 'unsafe_path',
    message: expect.stringContaining('not safe to write'),
  })
  expect(versions[0]).not.toHaveProperty('files')
  expect(versions[1]).toMatchObject({ deploymentId: newer.deploymentId })
  const files = versions[1]!.files as { path: string; url: string }[]
  expect(files.map((f) => f.path)).toEqual(['index.html'])
  expect(
    new TextDecoder().decode(await bodyBytes(await fetchUrl(files[0]!.url))),
  ).toBe('<p>newer</p>')
  expect(String(answer.data.next)).toContain('status unavailable')
  expect(JSON.stringify(versions[0])).not.toContain('/mcp/files/')
})

test('F35-AC33: Given the only version has a file that is not stored, When get_slide_files is called, Then the version is named as unavailable with its reason and nothing else is listed', async () => {
  const placed = await placeFiles(env, aliceCookie, {
    'index.html': '<p>x</p>',
  })
  await db
    .update(uploadFiles)
    .set({ object_key: null })
    .where(eq(uploadFiles.deployment_id, placed.deploymentId))
  const answer = await slideFiles(alice, placed.slug)
  expect(answer.isError).toBe(false)
  expect(answer.data.versions).toMatchObject([
    { role: 'prepared', status: 'unavailable', reason: 'file_not_stored' },
  ])
  expect(answer.data.nextCursor).toBeNull()
  expect(JSON.stringify(answer.data)).not.toContain('/mcp/files/')
})

test('F35-AC41: Given every way an address can end, When it is used, Then nothing that is logged holds the address, its value or the connection it was made for', async () => {
  const data = await listed(alice, talk.slug)
  const url = data.versions[0]!.files[0]!.url
  const value = url.split('/').at(-1)!
  const [payload] = value.split('.')
  const responses = [
    await fetchUrl(url),
    await fetchUrl(tamper(url, (v) => `${v}x`)),
    await fetchUrl(tamper(url, () => 'junk')),
    await fetchUrl(url, { method: 'POST' }),
  ]
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.parse(data.urlsExpireAt) + 1000)
  responses.push(await fetchUrl(url))
  vi.useRealTimers()
  // A fetch that breaks inside: the bucket fails.
  const broken = {
    ...env,
    UPLOADS: {
      get: async () => {
        throw new Error(`R2 failed for ${url}`)
      },
    },
  } as unknown as Env
  const failed = await server.fetch(new Request(url), broken)
  responses.push(failed)
  expect(responses.map((r) => r.status)).toEqual([200, 404, 404, 405, 410, 500])
  const texts = await Promise.all(responses.map((r) => r.text()))
  const claims = JSON.parse(
    atob(payload!.replaceAll('-', '+').replaceAll('_', '/')),
  ) as string[]
  for (const secret of [
    value,
    payload!,
    claims[1]!,
    url,
    `/mcp/files/${value}`,
  ])
    for (const where of [everythingLogged(), ...texts.slice(1)])
      expect(where).not.toContain(secret)
  // The one error that was logged names its kind, not the message or the path.
  expect(logs.error).toHaveBeenCalledTimes(1)
  expect(JSON.parse(String(logs.error.mock.calls[0]![0]))).toEqual({
    event: 'export_file_error',
    name: 'Error',
  })
  // The tool’s own answer is not logged either.
  expect(everythingLogged()).not.toContain('FILE-CONTENT-MARKER')
})

test('F35-AC36: Given the budget of one address is spent, When an address is fetched, Then it is turned away with 429 before anything is read', async () => {
  const limited = {
    ...env,
    UPLOAD_RATE_LIMITER: { limit: async () => ({ success: false }) },
  } as unknown as Env
  const url = (await listed(alice, talk.slug)).versions[0]!.files[0]!.url
  const response = await server.fetch(
    new Request(url, { headers: { 'CF-Connecting-IP': '203.0.113.9' } }),
    limited,
  )
  expect(response.status).toBe(429)
  expect(response.headers.get('Retry-After')).toBe('60')
})

test('F35-AC36: Given an address, When it is asked for with another method or with a cookie, Then only GET opens it and the cookie means nothing', async () => {
  const url = (await listed(alice, talk.slug)).versions[0]!.files[0]!.url
  for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) {
    const response = await fetchUrl(url, { method })
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('GET')
  }
  // Bob’s cookie does not make Alice’s address his, nor Alice’s a requirement.
  const asBob = await fetchUrl(url, { headers: { Cookie: bobCookie } })
  expect(asBob.status).toBe(200)
  await asBob.arrayBuffer()
})

test('F23-AC50: Given the server’s instructions and the tools’ descriptions, When they are read, Then the order of writing everything out is there: export_account, list_slides, then get_slide_files and get_article_draft for each slide', async () => {
  const all = alice.getInstructions() ?? ''
  const instructions = all.slice(all.indexOf('To write out everything'))
  expect(instructions).not.toBe('')
  const at = (name: string) => instructions.indexOf(name)
  expect(at('export_account')).toBeGreaterThan(-1)
  expect(at('export_account')).toBeLessThan(at('list_slides'))
  expect(at('list_slides')).toBeGreaterThan(
    instructions.indexOf('To write out everything'),
  )
  expect(at('list_slides')).toBeLessThan(at('get_slide_files'))
  expect(at('get_slide_files')).toBeLessThan(at('get_article_draft'))
  expect(instructions).toContain('nextCursor')
  expect(instructions).toContain('sha256')
  expect(instructions).toContain('stops working after an hour')
  const { tools } = await alice.listTools()
  const description = (name: string) =>
    tools.find((tool) => tool.name === name)?.description ?? ''
  const files = description('get_slide_files')
  for (const word of [
    'nextCursor',
    'one hour',
    'sha256',
    'secret',
    '“..”',
    'never come back',
  ])
    expect(files).toContain(word)
  expect(description('export_account')).toContain('get_slide_files')
  expect(
    tools.find((tool) => tool.name === 'get_slide_files')?.annotations
      ?.readOnlyHint,
  ).toBe(true)
})
