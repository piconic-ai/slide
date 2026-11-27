import { eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { accounts, decks, deployments } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { startFor } from '../mcp/receive-api'
import {
  OWNER_ID,
  resetTables,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { parseInventoryStructure } from './inventory'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = {
  ...testEnv(platform.env),
  UPLOAD_LIMITS: { activeSessions: 100, startsPerDay: 1000 },
} as unknown as Env
const html = '<!doctype html><title>x</title>'
const sha256 = async (text: string) =>
  Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  ).toString('hex')
const inventoryOf = async (body: string) => ({
  entry: 'index.html',
  files: [
    {
      path: 'index.html',
      size: new TextEncoder().encode(body).length,
      sha256: await sha256(body),
    },
  ],
})
let n = 0
const attempt = () => `new-author-attempt-${String(++n).padStart(4, '0')}`
let cookie = ''

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetTables(database)
  cookie = await signIn(env, 'fresh')
  // Registered a day ago: a new author.
  await db
    .update(accounts)
    .set({ created_at: Math.floor(Date.now() / 1000) - 86_400 })
    .where(eq(accounts.user_id, OWNER_ID))
}, 30_000)
afterAll(() => platform.dispose())

/** Starts a new slide from the browser's route, as the page and a drop do. */
async function browserNew(
  target: Env = env,
  tryAttempt = attempt(),
  body = `${html}${n}`,
) {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/api/slides`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        attempt: tryAttempt,
        name: { title: `slide ${n}` },
        ...(await inventoryOf(body)),
      }),
    }),
    target,
  )
  return { status: response.status, body: (await response.json()) as any }
}
async function browserVersion(slug: string) {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/api/slides/${slug}/uploads`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        attempt: attempt(),
        ...(await inventoryOf(`${html}v${n}`)),
      }),
    }),
    env,
  )
  return response.status
}
/** Starts a new slide as an agent does. */
async function agentNew(target: Env = env) {
  const inventory = parseInventoryStructure(await inventoryOf(`${html}a${++n}`))
  return startFor(
    { env: target, ownerUserId: OWNER_ID },
    { kind: 'new', name: { title: `agent ${n}` } },
    inventory,
  )
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

test('F42-AC17: Given a new author, When they start 3 new slides in a day, Then all 3 are made', async () => {
  for (let i = 0; i < 3; i++) expect((await browserNew()).status).toBe(201)
  expect(await db.$count(decks)).toBe(3)
})

test('F42-AC18: Given a new author at the limit, When they start a 4th new slide, Then it is refused with the code and 24 hours after the oldest one was made, and no slide is made', async () => {
  for (let i = 0; i < 3; i++) expect((await browserNew()).status).toBe(201)
  const [oldest] = await db
    .select({ at: decks.created_at })
    .from(decks)
    .orderBy(decks.created_at)
  const refused = await browserNew()
  expect(refused.status).toBe(429)
  expect(refused.body.code).toBe('new_author_limit')
  expect(Number(refused.body.availableAt)).toBe(oldest!.at + 86_400)
  expect(Number(refused.body.availableAt)).toBeGreaterThan(nowSeconds())
  expect(await db.$count(decks)).toBe(3)
})

test('F42-AC17: Given 3 slides made 24 hours and 5 seconds ago, When the author starts new slides, Then they have left the window and 3 more are made, and the 4th is refused', async () => {
  for (let i = 0; i < 3; i++) await browserNew()
  await db.update(decks).set({ created_at: nowSeconds() - 86_400 - 5 })
  for (let i = 0; i < 3; i++) expect((await browserNew()).status).toBe(201)
  expect((await browserNew()).status).toBe(429)
})

test('F42-AC18: Given 3 slides of which only the oldest is about to leave, When the author starts one, Then it is refused until that one leaves and the time named is when it does', async () => {
  for (let i = 0; i < 3; i++) await browserNew()
  const now = nowSeconds()
  const rows = await db.select({ id: decks.id }).from(decks)
  await db
    .update(decks)
    .set({ created_at: now - 86_400 + 60 })
    .where(eq(decks.id, rows[0]!.id))
  const refused = await browserNew()
  expect(refused.status).toBe(429)
  expect(Number(refused.body.availableAt)).toBe(now + 60)
  await db
    .update(decks)
    .set({ created_at: now - 86_400 - 1 })
    .where(eq(decks.id, rows[0]!.id))
  expect((await browserNew()).status).toBe(201)
})

test('F42-AC17: Given a new author and 50 starts at once, When they all run, Then only 3 slides are made, and the rest are refused as over the limit', async () => {
  const results = await Promise.all(
    Array.from({ length: 50 }, () => browserNew()),
  )
  // Name every distinct answer, so a failure shows which one was wrong.
  const answers = new Map<string, number>()
  for (const { status, body } of results) {
    const key = `${status} ${body.code ?? 'created'}`
    answers.set(key, (answers.get(key) ?? 0) + 1)
  }
  expect(Object.fromEntries(answers)).toEqual({
    '201 created': 3,
    '429 new_author_limit': 47,
  })
  expect(await db.$count(decks)).toBe(3)
})

test('F42-AC20: Given a new author at the limit, When an agent and the page each start a new slide, Then both are refused with the same reason and the same time', async () => {
  for (let i = 0; i < 3; i++) await browserNew()
  const fromPage = await browserNew()
  const fromAgent = await agentNew()
  expect(fromAgent.ok).toBe(false)
  if (fromAgent.ok) return
  expect(fromAgent.refusal.code).toBe('new_author_limit')
  const at = new Date(Number(fromPage.body.availableAt) * 1000)
    .toISOString()
    .replace('.000Z', 'Z')
  expect(fromAgent.refusal.message).toContain(at)
  expect(await db.$count(decks)).toBe(3)
})

test('F42-AC20: Given a new author who made two slides in the browser, When an agent starts a new slide and then another, Then the first is let through and the second is refused, since both count together', async () => {
  await browserNew()
  await browserNew()
  expect((await agentNew()).ok).toBe(true)
  const refused = await agentNew()
  expect(refused.ok).toBe(false)
  expect(await db.$count(decks)).toBe(3)
  expect((await browserNew()).status).toBe(429)
})

test('F42-AC19: Given a new author at the limit, When they put up a new version of a slide they already have, Then it is allowed, and it uses no room', async () => {
  const first = await browserNew()
  await browserNew()
  await browserNew()
  expect((await browserNew()).status).toBe(429)
  expect(await browserVersion(first.body.slug)).toBe(201)
  expect(await browserVersion(first.body.slug)).toBe(201)
  expect(await db.$count(decks)).toBe(3)
})

test('F42-AC19: Given a start that was made before and is repeated, When the author is at the limit, Then it continues and is not counted again', async () => {
  const again = attempt()
  const first = await browserNew(env, again, 'same')
  await browserNew()
  await browserNew()
  const repeated = await browserNew(env, again, 'same')
  expect(repeated.status).toBe(201)
  expect(repeated.body.slug).toBe(first.body.slug)
  expect(await db.$count(decks)).toBe(3)
})

test('F42-AC21: Given a person who registered 8 days ago, When they start 5 new slides, Then none is refused', async () => {
  await db
    .update(accounts)
    .set({ created_at: Math.floor(Date.now() / 1000) - 8 * 86_400 })
    .where(eq(accounts.user_id, OWNER_ID))
  for (let i = 0; i < 5; i++) expect((await browserNew()).status).toBe(201)
})

test('F42-AC22: Given a limit of 1 in the setting, When a new author starts a second new slide, Then it is refused, and a mistaken setting leaves the limit at 3', async () => {
  const one = { ...env, NEW_AUTHOR_LIMITS: { perDay: 1 } } as unknown as Env
  expect((await browserNew(one)).status).toBe(201)
  expect((await browserNew(one)).status).toBe(429)
  const mistaken = {
    ...env,
    NEW_AUTHOR_LIMITS: { perDay: -3 },
  } as unknown as Env
  expect((await browserNew(mistaken)).status).toBe(201)
  expect((await browserNew(mistaken)).status).toBe(201)
  expect((await browserNew(mistaken)).status).toBe(429)
})

/** Finishes the first upload of every slide, as the sender's last call does. */
async function finishUploads() {
  await db.update(deployments).set({ state: 'ready', ready_at: nowSeconds() })
}

test('F42-AC19: Given slides the new author put up and then deleted, When they start another, Then the deleted ones still count', async () => {
  for (let i = 0; i < 3; i++) await browserNew()
  await finishUploads()
  await db.update(decks).set({ deleted_at: 1 })
  expect((await browserNew()).status).toBe(429)
})

test('F42-AC30: Given first uploads that failed, When a new author starts again 3 times and then a 4th time, Then the 4th is made, and no slide is left over', async () => {
  for (let round = 0; round < 3; round++) {
    expect((await browserNew()).status).toBe(201)
    // The content was refused: the upload failed and nothing was put up.
    await db.update(deployments).set({
      state: 'failed',
      failure_reason: 'content_refused',
    })
  }
  for (let i = 0; i < 4; i++) {
    expect((await browserNew()).status).toBe(201)
    await db.update(deployments).set({
      state: 'failed',
      failure_reason: 'content_refused',
    })
  }
  expect(await db.$count(decks, isNull(decks.deleted_at))).toBe(1)
})

test('F42-AC30: Given first uploads that expired because the browser was closed, When a new author starts again, Then the expired ones do not count', async () => {
  for (let round = 0; round < 3; round++) {
    expect((await browserNew()).status).toBe(201)
    await db.update(deployments).set({ state: 'expired' })
  }
  expect((await browserNew()).status).toBe(201)
  expect((await browserNew()).status).toBe(201)
  expect((await browserNew()).status).toBe(201)
  expect((await browserNew()).status).toBe(429)
})

test('F42-AC30: Given a first upload still open, When the new author is at the limit with open uploads, Then they count, and when the uploads are given up they stop counting', async () => {
  for (let i = 0; i < 3; i++) expect((await browserNew()).status).toBe(201)
  expect((await browserNew()).status).toBe(429)
  await db.update(deployments).set({ state: 'expired' })
  expect((await browserNew()).status).toBe(201)
})

test('F42-AC30: Given 2 slides put up and 1 deleted after, and 1 first upload that failed, When the new author starts, Then the put up ones count, deleted or not, and the failed one does not', async () => {
  for (let i = 0; i < 3; i++) await browserNew()
  const rows = await db.select({ id: decks.id }).from(decks)
  await db
    .update(deployments)
    .set({ state: 'ready', ready_at: nowSeconds() })
    .where(eq(deployments.deck_id, rows[0]!.id))
  await db
    .update(deployments)
    .set({ state: 'ready', ready_at: nowSeconds() })
    .where(eq(deployments.deck_id, rows[1]!.id))
  await db
    .update(deployments)
    .set({ state: 'failed', failure_reason: 'content_refused' })
    .where(eq(deployments.deck_id, rows[2]!.id))
  await db.update(decks).set({ deleted_at: 1 }).where(eq(decks.id, rows[0]!.id))
  // Counted: the ready one and the deleted ready one. Room for one more.
  expect((await browserNew()).status).toBe(201)
  expect((await browserNew()).status).toBe(429)
})

test('F42-AC20: Given someone who is not a registered author, When they start a new slide, Then the author check refuses them as before and the limit is not what answers', async () => {
  const stranger = await server.fetch(
    new Request(`${TEST_ORIGIN}/api/slides`, {
      method: 'POST',
      headers: {
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        attempt: attempt(),
        ...(await inventoryOf(html)),
      }),
    }),
    env,
  )
  expect(stranger.status).toBe(401)
})
