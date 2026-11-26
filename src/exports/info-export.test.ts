import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { keepArticle } from '../articles/store'
import {
  resetCommunities,
  seedCommunity,
  seedTalkLink,
} from '../communities/test-communities'
import {
  blocks,
  citations,
  communityFollows,
  decks,
  follows,
  mutes,
  profileLinks,
  profilePictures,
  suspensions,
} from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { addLink } from '../links/store'
import { connectAgent } from '../mcp/test-connect'
import {
  emailOf,
  INVITED_ID,
  OWNER_ID,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { bodyBytes, placeFiles, publish } from './test-upload'

// Each test puts slides up over HTTP; a loaded machine needs more than 5 s.
vi.setConfig({ testTimeout: 30_000 })

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const orm = drizzle(database)
const env = {
  ...testEnv(platform.env),
  UPLOAD_LIMITS: { activeSessions: 20, startsPerDay: 1000, files: 500 },
} as unknown as Env
await applyMigrations(database)
afterAll(() => platform.dispose())

const CAROL = '3001'
const DAVE = '3002'
const ERIN = '3003'
let alice = ''
let bob = ''

const get = (path: string, cookie = alice) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      headers: cookie ? { Cookie: cookie } : {},
    }),
    env,
  )
const firstDeckId = async () =>
  (await orm.select({ id: decks.id }).from(decks))[0]!.id
const json = async (path: string, cookie = alice) =>
  JSON.parse(new TextDecoder().decode(await bodyBytes(await get(path, cookie))))

beforeEach(async () => {
  await resetCommunities(database)
  const leases = await platform.env.UPLOADS.list({ prefix: 'exports/' })
  await platform.env.UPLOADS.delete(leases.objects.map(({ key }) => key))
  alice = await signIn(env, 'alice', {
    name: 'Alice A',
    bio: 'I give talks.',
    location: 'Tokyo',
    website: 'https://example.com/alice',
  })
  bob = await signIn(env, 'bob', { id: INVITED_ID, name: 'Bob B' })
}, 30_000)

describe('the information of one slide', () => {
  const seedSlide = async () => {
    const placed = await placeFiles(env, alice, {
      'index.html': '<!doctype html><title>Talk title</title><p>x</p>',
      'a/b.css': 'p{}',
    })
    await publish(database, placed.slug, placed.deploymentId)
    await seedTalkLink(database, {
      deckId: await firstDeckId(),
      owner: OWNER_ID,
      url: 'https://kanagawapm.connpass.com/event/410635/',
      title: 'Kanagawa.pm meetup',
    })
    await addLink(database, {
      deckId: await firstDeckId(),
      ownerUserId: OWNER_ID,
      link: { kind: 'video', url: 'https://example.com/video', title: 'Video' },
      now: 10,
    })
    return placed
  }

  it("F35-AC12, F35-AC13: Given a published slide, When its information is taken, Then it has the title, URL name, state, publication time, related links, events and each version's files with SHA-256, and the shape version", async () => {
    const placed = await seedSlide()

    const response = await get(`/my/slides/${placed.slug}/export/slide.json`)
    const info = JSON.parse(await response.text())

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe(
      'application/json; charset=utf-8',
    )
    expect(info.schemaVersion).toBe(1)
    expect(info.slide).toMatchObject({
      urlName: placed.slug,
      title: 'Talk title',
      state: 'public',
      firstPublishedAt: '1970-01-01T00:01:40.000Z',
      shareUrl: `${TEST_ORIGIN}/@alice/${placed.slug}`,
      hiddenByOperator: false,
    })
    expect(info.relatedLinks.map((link: { url: string }) => link.url)).toEqual(
      expect.arrayContaining(['https://example.com/video']),
    )
    expect(info.events).toHaveLength(1)
    expect(info.events[0]).toMatchObject({ service: 'connpass', ref: '410635' })
    expect(info.versions).toHaveLength(1)
    expect(info.versions[0].role).toBe('published')
    expect(info.versions[0].files).toEqual([
      expect.objectContaining({
        path: 'a/b.css',
        size: 3,
        mediaType: 'text/css; charset=utf-8',
      }),
      expect.objectContaining({ path: 'index.html' }),
    ])
    for (const file of info.versions[0].files)
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(info)).not.toContain('objectKey')
    expect(JSON.stringify(info)).not.toContain(placed.deploymentId + '/')
  })

  it('F35-AC12: Given a slide with a newer version, When its information is taken, Then both versions are listed, the published one first', async () => {
    const placed = await seedSlide()
    await placeFiles(env, alice, { 'index.html': 'new' }, placed.slug)

    const info = await json(`/my/slides/${placed.slug}/export/slide.json`)

    expect(info.versions.map((v: { role: string }) => v.role)).toEqual([
      'published',
      'prepared',
    ])
  })

  it("F35-AC24: Given another person's slide, When someone asks for its information, Then it is as if there were none", async () => {
    const placed = await seedSlide()

    expect(
      (await get(`/my/slides/${placed.slug}/export/slide.json`, bob)).status,
    ).toBe(404)
  })
})

