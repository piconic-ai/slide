import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import type { Client } from '@modelcontextprotocol/client'
import { autosaveArticle, keepArticle, readArticle } from '../articles/store'
import { decks, mcpGrants, suspensions } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  emailOf,
  INVITED_ID,
  OWNER_ID,
  seedDeck,
  seedPublic,
  signIn,
  testEnv,
  withInvited,
} from '../publication/test-support'
import { hashToken } from './authorization'
import { exportAccount } from './export-api'
import {
  callTool,
  connectAgent,
  ERAS,
  mcpClient,
  type Tokens,
} from './test-connect'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = withInvited(testEnv(platform.env))
let aliceTokens: Tokens
let bobTokens: Tokens
let alice: Client
let bob: Client

beforeAll(async () => {
  await applyMigrations(database)
  const aliceCookie = await signIn(env, 'alice')
  const bobCookie = await signIn(env, 'bob', { id: INVITED_ID })
  aliceTokens = (await connectAgent(env, aliceCookie, 'Alice agent')).tokens
  bobTokens = (await connectAgent(env, bobCookie, 'Bob agent')).tokens
  alice = await mcpClient(env, aliceTokens.access_token)
  bob = await mcpClient(env, bobTokens.access_token)
  await seedPublic(database, 'keynote', 200, 'Alice’s <keynote>', OWNER_ID)
  await seedDeck(database, 'draft', OWNER_ID)
  await seedPublic(database, 'hidden', 100, 'Taken down', OWNER_ID)
  await db.update(decks).set({ hidden_at: 7 }).where(eq(decks.id, 'hidden'))
  await seedPublic(database, 'bobs', 100, 'BOB-TITLE', INVITED_ID)
})
beforeEach(() => db.delete(suspensions))
afterAll(async () => {
  await alice.close()
  await bob.close()
  await platform.dispose()
})

type Account = {
  account: {
    account: { handle: string; email: string }
    slides: { urlName: string }[]
    aiAgents: { name: string }[]
  }
  slides: {
    slide: string
    title: string | null
    state: string
    hiddenByOperator: boolean
  }[]
  next: string
}

test('F35-AC32: Given an author with public, draft and hidden slides, When the agent calls export_account, Then the account information and the list of all the slides come back, with the URL name, title and state of each', async () => {
  const { isError, data } = await callTool(alice, 'export_account')
  expect(isError).toBe(false)
  const answer = data as unknown as Account
  expect(answer.account.account).toMatchObject({
    handle: 'alice',
    email: emailOf('alice'),
  })
  expect(answer.account.aiAgents.map(({ name }) => name)).toEqual([
    'Alice agent',
  ])
  expect(
    [...answer.slides].sort((a, b) => a.slide.localeCompare(b.slide)),
  ).toEqual([
    { slide: 'draft', title: null, state: 'draft', hiddenByOperator: false },
    {
      slide: 'hidden',
      title: 'Taken down',
      state: 'public',
      hiddenByOperator: true,
    },
    {
      slide: 'keynote',
      title: 'Alice’s <keynote>',
      state: 'public',
      hiddenByOperator: false,
    },
  ])
  expect(answer.account.slides.map(({ urlName }) => urlName).sort()).toEqual(
    answer.slides.map(({ slide }) => slide).sort(),
  )
})

test('F35-AC32: Given an author who paused a slide, When export_account is called, Then the slide is listed as paused', async () => {
  await seedPublic(database, 'resting', 50, 'Resting', OWNER_ID)
  const [row] = await db
    .select({ id: decks.public_deployment_id })
    .from(decks)
    .where(eq(decks.id, 'resting'))
  await db
    .update(decks)
    .set({
      public_deployment_id: null,
      resume_deployment_id: row!.id,
      paused_at: 60,
    })
    .where(eq(decks.id, 'resting'))
  const { data } = await callTool(alice, 'export_account')
  expect(
    (data as unknown as Account).slides.find((s) => s.slide === 'resting'),
  ).toMatchObject({ state: 'paused' })
  // Put in the bin, it is no longer one of the author's slides.
  await db
    .update(decks)
    .set({ resume_deployment_id: null, deleted_at: 9 })
    .where(eq(decks.id, 'resting'))
  const after = await callTool(alice, 'export_account')
  expect(
    (after.data as unknown as Account).slides.map((s) => s.slide),
  ).not.toContain('resting')
})

test('F35-AC32, F35-AC35: Given two authors, When one calls export_account, Then nothing of the other author’s is in the answer, and no file content or address of a file is', async () => {
  const answer = JSON.stringify((await callTool(alice, 'export_account')).data)
  expect(answer).not.toContain('BOB-TITLE')
  expect(answer).not.toContain('bobs')
  expect(answer).not.toContain(emailOf('bob'))
  expect(answer).not.toContain('Bob agent')
  // Only the author’s own are there; no file leaves in this answer.
  expect(answer).not.toMatch(/"(url|sha256|path|objectKey)"/)
  const bobs = (await callTool(bob, 'export_account'))
    .data as unknown as Account
  expect(bobs.slides.map(({ slide }) => slide)).toEqual(['bobs'])
  expect(bobs.account.account.email).toBe(emailOf('bob'))
})

test.each(ERAS)(
  'F35-AC32: Given a client that opens with %o, When it calls export_account, Then it is answered the same',
  async (era) => {
    const client = await mcpClient(env, aliceTokens.access_token, era)
    const { isError, data } = await callTool(client, 'export_account')
    expect(isError).toBe(false)
    expect((data as unknown as Account).slides).toHaveLength(3)
    await client.close()
  },
)

