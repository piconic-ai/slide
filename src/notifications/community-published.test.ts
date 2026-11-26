import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { block } from '../blocks/store'
import { deleteCommunity } from '../communities/admin-store'
import { followCommunity, unfollowCommunity } from '../communities/follow-store'
import {
  resetCommunities,
  seedCommunity,
  seedTalkLink,
} from '../communities/test-communities'
import { accounts, notifications } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { markAccountDeleted } from '../decks/deletion-store'
import { follow } from '../follows/store'
import { addRelatedLink } from '../mcp/article-api'
import { mute } from '../mutes/store'
import { applyAuthorCommand } from '../publication/author'
import { readPublication } from '../publication/store'
import { applyOperatorCommand } from '../publication/takedown-store'
import {
  OWNER_ID,
  seedDeck,
  seedDeployment,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import type { AuthorCommand } from '../publication/transitions'
import { countUnread, listNotifications, setReceive } from './store'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

const BOB = '202'
const CAROL = '303'
const DAVE = '404'
const COMMUNITY = 61
const EVENT = 'https://kanagawapm.connpass.com/event/1/'
const OTHER_EVENT = 'https://hono.connpass.com/event/9/'
let ownerCookie = ''

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetCommunities(database)
  ownerCookie = await signIn(env, 'owner')
  await db.insert(accounts).values([
    { user_id: BOB, handle: 'bob', created_at: 1 },
    { user_id: CAROL, handle: 'carol', created_at: 1 },
    { user_id: DAVE, handle: 'dave', created_at: 1 },
  ])
  await seedCommunity(database, {
    id: COMMUNITY,
    handle: 'kanagawapm',
    name: 'Kanagawa.pm',
    links: ['https://kanagawapm.connpass.com/'],
    creator: OWNER_ID,
  })
})
afterAll(() => platform.dispose())

const followAs = (userId: string, communityId = COMMUNITY, now = 10) =>
  followCommunity(database, { userId, communityId, now })

/** A draft of the owner with a ready version, which may already link to an event. */
async function draft(deckId = 'talk', url: string | null = EVENT) {
  await seedDeck(database, deckId, OWNER_ID, deckId)
  const deploymentId = await seedDeployment(database, deckId)
  if (url) await seedTalkLink(database, { deckId, url })
  return deploymentId
}

async function change(
  command: AuthorCommand,
  revision: number,
  now = 100,
  deckId = 'talk',
) {
  const result = await applyAuthorCommand(database, {
    ownerUserId: OWNER_ID,
    deckId,
    expectedRevision: revision,
    command,
    now,
  })
  expect(result.kind).toBe('applied')
}

const told = async () =>
  (
    await db
      .select({
        to: notifications.recipient_user_id,
        kind: notifications.kind,
        community: notifications.community_id,
        deck: notifications.deck_id,
      })
      .from(notifications)
      .where(eq(notifications.kind, 'community_published'))
  ).sort((a, b) => a.to.localeCompare(b.to))
const recipients = async () => (await told()).map((row) => row.to)

const post = (path: string, fields: Record<string, string>) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        Cookie: ownerCookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields).toString(),
    }),
    env,
  )

test('F20-AC15: Given followers of a community and a draft linked to its event, When the author publishes it first, Then each follower is told once, naming the community and the slide, and the author is not', async () => {
  await followAs(BOB)
  await followAs(CAROL)
  // The community's maker follows it (F31-AC17) and is the author here.
  const first = await draft()
  await change({ kind: 'publish', deploymentId: first }, 0)

  expect(await told()).toEqual([
    {
      to: BOB,
      kind: 'community_published',
      community: COMMUNITY,
      deck: 'talk',
    },
    {
      to: CAROL,
      kind: 'community_published',
      community: COMMUNITY,
      deck: 'talk',
    },
  ])
  const [item] = await listNotifications(database, BOB, 10)
  expect(item).toMatchObject({
    kind: 'community_published',
    actor: { handle: 'owner' },
    deck: { handle: 'owner', slug: 'talk' },
    community: { handle: 'kanagawapm', name: 'Kanagawa.pm' },
    unread: true,
  })
  expect(await countUnread(database, BOB)).toBe(1)
  expect(await countUnread(database, OWNER_ID)).toBe(0)
})

