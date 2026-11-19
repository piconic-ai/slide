import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import type { Client } from '@modelcontextprotocol/client'
import server from '../../server'
import { decks, deployments, uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  seedDeck,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'
import { callTool, connectAgent, mcpClient } from './test-connect'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = withInvited(testEnv(platform.env))
const html = Buffer.from(
  '<!doctype html><html><head><title>Large</title><script src="/_preview/pages.js"></script></head><body><img src="img/dot.png"></body></html>',
)
// A 1×1 PNG: bytes that are not text.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==',
  'base64',
)
const listed = (path: string, bytes: Buffer) => ({
  path,
  size: bytes.byteLength,
  sha256: createHash('sha256').update(bytes).digest('hex'),
})
const files = [listed('index.html', html), listed('img/dot.png', png)]
const bodies: Record<string, Buffer> = {
  'index.html': html,
  'img/dot.png': png,
}
let client: Client
let bobs: Client
let publicBefore = ''

beforeAll(async () => {
  await applyMigrations(database)
  const alice = await signIn(env, 'alice')
  const bob = await signIn(env, 'bob', { id: INVITED_ID })
  client = await mcpClient(
    env,
    (await connectAgent(env, alice)).tokens.access_token,
  )
  bobs = await mcpClient(
    env,
    (await connectAgent(env, bob)).tokens.access_token,
  )
  publicBefore = await seedPublic(database, 'keynote', 200, 'First', OWNER_ID)
  await seedDeck(database, 'bobs', INVITED_ID, 'secret')
})
afterAll(async () => {
  await client.close()
  await bobs.close()
  await platform.dispose()
})

type Plan = {
  uploadId: string
  credential: string
  credentialExpiresAt: string
  files: { path: string; method: string; url: string }[]
  headers: { Authorization: string }
}
/** Sends one file as the agent does: over HTTP, with the plan's header only. */
const send = (
  plan: Plan,
  path: string,
  authorization = plan.headers.Authorization,
) => {
  const target = plan.files.find((file) => file.path === path)
  return server.fetch(
    new Request(target?.url ?? '', {
      method: 'PUT',
      headers: { Authorization: authorization },
      body: new Uint8Array(bodies[path] ?? []),
    }),
    env,
  )
}
const begin = async (who = client, slide = 'keynote') => {
  const { isError, data } = await callTool(who, 'begin_upload', {
    slide,
    files,
  })
  expect(isError).toBe(false)
  return data as unknown as Plan
}
const stateOf = async (uploadId: string) =>
  (await db.select().from(deployments).where(eq(deployments.id, uploadId)))[0]

test('F23-AC7: Given begin_upload’s answer, When the agent sends each file to its URL and calls finish_upload, Then the version with its image is ready and private, and the public version is unchanged', async () => {
  const plan = await begin()
  expect(plan.files).toEqual([
    {
      path: 'img/dot.png',
      method: 'PUT',
      url: expect.stringMatching(
        new RegExp(`^${TEST_ORIGIN}/api/uploads/${plan.uploadId}/files/\\d+$`),
      ),
    },
    {
      path: 'index.html',
      method: 'PUT',
      url: expect.stringContaining(`/api/uploads/${plan.uploadId}/files/`),
    },
  ])
  expect(plan.headers.Authorization).toBe(`Bearer ${plan.credential}`)
  expect(Date.parse(plan.credentialExpiresAt)).toBeGreaterThan(Date.now())
  expect(Date.parse(plan.credentialExpiresAt)).toBeLessThanOrEqual(
    Date.now() + 60 * 60 * 1000 + 5000,
  )
  expect((await stateOf(plan.uploadId))?.state).toBe('uploading')
  for (const file of plan.files)
    expect((await send(plan, file.path)).status).toBe(200)
  const { isError, data } = await callTool(client, 'finish_upload', {
    uploadId: plan.uploadId,
    credential: plan.credential,
  })
  expect(isError).toBe(false)
  expect(data).toMatchObject({
    slide: 'keynote',
    uploadId: plan.uploadId,
    visibility: 'private',
    manageUrl: `${TEST_ORIGIN}/slides/keynote`,
    previewUrl: `${TEST_ORIGIN}/slides/keynote/deployments/${plan.uploadId}/preview`,
  })
  expect(await stateOf(plan.uploadId)).toMatchObject({
    state: 'ready',
    source: 'mcp',
    title: 'Large',
  })
  const stored = await db
    .select()
    .from(uploadFiles)
    .where(eq(uploadFiles.deployment_id, plan.uploadId))
  const image = stored.find((file) => file.path === 'img/dot.png')
  const object = await platform.env.UPLOADS.get(image?.object_key ?? '')
  expect(Buffer.from((await object?.arrayBuffer()) ?? []).equals(png)).toBe(
    true,
  )
  const [deck] = await db.select().from(decks).where(eq(decks.id, 'keynote'))
  expect(deck?.public_deployment_id).toBe(publicBefore)
})