test('F35-AC32: Given a person who has no account, When export_account is run for them, Then it is refused as unknown_account and reads nothing', async () => {
  const answer = await exportAccount({ env, ownerUserId: 'nobody-at-all' })
  expect(answer.isError).toBe(true)
  expect(answer.structuredContent.error).toBe('unknown_account')
})

test('F23-AC47: Given a connection made before the export scope, When it calls export_account, Then it is told to connect again, in words the agent can pass on, and nothing is read', async () => {
  await db.update(mcpGrants).set({ scope: 'slides:upload' })
  const { isError, data } = await callTool(alice, 'export_account')
  expect(isError).toBe(true)
  expect(data.error).toBe('reconnect_required')
  const message = String(data.message)
  expect(message).toContain('connect it again')
  expect(message).toContain('Nothing was read')
  expect(message).toContain('“Put slides up from an AI agent”')
  expect(JSON.stringify(data)).not.toContain(emailOf('alice'))
  await db.update(mcpGrants).set({ scope: 'slides:upload slides:export' })
  expect((await callTool(alice, 'export_account')).isError).toBe(false)
})

test('F23-AC48: Given a connection made before the export scope, When it calls the tools that were there before, Then they answer as before', async () => {
  await db
    .update(mcpGrants)
    .set({ scope: 'slides:upload' })
    .where(
      eq(
        mcpGrants.access_token_hash,
        await hashToken(aliceTokens.access_token),
      ),
    )
  const listed = await callTool(alice, 'list_slides')
  expect(listed.isError).toBe(false)
  expect((listed.data.slides as unknown[]).length).toBe(3)
  expect(
    (await callTool(alice, 'get_status', { slide: 'keynote' })).isError,
  ).toBe(false)
  const article = await callTool(alice, 'get_article_draft', {
    slide: 'keynote',
  })
  expect(article.isError).toBe(false)
  await db.update(mcpGrants).set({ scope: 'slides:upload slides:export' })
})

test('F23-AC49: Given a suspended author, When their connection calls export_account, Then it is refused as every tool is, and a connection that is also an old one is refused the same way', async () => {
  await db.insert(suspensions).values({
    user_id: OWNER_ID,
    reason: 'phishing',
    suspended_at: 1,
    suspended_by: 'operator',
  })
  const refused = await callTool(alice, 'export_account')
  expect(refused.isError).toBe(true)
  expect(refused.data.error).toBe('not_allowed')
  expect(JSON.stringify(refused.data)).not.toContain(emailOf('alice'))
  await db.update(mcpGrants).set({ scope: 'slides:upload' })
  expect((await callTool(alice, 'export_account')).data.error).toBe(
    'not_allowed',
  )
  await db.update(mcpGrants).set({ scope: 'slides:upload slides:export' })
})

test('F23-AC51: Given the tool list, When its names and descriptions are read, Then no tool returns a zip or reads another author’s slides', async () => {
  const { tools } = await alice.listTools()
  expect(
    tools.filter(({ name, description }) =>
      /zip|archive|bundle|other author|any author/i.test(
        `${name} ${description}`,
      ),
    ),
  ).toEqual([])
  expect(tools.map(({ name }) => name).sort()).toEqual([
    'add_related_link',
    'begin_upload',
    'export_account',
    'finish_upload',
    'get_article_draft',
    'get_slide_files',
    'get_status',
    'list_slides',
    'put_article_draft',
    'put_slide',
    'remove_related_link',
    'replace_slide',
  ])
  // Every tool takes a slide of the connection's own author, by name.
  for (const tool of tools)
    expect(Object.keys(tool.inputSchema.properties ?? {})).not.toEqual(
      expect.arrayContaining(['handle']),
    )
  const exporter = tools.find(({ name }) => name === 'export_account')
  expect(exporter?.annotations?.readOnlyHint).toBe(true)
})

test('F35-AC42: Given a published article with a change the author has not published and a related link, When get_article_draft is called, Then the text being edited, the text readers see and the links all come back; a slide without an article returns its links too', async () => {
  await seedDeck(database, 'with-article', OWNER_ID)
  await keepArticle(database, {
    deckId: 'with-article',
    body: 'PUBLISHED TEXT',
    status: 'published',
    citations: [],
    now: 1,
  })
  await autosaveArticle(database, {
    deckId: 'with-article',
    body: 'WORKING DRAFT',
    known: (await readArticle(database, 'with-article'))!.revision,
    now: 2,
  })
  await callTool(alice, 'add_related_link', {
    slide: 'with-article',
    url: 'https://example.com/video',
    kind: 'video',
    title: 'The video',
  })
  const { data } = await callTool(alice, 'get_article_draft', {
    slide: 'with-article',
  })
  expect(data).toMatchObject({
    state: 'published_with_changes',
    body: 'WORKING DRAFT',
    publishedBody: 'PUBLISHED TEXT',
    relatedLinks: [
      {
        kind: 'video',
        url: 'https://example.com/video',
        title: 'The video',
        id: expect.any(String),
      },
    ],
  })
  await callTool(alice, 'add_related_link', {
    slide: 'draft',
    url: 'https://example.com/post',
  })
  const bare = await callTool(alice, 'get_article_draft', { slide: 'draft' })
  expect(bare.data).toMatchObject({
    state: 'none',
    body: null,
    publishedBody: null,
    relatedLinks: [{ url: 'https://example.com/post' }],
  })
})

test('F35-AC42: Given another author’s slide, When get_article_draft asks for it, Then it is unknown and no link or text of it comes back', async () => {
  const { isError, data } = await callTool(alice, 'get_article_draft', {
    slide: 'bobs',
  })
  expect(isError).toBe(true)
  expect(data.error).toBe('unknown_slide')
})
