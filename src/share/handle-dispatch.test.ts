import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { accounts, citations, handles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { HANDLE_HOLD_SECONDS } from '../handles/hold'
import { renameHandle, takeHandle } from '../handles/store'
import {
  OWNER_ID,
  resetTables,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'
import type { Handle } from './handle'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = withInvited({
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env)

const get = (path: string) =>
  server.fetch(new Request(new URL(path, TEST_ORIGIN)), env)
const h = (text: string) => text as Handle
const person = { kind: 'person', id: OWNER_ID } as const
const now = () => Math.floor(Date.now() / 1000)

let deployment = ''

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetTables(database)
  await signIn(env, 'alice')
  deployment = await seedPublic(
    database,
    'alice-talk',
    100,
    'Alice talk',
    OWNER_ID,
    'talk',
  )
})
afterAll(() => platform.dispose())

test.each(['/@alice', '/@alice/talk', '/@alice/followers', '/@alice/cited'])(
  'F30-AC6: Given a person of the second scope, When %s is opened after the shared handles, Then it opens their page as before',
  async (path) => {
    const response = await get(path)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('alice')
  },
)

test.each(['/@hono', '/@hono/edit', '/@hono/talk'])(
  'F30-AC6: Given a community holds a handle, When %s is opened, Then the community’s place answers and no person’s page is shown',
  async (path) => {
    await takeHandle(database, {
      handle: h('hono'),
      owner: { kind: 'community', id: 'c-1' },
      now: now(),
      rest: [],
    })
    // Until work C fills the community's pages, its place is the
    // unavailable page.
    expect((await get(path)).status).toBe(404)
  },
)

test.each([
  ['/@alice', '/@alice-new'],
  ['/@alice/talk', '/@alice-new/talk'],
  ['/@alice/talk/2?lang=en', '/@alice-new/talk/2?lang=en'],
  ['/@alice/following', '/@alice-new/following'],
  ['/@ALICE/talk', '/@alice/talk'],
])(
  'F30-AC7: Given an operator changed alice to alice-new, When %s is opened, Then it moves to %s with 301',
  async (path, location) => {
    expect(
      await renameHandle(database, {
        owner: person,
        to: h('alice-new'),
        now: now(),
      }),
    ).toBe('renamed')
    const response = await get(path)
    expect(response.status).toBe(301)
    expect(response.headers.get('location')).toBe(location)
  },
)

test('F30-AC7: Given an operator changed a handle, When the new URL is opened, Then the same person’s page and slide open, and the old handle is held for 90 days', async () => {
  const at = now()
  expect(
    await renameHandle(database, {
      owner: person,
      to: h('alice-new'),
      now: at,
    }),
  ).toBe('renamed')
  expect((await get('/@alice-new')).status).toBe(200)
  expect((await get('/@alice-new/talk')).status).toBe(200)
  expect(await db.select({ handle: accounts.handle }).from(accounts)).toEqual([
    { handle: 'alice-new' },
  ])
  const takeOld = (when: number) =>
    takeHandle(database, {
      handle: h('alice'),
      owner: { kind: 'community', id: 'c-1' },
      now: when,
      rest: [],
    })
  expect(await takeOld(at + HANDLE_HOLD_SECONDS - 1)).toBe('held')
  expect(await takeOld(at + HANDLE_HOLD_SECONDS)).toBe('claimed')
  // Once someone holds the old handle again, it opens their page instead.
  expect((await get('/@alice')).status).toBe(404)
})

test('F30-AC7: Given an operator changed a handle twice, When the first handle is opened, Then it moves to the latest in one step', async () => {
  await renameHandle(database, { owner: person, to: h('second'), now: now() })
  await renameHandle(database, { owner: person, to: h('third'), now: now() })
  const response = await get('/@alice/talk')
  expect(response.headers.get('location')).toBe('/@third/talk')
})

test('F30-AC7: Given a handle someone holds or that is held, When an operator changes another handle to it, Then nothing changes', async () => {
  await takeHandle(database, {
    handle: h('hono'),
    owner: { kind: 'community', id: 'c-1' },
    now: now(),
    rest: [],
  })
  expect(
    await renameHandle(database, { owner: person, to: h('hono'), now: now() }),
  ).toBe('taken')
  expect(
    await renameHandle(database, { owner: person, to: h('alice'), now: now() }),
  ).toBe('taken')
  await renameHandle(database, { owner: person, to: h('mid'), now: now() })
  // `alice` is now held: changing back to it waits the 90 days too.
  expect(
    await renameHandle(database, { owner: person, to: h('alice'), now: now() }),
  ).toBe('held')
  expect(
    await renameHandle(database, {
      owner: { kind: 'community', id: 'nobody' },
      to: h('free'),
      now: now(),
    }),
  ).toBe('no_handle')
  expect((await get('/@mid/talk')).status).toBe(200)
})

test('F30-AC7: Given a slide cites alice’s slide, When an operator changes alice’s handle, Then the citation follows her', async () => {
  await db.insert(citations).values({
    deployment_id: deployment,
    target_handle: 'alice',
    target_slug: 'talk',
  })
  await renameHandle(database, {
    owner: person,
    to: h('alice-new'),
    now: now(),
  })
  expect(
    await db.select({ handle: citations.target_handle }).from(citations),
  ).toEqual([{ handle: 'alice-new' }])
})

test('Given a handle nobody ever held, When it is opened, Then it is the unavailable page, not a redirect', async () => {
  expect(await db.$count(handles)).toBe(1)
  expect((await get('/@nobody')).status).toBe(404)
})