test('F23-AC7: Given a credential past its hour, When the agent sends a file with it, Then the file is refused; and so is finish_upload', async () => {
  const plan = await begin()
  await db
    .update(deployments)
    .set({ credential_expires_at: Math.floor(Date.now() / 1000) - 1 })
    .where(eq(deployments.id, plan.uploadId))
  const refused = await send(plan, 'index.html')
  expect(refused.status).toBe(401)
  expect(await refused.json()).toMatchObject({ code: 'credential_expired' })
  const { isError, data } = await callTool(client, 'finish_upload', {
    uploadId: plan.uploadId,
    credential: plan.credential,
  })
  expect(isError).toBe(true)
  expect(data.error).toBe('credential_expired')
  expect((await stateOf(plan.uploadId))?.state).toBe('uploading')
})

test.each([
  ['no credential', ''],
  [
    'another upload’s kind of credential',
    'Bearer 00000000-0000-4000-8000-000000000000.00000000-0000-4000-8000-000000000000',
  ],
])(
  'F23-AC7: Given %s, When a file is sent to the upload’s URL, Then it is refused',
  async (_, authorization) => {
    const plan = await begin()
    expect((await send(plan, 'index.html', authorization)).status).toBe(401)
  },
)

test('F23-AC7: Given the access token of the MCP connection, When it is used in place of the upload credential, Then the upload routes refuse it: each credential opens only its own door', async () => {
  const plan = await begin()
  const { tokens } = await connectAgent(
    env,
    await signIn(env, 'alice'),
    'Other',
  )
  expect(
    (await send(plan, 'index.html', `Bearer ${tokens.access_token}`)).status,
  ).toBe(401)
})

test('Given an upload with a file not yet sent, When finish_upload is called, Then it says which file is missing, and succeeds once the file arrives', async () => {
  const plan = await begin()
  expect((await send(plan, 'index.html')).status).toBe(200)
  const early = await callTool(client, 'finish_upload', {
    uploadId: plan.uploadId,
    credential: plan.credential,
  })
  expect(early.isError).toBe(true)
  expect(early.data.error).toBe('files_missing')
  expect(early.data.message).toContain('img/dot.png')
  expect((await send(plan, 'img/dot.png')).status).toBe(200)
  const done = await callTool(client, 'finish_upload', {
    uploadId: plan.uploadId,
    credential: plan.credential,
  })
  expect(done.isError).toBe(false)
})

test('Given bytes that differ from the listed hash, When they are sent, Then the file is refused and the upload cannot finish', async () => {
  const plan = await begin()
  const target = plan.files.find((file) => file.path === 'index.html')
  const response = await server.fetch(
    new Request(target?.url ?? '', {
      method: 'PUT',
      headers: plan.headers,
      body: new TextEncoder().encode(html.toString().replace('Large', 'Other')),
    }),
    env,
  )
  expect(response.status).toBe(400)
  const finish = await callTool(client, 'finish_upload', {
    uploadId: plan.uploadId,
    credential: plan.credential,
  })
  expect(finish.data.error).toBe('files_missing')
})

test.each([
  ['another author’s slide', 'secret'],
  ['a slide that does not exist', 'no-such-slide'],
])(
  'F23-AC8: Given %s, When begin_upload names it, Then it is refused the same way and no upload starts',
  async (_, slide) => {
    const before = (await db.select().from(deployments)).length
    const { isError, data } = await callTool(client, 'begin_upload', {
      slide,
      files,
    })
    expect(isError).toBe(true)
    expect(data.error).toBe('unknown_slide')
    expect(await db.select().from(deployments)).toHaveLength(before)
  },
)

