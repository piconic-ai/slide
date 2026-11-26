import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { blocks, follows, suspensions } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = withInvited(testEnv(platform.env))
const slide = '/@bob/talk'
let alice = ''
let bob = ''

beforeAll(async () => {
  await applyMigrations(database)
  alice = await signIn(env, 'alice')
  bob = await signIn(env, 'bob', { id: INVITED_ID })
  await seedPublic(database, 'talk', 2, 'Bob’s talk', INVITED_ID)
  await seedPublic(database, 'keynote', 1, 'Alice’s keynote', OWNER_ID)
})
beforeEach(async () => {
  await db.batch([
    db.delete(blocks),
    db.delete(follows),
    db.delete(suspensions),
  ])
})
afterAll(() => platform.dispose())

const get = (path: string, cookie = alice) =>
  server.fetch(
    new Request(new URL(path, TEST_ORIGIN), { headers: { Cookie: cookie } }),
    env,
  )

const post = (
  path: string,
  fields: Record<string, string>,
  cookie = alice,
  headers: Record<string, string> = { Origin: TEST_ORIGIN },
) =>
  server.fetch(
    new Request(new URL(path, TEST_ORIGIN), {
      method: 'POST',
      headers: { Cookie: cookie, ...headers },
      body: new URLSearchParams(fields),
    }),
    env,
  )

const newBlock = (handle: string, path: string) =>
  `/blocks/new?${new URLSearchParams({ handle, slide: path })}`

const blockPairs = () =>
  db
    .select({
      blocker: blocks.blocker_user_id,
      blocked: blocks.blocked_user_id,
    })
    .from(blocks)

const aliceBlockedBob = { blocker: OWNER_ID, blocked: INVITED_ID }

function expectRedirect(response: Response, path: string) {
  expect(response.status).toBe(303)
  expect(response.headers.get('Location')).toBe(path)
}