test('F20-AC15: Given a draft not linked to any event, When it is published, Then no follower is told', async () => {
  await followAs(BOB)
  const first = await draft('talk', null)
  await change({ kind: 'publish', deploymentId: first }, 0)
  expect(await told()).toEqual([])
})

test('F20-AC17: Given a follower already told, When the author updates the version, pauses and resumes, Then they still have one notice', async () => {
  await followAs(BOB)
  const first = await draft()
  await change({ kind: 'publish', deploymentId: first }, 0)
  const second = await seedDeployment(database, 'talk')
  await change({ kind: 'publish', deploymentId: second }, 1, 200)
  await change({ kind: 'pause' }, 2, 300)
  await change({ kind: 'publish', deploymentId: second }, 3, 400)
  expect(await recipients()).toEqual([BOB])
})

test('F20-AC17: Given a follower already told, When the link is removed and added again, or the kind is saved again, Then they still have one notice', async () => {
  await followAs(BOB)
  await change({ kind: 'publish', deploymentId: await draft() }, 0)
  const slide = { env, ownerUserId: OWNER_ID }
  const link = await db.all<{ id: string }>(
    sql`SELECT id FROM related_links WHERE deck_id = 'talk'`,
  )
  await post(`/my/slides/talk/links/${link[0]!.id}/delete`, {})
  expect((await addRelatedLink(slide, 'talk', { url: EVENT })).isError).toBe(
    undefined,
  )
  const [added] = await db.all<{ id: string }>(
    sql`SELECT id FROM related_links WHERE deck_id = 'talk'`,
  )
  await post('/my/slides/talk/links/kinds', {
    [`kind-${added!.id}`]: 'other',
  })
  await post('/my/slides/talk/links/kinds', {
    [`kind-${added!.id}`]: 'event',
  })
  expect(await recipients()).toEqual([BOB])
})

test('F20-AC17: Given the slide is in two communities the reader follows, When it is published, Then one notice names the one they followed first', async () => {
  await seedCommunity(database, {
    id: 70,
    handle: 'hono',
    name: 'Hono',
    links: ['https://hono.connpass.com/'],
    creator: OWNER_ID,
  })
  await followAs(BOB, 70, 5)
  await followAs(BOB, COMMUNITY, 9)
  await followAs(CAROL, COMMUNITY, 5)
  await followAs(CAROL, 70, 9)
  const first = await draft('talk', EVENT)
  await seedTalkLink(database, { deckId: 'talk', url: OTHER_EVENT })
  await change({ kind: 'publish', deploymentId: first }, 0)
  expect(await told()).toMatchObject([
    { to: BOB, community: 70 },
    { to: CAROL, community: COMMUNITY },
  ])
})

test('F20-AC17: Given someone follows the author and the community, When the slide is published, Then they have one notice, the author’s', async () => {
  await followAs(BOB)
  await follow(database, { follower: BOB, followee: OWNER_ID, now: 5 })
  await change({ kind: 'publish', deploymentId: await draft() }, 0)
  const rows = await db
    .select({ kind: notifications.kind })
    .from(notifications)
    .where(eq(notifications.recipient_user_id, BOB))
  expect(rows).toEqual([{ kind: 'followee_published' }])
})

test('F20-AC17: Given someone stopped the notice for people they follow, When the slide is published, Then the community’s notice still reaches them', async () => {
  await followAs(BOB)
  await follow(database, { follower: BOB, followee: OWNER_ID, now: 5 })
  await setReceive(database, BOB, 'followee_published', false)
  await change({ kind: 'publish', deploymentId: await draft() }, 0)
  expect(await recipients()).toEqual([BOB])
})

test('F20-AC16: Given a public slide, When the author adds an event link by the form, Then the follower is told and the slide opens from the notice', async () => {
  await followAs(BOB)
  await change({ kind: 'publish', deploymentId: await draft('talk', null) }, 0)
  expect(await told()).toEqual([])
  const response = await post('/my/slides/talk/links', { url: EVENT })
  expect(response.status).toBe(303)
  expect(await recipients()).toEqual([BOB])
})