test('F23-AC8: Given another author’s upload and even its credential, When finish_upload is called, Then it is unknown and stays unfinished', async () => {
  const plan = await begin(bobs, 'secret')
  for (const file of plan.files)
    expect((await send(plan, file.path)).status).toBe(200)
  const { isError, data } = await callTool(client, 'finish_upload', {
    uploadId: plan.uploadId,
    credential: plan.credential,
  })
  expect(isError).toBe(true)
  expect(data.error).toBe('unknown_upload')
  expect((await stateOf(plan.uploadId))?.state).toBe('uploading')
  const unknown = await callTool(client, 'finish_upload', {
    uploadId: 'no-such-upload',
    credential: plan.credential,
  })
  expect(unknown.data.error).toBe('unknown_upload')
})

test.each([
  ['no index.html', [listed('main.html', html)]],
  [
    'a path that climbs out',
    [listed('index.html', html), listed('../x.css', png)],
  ],
  [
    'the same path twice',
    [listed('index.html', html), listed('index.html', html)],
  ],
  [
    'a hash that is not a hash',
    [{ path: 'index.html', size: 1, sha256: 'abc' }],
  ],
  [
    'an uppercase hash',
    [
      {
        ...listed('index.html', html),
        sha256: listed('index.html', html).sha256.toUpperCase(),
      },
    ],
  ],
])(
  'Given %s, When begin_upload is called, Then the list is refused as invalid and no upload starts',
  async (_, list) => {
    const before = (await db.select().from(deployments)).length
    const { isError, data } = await callTool(client, 'begin_upload', {
      slide: 'keynote',
      files: list,
    })
    expect(isError).toBe(true)
    expect(data.error).toBe('invalid_files')
    expect(await db.select().from(deployments)).toHaveLength(before)
  },
)

test.each([
  [
    'a negative size',
    {
      slide: 'keynote',
      files: [{ path: 'index.html', size: -1, sha256: 'a'.repeat(64) }],
    },
  ],
  [
    'a size that is no integer',
    {
      slide: 'keynote',
      files: [{ path: 'index.html', size: 1.5, sha256: 'a'.repeat(64) }],
    },
  ],
  ['no files', { slide: 'keynote', files: [] }],
])(
  'Given %s, When begin_upload is called, Then the arguments are refused',
  async (_, args) => {
    const refused = await client
      .callTool({ name: 'begin_upload', arguments: args })
      .then((result) => result.isError === true)
      .catch(() => true)
    expect(refused).toBe(true)
  },
)

test('Given a credential with characters no credential has, When finish_upload is called, Then the arguments are refused before anything is asked', async () => {
  const plan = await begin()
  const refused = await client
    .callTool({
      name: 'finish_upload',
      arguments: { uploadId: plan.uploadId, credential: 'x\r\nX-Injected: 1' },
    })
    .then((result) => result.isError === true)
    .catch(() => true)
  expect(refused).toBe(true)
})

test('F23-AC10: Given a file larger than one file may be, When begin_upload is called, Then it is refused and the answer says which limit', async () => {
  const limited = {
    ...env,
    UPLOAD_LIMITS: { fileBytes: 10, deploymentBytes: 1000, authorBytes: 1000 },
  } as unknown as Env
  const strict = await mcpClient(
    limited,
    (await connectAgent(limited, await signIn(limited, 'alice'), 'Strict'))
      .tokens.access_token,
  )
  const { isError, data } = await callTool(strict, 'begin_upload', {
    slide: 'keynote',
    files,
  })
  expect(isError).toBe(true)
  expect(data).toEqual({
    error: 'file_too_large',
    message: 'A file is larger than one file may be.',
  })
  await strict.close()
})

test('F23-AC3: Given every tool, When they are listed, Then they are the ones that list, replace, upload and tell status, and none publishes, unpublishes or deletes', async () => {
  const { tools } = await client.listTools()
  expect(tools.map((tool) => tool.name).sort()).toEqual([
    'begin_upload',
    'finish_upload',
    'get_status',
    'list_slides',
    'replace_slide',
  ])
  const begin = tools.find((tool) => tool.name === 'begin_upload')
  expect(begin?.description).toContain(
    '<script src="/_preview/pages.js"></script>',
  )
  expect(begin?.description).toContain('cannot publish')
})