describe('the article of one slide', () => {
  it('F35-AC11: Given a slide with an article, When it is taken, Then it is Markdown as written with embeds still naming their share URL', async () => {
    const placed = await placeFiles(env, alice, { 'index.html': 'x' })
    const body = `# Notes\n\n![](${TEST_ORIGIN}/@alice/${placed.slug}/2)\n`
    await keepArticle(database, {
      deckId: await firstDeckId(),
      body,
      status: 'draft',
      citations: [],
      now: 10,
    })

    const response = await get(`/my/slides/${placed.slug}/export/article.md`)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe(
      'text/markdown; charset=utf-8',
    )
    expect(response.headers.get('Content-Disposition')).toBe(
      `attachment; filename="${placed.slug}.md"`,
    )
    expect(await response.text()).toBe(body)
  })

  it('F35-AC11: Given a slide with no article, When the article is asked for, Then there is none', async () => {
    const placed = await placeFiles(env, alice, { 'index.html': 'x' })

    expect(
      (await get(`/my/slides/${placed.slug}/export/article.md`)).status,
    ).toBe(404)
  })
})

describe('the information of the account', () => {
  const seedAccount = async () => {
    await signIn(env, 'carol', { id: CAROL, name: 'Carol' })
    await signIn(env, 'dave', { id: DAVE, name: 'Dave' })
    await signIn(env, 'erin', { id: ERIN, name: 'Erin' })
    await orm.insert(profileLinks).values({
      user_id: OWNER_ID,
      position: 1,
      url: 'https://example.com/alice-social',
    })
    await orm
      .insert(profilePictures)
      .values({ user_id: OWNER_ID, uploaded_at: 5 })
    await orm.insert(follows).values([
      { follower_user_id: OWNER_ID, followee_user_id: CAROL, created_at: 10 },
      // Others' relations to Alice: nothing of these may come out.
      {
        follower_user_id: INVITED_ID,
        followee_user_id: OWNER_ID,
        created_at: 11,
      },
    ])
    await orm.insert(mutes).values([
      { muter_user_id: OWNER_ID, muted_user_id: DAVE, created_at: 12 },
      { muter_user_id: INVITED_ID, muted_user_id: OWNER_ID, created_at: 13 },
    ])
    await orm.insert(blocks).values([
      { blocker_user_id: OWNER_ID, blocked_user_id: ERIN, created_at: 14 },
      {
        blocker_user_id: INVITED_ID,
        blocked_user_id: OWNER_ID,
        created_at: 15,
      },
    ])
    await seedCommunity(database, {
      id: 1,
      handle: 'kanagawapm',
      name: 'Kanagawa.pm',
      links: ['https://kanagawapm.connpass.com/'],
      creator: OWNER_ID,
    })
    await seedCommunity(database, {
      id: 2,
      handle: 'bobscomm',
      name: 'Bobs community',
      links: ['https://bobscomm.connpass.com/'],
      creator: INVITED_ID,
    })
    await orm.insert(communityFollows).values({
      user_id: OWNER_ID,
      community_id: 2,
      created_at: 20,
    })
    const mine = await placeFiles(env, alice, {
      'index.html': '<title>Mine</title>',
    })
    await publish(database, mine.slug, mine.deploymentId)
    const theirs = await placeFiles(env, bob, {
      'index.html': '<title>Theirs</title>',
    })
    await publish(database, theirs.slug, theirs.deploymentId)
    await orm.insert(citations).values({
      deployment_id: mine.deploymentId,
      target_handle: 'bob',
      target_slug: theirs.slug,
      target_page: 3,
    })
    const agent = await connectAgent(env, alice, 'My agent')
    return { mine, theirs, agent }
  }

  it('F35-AC17, F35-AC18, F35-AC19, F35-AC20, F35-AC21, F35-AC22, F35-AC23: Given an account with all its parts, When its information is taken, Then it holds the profile, address, follows, mutes, blocks, managed community, agents and slides', async () => {
    const { mine, theirs, agent } = await seedAccount()

    const response = await get('/account/export/account.json')
    const text = await response.text()
    const info = JSON.parse(text)

    expect(response.status).toBe(200)
    expect(info.schemaVersion).toBe(1)
    expect(info.account).toMatchObject({
      handle: 'alice',
      email: emailOf('alice'),
    })
    expect(info.profile).toMatchObject({
      name: 'Alice A',
      bio: 'I give talks.',
      location: 'Tokyo',
      website: 'https://example.com/alice',
      links: ['https://example.com/alice-social'],
      hasUploadedPicture: true,
    })
    expect(info.following.map((f: { handle: string }) => f.handle)).toEqual([
      'carol',
    ])
    expect(
      info.followingCommunities.map((c: { handle: string }) => c.handle),
    ).toEqual(['kanagawapm', 'bobscomm']) // running a community follows it too
    expect(info.muted.map((m: { handle: string }) => m.handle)).toEqual([
      'dave',
    ])
    expect(info.blocked.map((b: { handle: string }) => b.handle)).toEqual([
      'erin',
    ])
    expect(info.managedCommunities).toHaveLength(1)
    expect(info.managedCommunities[0]).toMatchObject({
      handle: 'kanagawapm',
      name: 'Kanagawa.pm',
    })
    expect(info.managedCommunities[0].links[0].url).toContain(
      'kanagawapm.connpass.com',
    )
    expect(info.aiAgents).toHaveLength(1)
    expect(info.aiAgents[0].name).toBe('My agent')
    expect(info.slides).toHaveLength(1)
    expect(info.slides[0]).toMatchObject({
      urlName: mine.slug,
      title: 'Mine',
      state: 'public',
      shareUrl: `${TEST_ORIGIN}/@alice/${mine.slug}`,
    })
    // F35-AC23: a cited slide of another person is only its URL.
    expect(info.slides[0].cites).toEqual([
      `${TEST_ORIGIN}/@bob/${theirs.slug}/3`,
    ])
    expect(text).not.toContain('Theirs')
    // F35-AC22: no token, in any spelling.
    expect(text).not.toContain(agent.tokens.access_token)
    expect(text).not.toContain(agent.tokens.refresh_token)
  })

  it("F35-AC24: Given other people's relations to this person, When the information is taken, Then nothing of those relations or those people's data comes out", async () => {
    await seedAccount()

    const text = await (await get('/account/export/account.json')).text()

    // Bob follows, mutes and blocks Alice; none of that is hers to take.
    expect(text).not.toContain('"bob"')
    expect(text).not.toContain(emailOf('bob'))
    expect(text).not.toContain(emailOf('carol'))
    expect(text).not.toContain('Bob B')
    expect(text).not.toContain('followers')
  })

  it('F35-AC25: Given nobody is signed in, When the account information is asked for, Then they are sent to sign in', async () => {
    const response = await get('/account/export/account.json', '')

    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe('/login')
  })

  it('F35-AC26: Given a suspended person, When they ask for the account information or the picture, Then they get nothing', async () => {
    await orm.insert(suspensions).values({
      user_id: OWNER_ID,
      reason: 'test',
      suspended_at: 1,
      suspended_by: 'operator',
    })

    expect((await get('/account/export/account.json')).status).toBe(403)
    expect((await get('/account/export/picture')).status).toBe(403)
  })

  it('F35-AC27: Given the account information, When it answers, Then it is not cached', async () => {
    const response = await get('/account/export/account.json')

    expect(response.headers.get('Cache-Control')).toContain('no-store')
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="alice.json"',
    )
  })

  it("F35-AC17: Given an uploaded picture, When it is taken, Then it is the person's own picture; and another person's picture is never returned", async () => {
    await platform.env.UPLOADS.put(`avatars/${OWNER_ID}`, 'ALICE-PNG', {
      httpMetadata: { contentType: 'image/png' },
    })
    await platform.env.UPLOADS.put(`avatars/${INVITED_ID}`, 'BOB-PNG', {
      httpMetadata: { contentType: 'image/png' },
    })

    const mine = await get('/account/export/picture')
    const theirs = await get('/account/export/picture', bob)

    expect(await mine.text()).toBe('ALICE-PNG')
    expect(mine.headers.get('Content-Type')).toBe('image/png')
    expect(await theirs.text()).toBe('BOB-PNG')
  })

  it('F35-AC17: Given no uploaded picture, When it is asked for, Then there is none', async () => {
    await platform.env.UPLOADS.delete(`avatars/${OWNER_ID}`)

    expect((await get('/account/export/picture')).status).toBe(404)
  })

  it('F28-AC4: Given a person with no handle yet, When the account information is asked for, Then they are sent to the welcome page', async () => {
    const carol = await signIn(env, 'carol', { id: CAROL, welcomed: false })

    const response = await get('/account/export/account.json', carol)

    // Someone with no handle is first sent to choose one.
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toContain('/welcome')
  })
})