test.each([
  [
    'ja',
    '@bobさんをブロックしますか',
    'ブロックすると',
    '互いにフォローできなくなります',
    'ブロックする',
    'やめる',
    '「ブロックしている人」',
  ],
  [
    'en',
    'Block @bob?',
    'If you block them',
    'neither of you can follow the other',
    'Block',
    'Cancel',
    'People you blocked',
  ],
])(
  'F32-AC15: Given Alice uses %s, When she opens the block page from Bob’s slides, Then it asks about Bob, lists the effects, and offers to block or go back, with unblocking and reporting explained',
  async (lang, heading, effects, follow, submit, cancel, note) => {
    const response = await get(`${newBlock('bob', slide)}&lang=${lang}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Security-Policy')).toContain(
      "form-action 'self'",
    )
    const page = await response.text()
    expect(page).toContain(`<h1>${heading}</h1>`)
    expect(page).toContain(`<h2>${effects}</h2>`)
    const list = /<h2>[^<]+<\/h2>\s*<ul>([\s\S]*?)<\/ul>/.exec(page)?.[1] ?? ''
    expect(list.match(/<li>/g)).toHaveLength(5)
    expect(list).toContain(follow)
    const form =
      /<div class="block-actions">([\s\S]*?)<\/div>/.exec(page)?.[1] ?? ''
    expect(form).toContain('type="hidden" name="handle" value="bob"')
    expect(form).toContain(`type="hidden" name="slide" value="${slide}"`)
    expect(form).toMatch(new RegExp(`<button\\b[^>]*>${submit}</button>`))
    expect(form).toContain(`href="${slide}">${cancel}</a>`)
    expect(page).toContain(note)
    expect(await blockPairs()).toEqual([])
  },
)

test('F32-AC1: Given Alice and Bob follow each other, When Alice blocks Bob from the page, Then she returns to his slides, the block is stored and both follows are gone', async () => {
  expectRedirect(await post('/follows', { handle: 'bob', slide }), slide)
  expectRedirect(
    await post('/follows', { handle: 'alice', slide: '/@alice' }, bob),
    '/@alice',
  )
  expect(await db.select().from(follows)).toHaveLength(2)

  expectRedirect(await post('/blocks', { handle: 'bob', slide }), slide)

  expect(await blockPairs()).toEqual([aliceBlockedBob])
  expect(await db.select().from(follows)).toEqual([])
})

test('F32-AC2, F21-AC64: Given Alice blocked Bob, When Bob sends a follow of Alice, Then it is not stored', async () => {
  await post('/blocks', { handle: 'bob', slide })

  await post('/follows', { handle: 'alice', slide: '/@alice' }, bob)

  expect(await db.select().from(follows)).toEqual([])
})

test('F32-AC2: Given Alice blocked Bob, When Alice sends a follow of Bob, Then it is not stored', async () => {
  await post('/blocks', { handle: 'bob', slide })

  await post('/follows', { handle: 'bob', slide })

  expect(await db.select().from(follows)).toEqual([])
})

test.each([
  ['a profile', '/@bob', '/@bob'],
  ['a page of slides', `${slide}/3`, `${slide}/3`],
  ['another site', 'https://elsewhere.example/', '/my/slides'],
  ['nothing', '', '/my/slides'],
])(
  'Given the block was asked from %s, When Alice blocks, Then she returns to a path of the service only',
  async (_, from, back) => {
    expectRedirect(await post('/blocks', { handle: 'bob', slide: from }), back)
  },
)

test('F32-AC11: Given Alice, When she opens the block page for herself or sends a block of herself, Then the page is not found and nothing is stored', async () => {
  expect((await get(newBlock('alice', '/@alice'))).status).toBe(404)
  expectRedirect(
    await post('/blocks', { handle: 'alice', slide: '/@alice' }),
    '/@alice',
  )
  expect(await blockPairs()).toEqual([])
})

test.each(['nobody', 'NOT A HANDLE', ''])(
  'Given the handle %j holds no visible account, When Alice opens the block page, Then it is not found',
  async (handle) => {
    expect((await get(newBlock(handle, slide))).status).toBe(404)
  },
)

test('F32-AC12: Given a reader who is not signed in, When they open the block page, Then they are asked to sign in and come back', async () => {
  const response = await get(newBlock('bob', slide), '')
  expect(response.status).toBe(401)
  const page = await response.text()
  expect(page).toContain(`href="/login?to=${encodeURIComponent(slide)}"`)
  expect(page).not.toContain('action="/blocks"')
})

test('F32-AC12: Given a reader who is not signed in, When they send a block or an unblock, Then nothing changes', async () => {
  await post('/blocks', { handle: 'bob', slide })
  const before = await blockPairs()

  const blocking = await post('/blocks', { handle: 'alice', slide }, '')
  expect(blocking.status).toBe(401)
  const json = await post('/blocks', { handle: 'alice', slide }, '', {
    Origin: TEST_ORIGIN,
    Accept: 'application/json',
  })
  expect(json.status).toBe(401)
  expect(await json.json()).toEqual({ error: 'sign_in' })
  expectRedirect(await post('/blocks/bob/release', {}, ''), '/settings')

  expect(await blockPairs()).toEqual(before)
})

test.each([
  ['/blocks', 'another origin', { Origin: 'https://elsewhere.example' }],
  [
    '/blocks/bob/release',
    'another origin',
    { Origin: 'https://elsewhere.example' },
  ],
  ['/blocks', 'no origin', {} as Record<string, string>],
])(
  'F32-AC16: Given a send to %s from %s, When it arrives, Then it is refused and the blocks stay as they were',
  async (path, _, headers) => {
    if (path.endsWith('/release'))
      await post('/blocks', { handle: 'bob', slide })
    const before = await blockPairs()

    const response = await post(path, { handle: 'bob', slide }, alice, headers)

    expect(response.status).toBe(403)
    expect(await blockPairs()).toEqual(before)
  },
)

test('F32-AC16: Given a block sent as JSON, When it arrives, Then it is refused as not a form', async () => {
  const response = await server.fetch(
    new Request(new URL('/blocks', TEST_ORIGIN), {
      method: 'POST',
      headers: {
        Cookie: alice,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ handle: 'bob', slide }),
    }),
    env,
  )
  expect(response.status).toBe(415)
  expect(await blockPairs()).toEqual([])
})

test('F32-AC10: Given Alice blocked Bob, When she unblocks him, Then she returns to the settings and the block is gone', async () => {
  await post('/blocks', { handle: 'bob', slide })

  expectRedirect(await post('/blocks/bob/release', {}), '/settings#blocks')

  expect(await blockPairs()).toEqual([])
})

test('Given Bob blocked Alice, When Alice sends an unblock of Bob, Then Bob’s block stays', async () => {
  await post('/blocks', { handle: 'alice', slide: '/@alice' }, bob)

  await post('/blocks/bob/release', {})

  expect(await blockPairs()).toEqual([
    { blocker: INVITED_ID, blocked: OWNER_ID },
  ])
})
