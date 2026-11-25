import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import type { Client } from '@modelcontextprotocol/client'
import server from '../app/routes'
import { events, relatedLinkEvents, relatedLinks } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
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
let client: Client

beforeAll(async () => {
  await applyMigrations(database)
  const alice = await signIn(env, 'alice')
  client = await mcpClient(
    env,
    (await connectAgent(env, alice)).tokens.access_token,
  )
})
afterAll(async () => {
  await client.close()
  await platform.dispose()
})

let fresh = 0
/** A new slide of the author's: public when asked, else private. */
async function slide(published = false) {
  fresh += 1
  const slug = `ev${fresh}`
  if (published) await seedPublic(database, slug, fresh, `Talk ${fresh}`)
  else await seedDeck(database, slug, OWNER_ID)
  return slug
}
const add = (slide: string, args: Record<string, unknown>) =>
  callTool(client, 'add_related_link', { slide, ...args })
type Link = { url: string; kind: string }
const kindOf = (links: unknown, url: string) =>
  (links as Link[]).find((link) => link.url === url)?.kind
const eventIdOf = async (key: string) =>
  (await db.select().from(events).where(eq(events.key, key)).get())?.id
const eventPage = async (id: number | undefined) => {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/events/${id}`),
    env,
  )
  return { status: response.status, body: await response.text() }
}
const ties = async (url: string) =>
  db
    .select({ eventId: relatedLinkEvents.event_id })
    .from(relatedLinks)
    .innerJoin(
      relatedLinkEvents,
      eq(relatedLinkEvents.link_id, relatedLinks.id),
    )
    .where(eq(relatedLinks.url, url))
    .all()

test.each([
  ['a connpass event of a group', 'https://kanagawapm.connpass.com/event/7/'],
  ['a connpass event without a group', 'https://connpass.com/event/8/'],
  ['a Doorkeeper event', 'https://rubykaigi.doorkeeper.jp/events/9'],
  ['a Luma event', 'https://luma.com/abc123'],
  ['a Luma event on lu.ma', 'https://lu.ma/def456'],
])(
  'F23-AC42: Given add_related_link without a kind and the address of %s, When it is called, Then the link is an event',
  async (_name, url) => {
    const { isError, data } = await add(await slide(), { url })
    expect(isError).toBe(false)
    expect(kindOf(data.links, url)).toBe('event')
    expect(await ties(url)).toHaveLength(1)
  },
)

test.each([
  ['a Luma page of the site', 'https://luma.com/discover'],
  ['a connpass group page', 'https://kanagawapm.connpass.com/'],
  ['a connpass event list', 'https://connpass.com/event/'],
  ['a look-alike of connpass', 'https://connpass.com.example/event/1/'],
])(
  'F23-AC42: Given add_related_link without a kind and %s, When it is called, Then the link is not an event and no event is made',
  async (_name, url) => {
    const before = (await db.select().from(events).all()).length
    const { isError, data } = await add(await slide(), { url })
    expect(isError).toBe(false)
    expect(kindOf(data.links, url)).toBe('other')
    expect(await ties(url)).toEqual([])
    expect(await db.select().from(events).all()).toHaveLength(before)
  },
)

test('F23-AC42: Given add_related_link with the kind event and an address of no event service, When it is called, Then the link is an event of that page', async () => {
  const url = 'https://conf.example/2026/'
  const { isError, data } = await add(await slide(), { kind: 'event', url })
  expect(isError).toBe(false)
  expect(kindOf(data.links, url)).toBe('event')
  expect(await eventIdOf('https://conf.example/2026')).toBeDefined()
})

test('F23-AC42: Given add_related_link with a kind other than event and an event address, When it is called, Then the kind given is used and the link is not an event', async () => {
  const url = 'https://connpass.com/event/11/'
  const { data } = await add(await slide(), { kind: 'article', url })
  expect(kindOf(data.links, url)).toBe('article')
  expect(await ties(url)).toEqual([])
})

test('F23-AC42: Given add_related_link with a kind that is not one of the kinds, When it is called, Then it is refused and nothing is added', async () => {
  const deck = await slide()
  const url = 'https://connpass.com/event/12/'
  const { isError } = await add(deck, { kind: 'community', url })
  expect(isError).toBe(true)
  expect(await ties(url)).toEqual([])
  expect(
    await db.select().from(relatedLinks).where(eq(relatedLinks.url, url)),
  ).toEqual([])
})

test('F23-AC42: Given the tool list, When add_related_link is read, Then its kind may be event and is optional', async () => {
  const tool = (await client.listTools()).tools.find(
    (one) => one.name === 'add_related_link',
  )
  const schema = tool?.inputSchema as {
    required?: string[]
    properties?: Record<string, { enum?: string[] }>
  }
  expect(schema.properties?.kind?.enum).toContain('event')
  expect(schema.required).not.toContain('kind')
})

test('F23-AC43: Given a public slide, When add_related_link adds an event address to it, Then the slide is listed as a talk on the event page', async () => {
  const deck = await slide(true)
  const url = 'https://tokyo.connpass.com/event/4242/?utm_source=x'
  const { isError, data } = await add(deck, { url, title: 'Tokyo #42' })
  expect(isError).toBe(false)
  expect(
    kindOf(data.links, 'https://tokyo.connpass.com/event/4242/?utm_source=x'),
  ).toBe('event')
  const page = await eventPage(
    await eventIdOf('https://connpass.com/event/4242'),
  )
  expect(page.status).toBe(200)
  expect(page.body).toContain(`href="/@alice/${deck}"`)
  expect(page.body).toContain('Tokyo #42')
})

test('F23-AC43: Given a private slide, When add_related_link adds an event address to it, Then the event page does not list it', async () => {
  const deck = await slide()
  await add(deck, { url: 'https://connpass.com/event/4343/' })
  const page = await eventPage(
    await eventIdOf('https://connpass.com/event/4343'),
  )
  expect(page.status).toBe(404)
  expect(page.body).not.toContain(deck)
})

test('F23-AC44: Given the tool list, When its names and descriptions are read, Then no tool makes or changes a community or an event, or blocks anyone', async () => {
  const { tools } = await client.listTools()
  expect(
    tools.filter(({ name }) => /communit|event|block|mute/i.test(name)),
  ).toEqual([])
  expect(tools.map(({ name }) => name).sort()).toEqual([
    'add_related_link',
    'begin_upload',
    'finish_upload',
    'get_article_draft',
    'get_status',
    'list_slides',
    'put_article_draft',
    'put_slide',
    'remove_related_link',
    'replace_slide',
  ])
})

test('F23-AC45: Given the tool list, When add_related_link is read, Then its description says an event page’s address lists the slide as a talk of the event', async () => {
  const tool = (await client.listTools()).tools.find(
    (one) => one.name === 'add_related_link',
  )
  const description = tool?.description ?? ''
  expect(description).toContain('video, article, event or other')
  expect(description).toContain('event pages on connpass, Doorkeeper and Luma')
  expect(description).toContain('listed as a talk on that event’s page')
})