test('F20-AC16: Given a public slide, When an event link is added through the MCP service, Then the follower is told', async () => {
  await followAs(BOB)
  await change({ kind: 'publish', deploymentId: await draft('talk', null) }, 0)
  await addRelatedLink({ env, ownerUserId: OWNER_ID }, 'talk', {
    kind: 'event',
    url: EVENT,
  })
  expect(await recipients()).toEqual([BOB])
})

test('F20-AC16: Given a public slide, When a link of another kind is added, or a link’s kind becomes event, Then only the event one tells', async () => {
  await followAs(BOB)
  await change({ kind: 'publish', deploymentId: await draft('talk', null) }, 0)
  await post('/my/slides/talk/links', { url: 'https://example.com/a' })
  expect(await told()).toEqual([])
  const [a] = await db.all<{ id: string }>(
    sql`SELECT id FROM related_links WHERE deck_id = 'talk'`,
  )
  await post('/my/slides/talk/links/kinds', { [`kind-${a!.id}`]: 'event' })
  // An event on a host no community holds is in none.
  expect(await told()).toEqual([])
  await post('/my/slides/talk/links', { url: EVENT })
  expect(await recipients()).toEqual([BOB])
})

test('F20-AC16: Given a public slide already in a community, When a later follower exists and an unrelated event link is added by the form, a kind change or the MCP service, Then the later follower is not told', async () => {
  await change({ kind: 'publish', deploymentId: await draft() }, 0)
  await followAs(BOB)
  expect(await told()).toEqual([])
  await post('/my/slides/talk/links', {
    url: 'https://unrelated.connpass.com/event/999/',
  })
  await addRelatedLink({ env, ownerUserId: OWNER_ID }, 'talk', {
    kind: 'event',
    url: 'https://other.connpass.com/event/5/',
  })
  await post('/my/slides/talk/links', { url: 'https://example.com/a' })
  const [plain] = await db.all<{ id: string }>(
    sql`SELECT id FROM related_links WHERE deck_id = 'talk' AND url = 'https://example.com/a'`,
  )
  await post('/my/slides/talk/links/kinds', {
    [`kind-${plain!.id}`]: 'event',
  })
  expect(await told()).toEqual([])
})

test('F20-AC16: Given a draft, and a slide paused before it was ever public, When an event link is added, Then nobody is told', async () => {
  await followAs(BOB)
  await draft('talk', null)
  await addRelatedLink({ env, ownerUserId: OWNER_ID }, 'talk', {
    kind: 'event',
    url: EVENT,
  })
  expect(await told()).toEqual([])
  const first = await seedDeployment(database, 'talk')
  await change({ kind: 'publish', deploymentId: first }, 0)
  await change({ kind: 'pause' }, 1, 200)
  await db.run(sql`DELETE FROM notifications`)
  await addRelatedLink({ env, ownerUserId: OWNER_ID }, 'talk', {
    kind: 'event',
    url: 'https://kanagawapm.connpass.com/event/2/',
  })
  expect(await told()).toEqual([])
})

test('F20-AC18: Given a slide that is public with an event link, When a community comes to hold the host later, or someone follows later, Then nobody is told', async () => {
  await change(
    { kind: 'publish', deploymentId: await draft('talk', OTHER_EVENT) },
    0,
  )
  await seedCommunity(database, {
    id: 70,
    handle: 'hono',
    links: ['https://hono.connpass.com/'],
    creator: OWNER_ID,
  })
  await followAs(BOB, 70)
  await followAs(CAROL)
  expect(await told()).toEqual([])
})

test('F20-AC15: Given followers who muted or blocked the author (either way) or stopped the notice, When the slide is published, Then only the one without any of these is told', async () => {
  const ERIN = '505'
  const FINN = '606'
  await db.insert(accounts).values([
    { user_id: ERIN, handle: 'erin', created_at: 1 },
    { user_id: FINN, handle: 'finn', created_at: 1 },
  ])
  for (const user of [BOB, CAROL, DAVE, ERIN, FINN]) await followAs(user)
  await mute(database, { muter: BOB, muted: OWNER_ID, now: 5 })
  await block(database, { blocker: CAROL, blocked: OWNER_ID, now: 5 })
  await block(database, { blocker: OWNER_ID, blocked: DAVE, now: 5 })
  await setReceive(database, ERIN, 'community_published', false)
  await change({ kind: 'publish', deploymentId: await draft() }, 0)
  expect(await recipients()).toEqual([FINN])
})

