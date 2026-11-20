import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { z } from 'zod'
import { accounts, citations, decks, deployments } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { deckSlugSchema } from '../decks/deck-id'
import {
  resetTables,
  seedDeck,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { uploadsApi } from '../uploads/api'
import { startAsAuthor } from '../uploads/test-start'
import { DECKS_SHOWN } from './citing'
import { readCitedBy, readCites } from './store'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = testEnv(platform.env)

const receiptSchema = z.object({
  deploymentId: z.string(),
  credential: z.string(),
  files: z.array(z.object({ id: z.string(), path: z.string() })),
})

const sha256Hex = async (text: string) =>
  Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  ).toString('hex')

let cookie = ''

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  // Signing in records the handle "owner" from the stubbed GitHub login.
  cookie = await signIn(env)
  await orm
    .insert(accounts)
    .values({ user_id: '999', handle: 'reader', created_at: 1 })
  await seedPublic(db, 'reply', 2, 'Reply', '999')
  await seedDeck(db, 'talk')
})
afterAll(() => platform.dispose())

/**
 * Places files as the author's browser does: starts with the session, sends
 * each file with the credential the start gave, and finalizes.
 */
async function place(deck: string, files: Record<string, string>) {
  const encoder = new TextEncoder()
  const started = await startAsAuthor(env, cookie, deck, {
    attempt: `attempt-${crypto.randomUUID()}`,
    entry: 'index.html',
    files: await Promise.all(
      Object.entries(files).map(async ([path, body]) => ({
        path,
        size: encoder.encode(body).length,
        sha256: await sha256Hex(body),
      })),
    ),
  })
  expect(started.status).toBe(201)
  const receipt = receiptSchema.parse(await started.json())
  const auth = { Authorization: `Bearer ${receipt.credential}` }
  for (const file of receipt.files) {
    const put = await uploadsApi.request(
      `http://localhost/${receipt.deploymentId}/files/${file.id}`,
      { method: 'PUT', headers: auth, body: files[file.path] },
      env,
    )
    expect(put.status).toBe(200)
  }
  const finalized = await uploadsApi.request(
    `http://localhost/${receipt.deploymentId}/finalize`,
    { method: 'POST', headers: auth },
    env,
  )
  expect(finalized.status).toBe(200)
  return receipt.deploymentId
}

const recorded = async (deployment: string) =>
  (
    await orm
      .select()
      .from(citations)
      .where(eq(citations.deployment_id, deployment))
  )
    .map((row) => `${row.target_handle}/${row.target_slug}/${row.target_page}`)
    .sort()

test('F24-AC15: Given slides placed from the author’s browser session whose pages link to share URLs, When the upload is finalized, Then the links of that version are kept, and the decks are joined once the version is public', async () => {
  const deployment = await place('talk', {
    'index.html': `<!doctype html><title>Talk</title>
      <a href="${TEST_ORIGIN}/@reader/reply/3">a page of the reply</a>
      <a href="${TEST_ORIGIN}/@owner/talk/2">this deck itself</a>
      <a href="https://elsewhere.example/@reader/reply">another site</a>`,
    'pages/2.html': `<a href=${TEST_ORIGIN}/@reader/reply>the reply</a>`,
    'notes.txt': `<a href="${TEST_ORIGIN}/@reader/reply/9">not HTML</a>`,
  })

  expect(
    await orm
      .select({ state: deployments.state, source: deployments.source })
      .from(deployments)
      .where(eq(deployments.id, deployment))
      .get(),
  ).toEqual({ state: 'ready', source: 'browser' })
  expect(await recorded(deployment)).toEqual([
    'reader/reply/0',
    'reader/reply/3',
  ])
  // Placed slides are the author's alone: nothing shows until published.
  const citingReply = () =>
    readCitedBy(db, 'reader', deckSlugSchema.parse('reply'), DECKS_SHOWN, null)
  expect((await citingReply()).total).toBe(0)

  await orm
    .update(decks)
    .set({ public_deployment_id: deployment })
    .where(eq(decks.id, 'talk'))

  expect(
    (await citingReply()).decks.map((deck) => `${deck.handle}/${deck.slug}`),
  ).toEqual(['owner/talk'])
  expect(
    (await readCites(db, deployment, null)).map(
      (deck) => `${deck.handle}/${deck.slug}`,
    ),
  ).toEqual(['reader/reply'])
})

test('F24-AC15: Given slides placed from the browser session without any link to a share URL, When the upload is finalized, Then the version is ready and keeps no citation', async () => {
  const deployment = await place('talk', {
    'index.html': '<!doctype html><title>Talk</title><a href="/next/">next</a>',
  })

  expect(await recorded(deployment)).toEqual([])
})
