import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import type { Client } from '@modelcontextprotocol/client'
import server from '../../server'
import { decks, deployments, suspensions, uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  seedDeck,
  seedDeployment,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'
import { MAX_ARGUMENT_BYTES } from './files'
import { callTool, connectAgent, mcpClient } from './test-connect'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = withInvited(testEnv(platform.env))
const TAG = '<script src="/_preview/pages.js"></script>'
const page = (title: string) =>
  `<!doctype html><html><head><title>${title}</title></head><body>1</body></html>`
let alice = ''
let client: Client
let publicBefore = ''
let bobToken = ''

beforeAll(async () => {
  await applyMigrations(database)
  alice = await signIn(env, 'alice')
  const bob = await signIn(env, 'bob', { id: INVITED_ID })
  client = await mcpClient(
    env,
    (await connectAgent(env, alice)).tokens.access_token,
  )
  bobToken = (await connectAgent(env, bob)).tokens.access_token
  publicBefore = await seedPublic(database, 'keynote', 200, 'First', OWNER_ID)
  await seedDeck(database, 'draft', OWNER_ID)
  await seedDeck(database, 'bobs', INVITED_ID, 'secret')
})
afterAll(async () => {
  await client.close()
  await platform.dispose()
})

const versionsOf = (deck: string) =>
  db.select().from(deployments).where(eq(deployments.deck_id, deck))
/** The stored bytes of one file of an upload, as text. */
async function storedText(uploadId: string, path: string) {
  const [file] = await db
    .select()
    .from(uploadFiles)
    .where(eq(uploadFiles.deployment_id, uploadId))
    .then((rows) => rows.filter((row) => row.path === path))
  const object = await platform.env.UPLOADS.get(file?.object_key ?? '')
  return object ? object.text() : null
}

test('F23-AC9: Given a public slide, When replace_slide puts a new version up, Then the version is ready and private, the public version is unchanged, and the manage and preview URLs come back', async () => {
  const { isError, data } = await callTool(client, 'replace_slide', {
    slide: 'keynote',
    files: [
      { path: 'index.html', text: page('Second') },
      { path: 'assets/app.css', text: 'body { color: red }' },
    ],
  })
  expect(isError).toBe(false)
  const uploadId = String(data.uploadId)
  expect(data).toEqual({
    slide: 'keynote',
    uploadId,
    visibility: 'private',
    manageUrl: `${TEST_ORIGIN}/slides/keynote`,
    previewUrl: `${TEST_ORIGIN}/@alice/keynote?v=${uploadId}`,
    nextStep: expect.stringContaining('press Publish'),
  })
  const [version] = (await versionsOf('keynote')).filter(
    (row) => row.id === uploadId,
  )
  expect(version).toMatchObject({
    state: 'ready',
    source: 'mcp',
    title: 'Second',
  })
  const [deck] = await db.select().from(decks).where(eq(decks.id, 'keynote'))
  expect(deck?.public_deployment_id).toBe(publicBefore)
  // Readers still get the version that was public before.
  const shared = await server.fetch(
    new Request(`${TEST_ORIGIN}/@alice/keynote`),
    env,
  )
  expect(shared.status).toBe(200)
  expect(await shared.text()).toContain('First')
})

test('F23-AC12: Given HTML put up through replace_slide, When the stored file is read, Then it loads the page script exactly once', async () => {
  const without = await callTool(client, 'replace_slide', {
    slide: 'draft',
    files: [{ path: 'index.html', text: page('Plain') }],
  })
  const stored = await storedText(String(without.data.uploadId), 'index.html')
  expect(stored?.split(TAG)).toHaveLength(2)
  const already = await callTool(client, 'replace_slide', {
    slide: 'draft',
    files: [
      {
        path: 'index.html',
        text: page('Has it').replace('</head>', `${TAG}</head>`),
      },
    ],
  })
  const kept = await storedText(String(already.data.uploadId), 'index.html')
  expect(kept?.split('/_preview/pages.js')).toHaveLength(2)
})

test.each([
  ['another author’s slide', 'secret'],
  ['a slide that does not exist', 'no-such-slide'],
  ['a name no slide can have', '../keynote'],
])(
  'F23-AC8: Given %s, When replace_slide names it, Then it is refused the same way, and nothing is stored anywhere',
  async (_, slide) => {
    const before = (await db.select().from(deployments)).length
    const { isError, data } = await callTool(client, 'replace_slide', {
      slide,
      files: [{ path: 'index.html', text: page('Intruder') }],
    })
    expect(isError).toBe(true)
    expect(data).toEqual({
      error: 'unknown_slide',
      message:
        'The author has no slide with that URL name. Call list_slides to see the names.',
    })
    expect(await db.select().from(deployments)).toHaveLength(before)
    expect(await versionsOf('bobs')).toEqual([])
  },
)

test('F23-AC6: Given HTML larger than a call may carry, When replace_slide is called, Then nothing is received and the answer says to use begin_upload and finish_upload', async () => {
  const before = (await versionsOf('draft')).length
  const { isError, data } = await callTool(client, 'replace_slide', {
    slide: 'draft',
    files: [{ path: 'index.html', text: page('x'.repeat(MAX_ARGUMENT_BYTES)) }],
  })
  expect(isError).toBe(true)
  expect(data.error).toBe('too_large_for_arguments')
  expect(data.message).toContain('begin_upload')
  expect(data.message).toContain('finish_upload')
  expect(await versionsOf('draft')).toHaveLength(before)
})

test.each([
  ['a path that climbs out', [{ path: '../index.html', text: 'x' }]],
  ['no index.html', [{ path: 'other.html', text: 'x' }]],
  [
    'the same path twice',
    [
      { path: 'index.html', text: 'a' },
      { path: 'index.html', text: 'b' },
    ],
  ],
])(
  'Given %s, When replace_slide is called, Then the files are refused as invalid and nothing is stored',
  async (_, files) => {
    const before = (await versionsOf('draft')).length
    const { isError, data } = await callTool(client, 'replace_slide', {
      slide: 'draft',
      files,
    })
    expect(isError).toBe(true)
    expect(data.error).toBe('invalid_files')
    expect(await versionsOf('draft')).toHaveLength(before)
  },
)

test.each([
  ['no files', { slide: 'draft', files: [] }],
  [
    'content that is not text',
    { slide: 'draft', files: [{ path: 'index.html', text: 7 }] },
  ],
  [
    'binary content in place of text',
    {
      slide: 'draft',
      files: [{ path: 'index.html', text: { base64: 'AAAA' } }],
    },
  ],
  ['no slide', { files: [{ path: 'index.html', text: 'x' }] }],
])(
  'Given %s, When replace_slide is called, Then the arguments are refused and nothing is stored',
  async (_, args) => {
    const before = (await versionsOf('draft')).length
    const refused = await client
      .callTool({ name: 'replace_slide', arguments: args })
      .then((result) => result.isError === true)
      .catch(() => true)
    expect(refused).toBe(true)
    expect(await versionsOf('draft')).toHaveLength(before)
  },
)

test('F23-AC10: Given a version with more files than one version may hold, When replace_slide is called, Then it is refused and the answer says which limit', async () => {
  const limited = { ...env, UPLOAD_LIMITS: { files: 1 } } as unknown as Env
  const strict = await mcpClient(
    limited,
    (await connectAgent(limited, alice, 'Strict')).tokens.access_token,
  )
  const { isError, data } = await callTool(strict, 'replace_slide', {
    slide: 'draft',
    files: [
      { path: 'index.html', text: page('Two') },
      { path: 'b.css', text: '' },
    ],
  })
  expect(isError).toBe(true)
  expect(data).toEqual({
    error: 'too_many_files',
    message: 'The version has more files than one version may hold.',
  })
  await strict.close()
})

test('F23-AC10: Given an author removed from the registered authors after connecting, When their agent calls replace_slide, Then it is refused with the reason and nothing is stored', async () => {
  const removed = { ...env, AUTHOR_GITHUB_IDS: OWNER_ID } as unknown as Env
  const bobs = await mcpClient(removed, bobToken)
  const { isError, data } = await callTool(bobs, 'replace_slide', {
    slide: 'secret',
    files: [{ path: 'index.html', text: page('After') }],
  })
  expect(isError).toBe(true)
  expect(data.error).toBe('not_allowed')
  expect(data.message).toContain('not registered as an author')
  expect(await versionsOf('bobs')).toEqual([])
  await bobs.close()
})

test('F23-AC10: Given an author suspended after connecting, When their agent calls replace_slide, Then it is refused with the reason and nothing is stored', async () => {
  const before = (await versionsOf('draft')).length
  await db.insert(suspensions).values({
    user_id: OWNER_ID,
    reason: 'phishing',
    suspended_at: 1,
    suspended_by: 'operator',
  })
  const { isError, data } = await callTool(client, 'replace_slide', {
    slide: 'draft',
    files: [{ path: 'index.html', text: page('After') }],
  })
  await db.delete(suspensions)
  expect(isError).toBe(true)
  expect(data.error).toBe('not_allowed')
  expect(await versionsOf('draft')).toHaveLength(before)
})

test('Given the author’s browser is in the middle of receiving a file for another slide, When their agent calls replace_slide, Then the agent is told an upload is in progress and the browser’s upload goes on', async () => {
  const at = Math.floor(Date.now() / 1000)
  const receiving = await seedDeployment(database, 'keynote', 'uploading')
  await db
    .update(deployments)
    .set({
      created_at: at,
      expires_at: at + 3600,
      lease_id: 'browser-lease',
      lease_until: at + 120,
    })
    .where(eq(deployments.id, receiving))
  const before = (await versionsOf('draft')).length
  const { isError, data } = await callTool(client, 'replace_slide', {
    slide: 'draft',
    files: [{ path: 'index.html', text: page('Meanwhile') }],
  })
  expect(isError).toBe(true)
  expect(data.error).toBe('upload_busy')
  expect(await versionsOf('draft')).toHaveLength(before)
  const [still] = (await versionsOf('keynote')).filter(
    (row) => row.id === receiving,
  )
  expect(still).toMatchObject({ state: 'uploading', lease_id: 'browser-lease' })
  // Between files it holds no lease: the newest start takes its place, as
  // a browser's second start does.
  await db
    .update(deployments)
    .set({ lease_id: null, lease_until: null })
    .where(eq(deployments.id, receiving))
  const later = await callTool(client, 'replace_slide', {
    slide: 'draft',
    files: [{ path: 'index.html', text: page('After') }],
  })
  expect(later.isError).toBe(false)
  const [replaced] = (await versionsOf('keynote')).filter(
    (row) => row.id === receiving,
  )
  expect(replaced?.state).toBe('expired')
})

test('Given a slide being deleted, When replace_slide names it, Then it is unknown', async () => {
  await seedDeck(database, 'going', OWNER_ID)
  await db.update(decks).set({ deleted_at: 5 }).where(eq(decks.id, 'going'))
  const { data } = await callTool(client, 'replace_slide', {
    slide: 'going',
    files: [{ path: 'index.html', text: page('Late') }],
  })
  expect(data.error).toBe('unknown_slide')
})

test('F23-AC3: Given the tools after replace_slide is added, When they are listed, Then none publishes, unpublishes or deletes, and replace_slide says it cannot publish', async () => {
  const { tools } = await client.listTools()
  for (const tool of tools)
    expect(tool.name).not.toMatch(/publish|pause|delete|remove|rename|setting/i)
  const replace = tools.find((tool) => tool.name === 'replace_slide')
  expect(replace?.description).toContain('cannot publish')
  expect(replace?.annotations).toMatchObject({ destructiveHint: false })
})