test('F20-AC10: Given a notice, When the slide is hidden, or the author is blocked after, Then it is not shown and returns when the slide does', async () => {
  await followAs(BOB)
  await change({ kind: 'publish', deploymentId: await draft() }, 0)
  expect(await countUnread(database, BOB)).toBe(1)
  await applyOperatorCommand(database, {
    deckId: 'talk',
    command: { kind: 'hide', reason: 'test reason', operator: 'op' },
    now: 200,
  })
  expect(await listNotifications(database, BOB, 10)).toEqual([])
  expect(await countUnread(database, BOB)).toBe(0)
  await applyOperatorCommand(database, {
    deckId: 'talk',
    command: { kind: 'release' },
    now: 300,
  })
  expect(await countUnread(database, BOB)).toBe(1)
  await block(database, { blocker: BOB, blocked: OWNER_ID, now: 400 })
  expect(await countUnread(database, BOB)).toBe(0)
})

test('F20-AC15: Given a notice, When the community is deleted, Then the notice goes and the others’ stay', async () => {
  await followAs(BOB)
  await change({ kind: 'publish', deploymentId: await draft() }, 0)
  await db.insert(notifications).values({
    id: 'other',
    kind: 'followed',
    recipient_user_id: BOB,
    actor_user_id: CAROL,
    created_at: 1,
  })
  expect(
    await deleteCommunity(
      { database, bucket: platform.env.UPLOADS },
      { communityId: COMMUNITY, now: 500 },
    ),
  ).toBe(true)
  expect(await told()).toEqual([])
  expect(
    (await db.select({ id: notifications.id }).from(notifications)).map(
      (row) => row.id,
    ),
  ).toEqual(['other'])
})

test('F20-AC15: Given a follower with a notice, When they leave the service, Then it goes', async () => {
  await followAs(BOB)
  await followAs(CAROL)
  await change({ kind: 'publish', deploymentId: await draft() }, 0)
  await markAccountDeleted(database, { ownerUserId: BOB, now: 500 })
  expect(await recipients()).toEqual([CAROL])
})

test('F31-AC19: Given the community, When someone follows it or lets go, Then nobody is told', async () => {
  await followAs(BOB)
  await unfollowCommunity(database, { userId: BOB, communityId: COMMUNITY })
  expect(await db.select().from(notifications)).toEqual([])
})

test('F20-AC15: Given the notifier fails, When the author first publishes, Then publication succeeds and the failure is logged', async () => {
  await followAs(BOB)
  await db.run(
    sql.raw(`CREATE TRIGGER refuse_community BEFORE INSERT ON notifications
    WHEN NEW.kind = 'community_published' BEGIN SELECT RAISE(ABORT, 'test refusal'); END`),
  )
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const first = await draft()
    await change({ kind: 'publish', deploymentId: first }, 0)
    expect(
      (await readPublication(database, 'talk', OWNER_ID))?.publication,
    ).toEqual({
      kind: 'public',
      deploymentId: first,
    })
    expect(await told()).toEqual([])
    expect(
      log.mock.calls.map(([message]) => JSON.parse(message)),
    ).toContainEqual({
      event: 'notifications_unrecorded',
      deckId: 'talk',
      name: expect.any(String),
    })
    // A link added to a public slide fails the same way, and still lands.
    const added = await addRelatedLink({ env, ownerUserId: OWNER_ID }, 'talk', {
      kind: 'event',
      url: 'https://kanagawapm.connpass.com/event/3/',
    })
    expect(added.isError).toBeUndefined()
  } finally {
    log.mockRestore()
    await db.run(sql`DROP TRIGGER refuse_community`)
  }
})

test('F20-AC16: Given the join of followers to events, When the query plan is read, Then the host index serves the event lookup', async () => {
  const plan = await db.all<{ detail: string }>(sql`EXPLAIN QUERY PLAN
    SELECT 1 FROM related_link_events WHERE host = 'kanagawapm.connpass.com'`)
  expect(plan.map((row) => row.detail).join('\n')).toContain(
    'related_link_events_host',
  )
})
