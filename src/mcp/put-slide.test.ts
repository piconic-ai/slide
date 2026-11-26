import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { decodeHTML } from 'entities'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import type { Client } from '@modelcontextprotocol/client'
import server from '../app/routes'
import { accounts, decks, deployments, uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  keepInvited,
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
const env = {
  ...withInvited(testEnv(platform.env)),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env
const page = (title: string) =>
  `<!doctype html><html><head><title>${title}</title></head><body>1</body></html>`
let alice = ''
let client: Client
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
})
afterAll(async () => {
  await client.close()
  await platform.dispose()
})

const get = (url: string, cookie = '') =>
  server.fetch(
    new Request(new URL(url, TEST_ORIGIN), { headers: { Cookie: cookie } }),
    env,
  )
const decksOf = (owner: string) =>
  db.select().from(decks).where(eq(decks.owner_user_id, owner))

/** Presses the manage page's own publish button for one version. */
async function pressPublish(manageUrl: string, uploadId: string) {
  const html = await (await get(manageUrl, alice)).text()
  const forms = html.match(/<form[\s\S]*?<\/form>/g) ?? []
  const form = forms.find(
    (candidate) =>
      /action="[^"]*\/publication"/.test(candidate) &&
      candidate.includes(uploadId) &&
      // A draft's only version is its first row, published by "公開する".
      />\s*公開する\s*</.test(candidate),
  )
  if (!form) throw new Error('No publish button for the version on the page')
  const fields = new URLSearchParams()
  for (const [, name, value] of form.matchAll(
    /<input[^>]*name="([^"]*)"[^>]*value="([^"]*)"/g,
  ))
    fields.set(decodeHTML(name ?? ''), decodeHTML(value ?? ''))
  const action = decodeHTML(/action="([^"]*)"/.exec(form)?.[1] ?? '')
  return server.fetch(
    new Request(new URL(action, TEST_ORIGIN), {
      method: 'POST',
      headers: { Cookie: alice, Origin: TEST_ORIGIN },
      body: fields,
    }),
    env,
  )
}

let made: Record<string, unknown> = {}

test('F23-AC4: Given small HTML, When put_slide is called, Then a slide is made with a URL name from its title, the manage and preview URLs come back, and only the author can see it', async () => {
  const { isError, data } = await callTool(client, 'put_slide', {
    files: [
      { path: 'index.html', text: page('My First Talk') },
      { path: 'assets/app.css', text: 'body { margin: 0 }' },
    ],
  })
  expect(isError).toBe(false)
  made = data
  const uploadId = String(data.uploadId)
  expect(data).toEqual({
    slide: 'my-first-talk',
    uploadId,
    visibility: 'private',
    manageUrl: `${TEST_ORIGIN}/my/slides/my-first-talk`,
    previewUrl: `${TEST_ORIGIN}/@alice/my-first-talk?v=${uploadId}`,
    nextStep: expect.stringContaining('press Publish'),
  })
  const [deck] = await decksOf(OWNER_ID)
  expect(deck).toMatchObject({
    slug: 'my-first-talk',
    public_deployment_id: null,
  })
  const [version] = await db
    .select()
    .from(deployments)
    .where(eq(deployments.id, uploadId))
  expect(version).toMatchObject({
    state: 'ready',
    source: 'mcp',
    title: 'My First Talk',
  })
  // Nobody but the author: no share URL, no manage page, no preview link.
  expect((await get('/@alice/my-first-talk')).status).toBe(404)
  expect((await get(String(data.manageUrl))).status).toBe(401)
  expect((await get(String(data.previewUrl))).status).toBe(404)
  const manage = await get(String(data.manageUrl), alice)
  expect(manage.status).toBe(200)
  expect(await manage.text()).toContain('My First Talk')
  expect((await get(String(data.previewUrl), alice)).status).toBe(200)
  const listed = await callTool(client, 'list_slides')
  expect(listed.data.slides).toEqual([
    expect.objectContaining({
      slide: 'my-first-talk',
      visibility: 'private',
      shareUrl: null,
    }),
  ])
})

test('F23-AC24: Given the slide put_slide made, When its stored index.html is read, Then it is the HTML as passed, without a page script added', async () => {
  const [file] = (
    await db
      .select()
      .from(uploadFiles)
      .where(eq(uploadFiles.deployment_id, String(made.uploadId)))
  ).filter((row) => row.path === 'index.html')
  const stored = await (
    await platform.env.UPLOADS.get(file?.object_key ?? '')
  )?.text()
  expect(stored).toBe(page('My First Talk'))
})

test('F23-AC5: Given the manage page put_slide returned, When the author presses its publish button, Then the slides are readable at the share URL by anyone', async () => {
  const pressed = await pressPublish(
    String(made.manageUrl),
    String(made.uploadId),
  )
  expect(pressed.status).toBe(303)
  expect(pressed.headers.get('location')).toContain('result=applied')
  const shared = await get('/@alice/my-first-talk')
  expect(shared.status).toBe(200)
  expect(await shared.text()).toContain('My First Talk')
  const status = await callTool(client, 'get_status', {
    slide: 'my-first-talk',
  })
  expect(status.data).toMatchObject({
    visibility: 'public',
    shareUrl: `${TEST_ORIGIN}/@alice/my-first-talk`,
    newestUpload: { isPublicVersion: true },
  })
})

test('Given a title passed beside the files, a title only in Japanese, and the same title again, When put_slide is called, Then the URL name comes from the title given, falls back to `slide`, and is numbered when taken', async () => {
  const named = await callTool(client, 'put_slide', {
    title: 'Keynote 2026',
    files: [{ path: 'index.html', text: page('ignored') }],
  })
  expect(named.data.slide).toBe('keynote-2026')
  const japanese = await callTool(client, 'put_slide', {
    files: [{ path: 'index.html', text: page('発表資料') }],
  })
  expect(japanese.data.slide).toBe('slide')
  const again = await callTool(client, 'put_slide', {
    title: 'Keynote 2026',
    files: [{ path: 'index.html', text: page('second') }],
  })
  expect(again.data.slide).toBe('keynote-2026-2')
})

test.each([
  [
    'HTML larger than a call may carry',
    [{ path: 'index.html', text: 'x'.repeat(MAX_ARGUMENT_BYTES + 1) }],
    'too_large_for_arguments',
  ],
  ['no index.html', [{ path: 'main.html', text: 'x' }], 'invalid_files'],
  [
    'a path that climbs out',
    [
      { path: 'index.html', text: 'x' },
      { path: '../x.css', text: 'x' },
    ],
    'invalid_files',
  ],
])(
  'F23-AC6: Given %s, When put_slide is called, Then it is refused as %s and no slide is made',
  async (_, files, error) => {
    const before = (await decksOf(OWNER_ID)).length
    const { isError, data } = await callTool(client, 'put_slide', { files })
    expect(isError).toBe(true)
    expect(data.error).toBe(error)
    expect(await decksOf(OWNER_ID)).toHaveLength(before)
  },
)

test('F23-AC10: Given an author who already has as many slides as one account may hold, When put_slide is called, Then it is refused with that reason and no slide is made', async () => {
  const limited = { ...env, UPLOAD_LIMITS: { decks: 1 } } as unknown as Env
  const strict = await mcpClient(
    limited,
    (await connectAgent(limited, alice, 'Strict')).tokens.access_token,
  )
  const before = (await decksOf(OWNER_ID)).length
  const { isError, data } = await callTool(strict, 'put_slide', {
    files: [{ path: 'index.html', text: page('One too many') }],
  })
  expect(isError).toBe(true)
  expect(data.error).toBe('deck_limit')
  expect(await decksOf(OWNER_ID)).toHaveLength(before)
  await strict.close()
})

test('F42-AC20: Given a newly registered author at the limit of new slides, When their agent calls put_slide, Then it is refused with the reason and when a new slide can be started again, and no slide is made', async () => {
  // The slides the earlier tests made count too: the limit leaves room for
  // exactly one more.
  const decksBefore = await decksOf(OWNER_ID)
  const limited = {
    ...env,
    NEW_AUTHOR_LIMITS: { perDay: decksBefore.length + 1 },
  } as unknown as Env
  const strict = await mcpClient(
    limited,
    (await connectAgent(limited, alice, 'New')).tokens.access_token,
  )
  const [account] = await db
    .select({ at: accounts.created_at })
    .from(accounts)
    .where(eq(accounts.user_id, OWNER_ID))
  const setRegisteredAt = (at: number) =>
    db
      .update(accounts)
      .set({ created_at: at })
      .where(eq(accounts.user_id, OWNER_ID))
  await setRegisteredAt(Math.floor(Date.now() / 1000) - 60)
  try {
    const first = await callTool(strict, 'put_slide', {
      files: [{ path: 'index.html', text: page('Last of the day') }],
    })
    expect(first.isError).toBeFalsy()
    const second = await callTool(strict, 'put_slide', {
      files: [{ path: 'index.html', text: page('One too many today') }],
    })
    expect(second.isError).toBe(true)
    expect(second.data.error).toBe('new_author_limit')
    const placed = (await decksOf(OWNER_ID)).map((row) => row.created_at)
    // Room opens when the perDay-th newest leaves the window: the oldest.
    const availableAt = new Date((Math.min(...placed) + 86_400) * 1000)
      .toISOString()
      .replace('.000Z', 'Z')
    expect(String(second.data.message)).toContain(availableAt)
    expect(String(second.data.help)).toContain('/help/slides/daily-limit')
    expect(await decksOf(OWNER_ID)).toHaveLength(decksBefore.length + 1)
  } finally {
    await setRegisteredAt(account!.at)
    await strict.close()
  }
})

test('F23-AC10: Given an author removed from the registered authors after connecting, When their agent calls put_slide, Then it is refused with the reason and no slide is made', async () => {
  await keepInvited(env.DB, [OWNER_ID])
  const removed = env
  const bobs = await mcpClient(removed, bobToken)
  const { isError, data } = await callTool(bobs, 'put_slide', {
    files: [{ path: 'index.html', text: page('After') }],
  })
  expect(isError).toBe(true)
  expect(data.error).toBe('not_allowed')
  expect(await decksOf(INVITED_ID)).toEqual([])
  await bobs.close()
})

test('F23-AC3: Given put_slide beside the other tools, When they are listed, Then none publishes, unpublishes or deletes, and put_slide says it cannot publish', async () => {
  const { tools } = await client.listTools()
  for (const tool of tools)
    expect(tool.name).not.toMatch(/publish|pause|delete|rename|setting/i)
  expect(
    tools.find((tool) => tool.name === 'put_slide')?.description,
  ).toContain('cannot publish')
})
