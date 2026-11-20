import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { z } from 'zod'
import { decks, deployments } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { uploadsApi } from '../uploads/api'
import { startAsAuthor } from '../uploads/test-start'
import { applyAuthorCommand } from './author'
import { readPublication } from './store'
import {
  OWNER_ID,
  resetTables,
  seedDeck,
  seedDeployment,
  signIn,
  testEnv,
} from './test-support'
import type { AuthorCommand } from './transitions'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
let session = ''

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await seedDeck(db, 'talk')
  session = await signIn(testEnv(platform.env))
})
afterAll(() => platform.dispose())

const BODY = 'a'
const BODY_SHA256 =
  'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'
const receiptSchema = z.object({
  deploymentId: z.string(),
  credential: z.string(),
})

/** Starts a new version of the slide and returns how to send and finish it. */
async function startVersion(attempt: string) {
  const started = await startAsAuthor(platform.env, session, 'talk', {
    attempt,
    entry: 'index.html',
    files: [{ path: 'index.html', size: 1, sha256: BODY_SHA256 }],
  })
  expect(started.status).toBe(201)
  const receipt = receiptSchema.parse(await started.json())
  const auth = { Authorization: `Bearer ${receipt.credential}` }
  const finish = async () => {
    const put = await uploadsApi.request(
      `http://localhost/${receipt.deploymentId}/files/0`,
      { method: 'PUT', headers: auth, body: BODY },
      platform.env,
    )
    expect(put.status).toBe(200)
    const finalized = await uploadsApi.request(
      `http://localhost/${receipt.deploymentId}/finalize`,
      { method: 'POST', headers: auth },
      platform.env,
    )
    expect(finalized.status).toBe(200)
    expect(await finalized.json()).toMatchObject({ state: 'ready' })
  }
  return { id: receipt.deploymentId, finish }
}

async function act(command: AuthorCommand) {
  const current = await readPublication(db, 'talk', OWNER_ID)
  const result = await applyAuthorCommand(db, {
    deckId: 'talk',
    ownerUserId: OWNER_ID,
    command,
    expectedRevision: current?.revision ?? 0,
    now: 100,
  })
  expect(result.kind).toBe('applied')
}

const stored = () =>
  orm
    .select({
      public: decks.public_deployment_id,
      resume: decks.resume_deployment_id,
      paused: decks.paused_at,
      revision: decks.revision,
    })
    .from(decks)
    .where(eq(decks.id, 'talk'))
    .get()
const stateOf = async (id: string) =>
  (
    await orm
      .select({ state: deployments.state })
      .from(deployments)
      .where(eq(deployments.id, id))
      .get()
  )?.state

test('F02-AC7: Given a slide whose publication was stopped, When a new version is started, received and made ready, Then the version is ready and nothing is public again', async () => {
  const a = await seedDeployment(db, 'talk')
  await act({ kind: 'publish', deploymentId: a })
  await act({ kind: 'pause' })
  const before = await stored()
  expect(before).toMatchObject({ public: null, resume: a })

  const version = await startVersion('after-the-pause-0001')
  await version.finish()

  expect(await stateOf(version.id)).toBe('ready')
  expect(await stored()).toEqual(before)
})

test('F02-AC7: Given an upload started while the slide was public, When publication is stopped and the upload is then made ready, Then nothing is public again and resuming brings back the version that was public', async () => {
  const a = await seedDeployment(db, 'talk')
  await act({ kind: 'publish', deploymentId: a })
  const version = await startVersion('before-the-pause-001')
  await act({ kind: 'pause' })
  const before = await stored()

  await version.finish()

  expect(await stateOf(version.id)).toBe('ready')
  expect(await stored()).toEqual(before)
  await act({ kind: 'resume' })
  expect(await stored()).toMatchObject({ public: a, resume: null })
})

test('F02-AC7: Given a slide stopped before anything was public, When a new version is made ready and publication is resumed, Then the slide is a draft and the version is not public', async () => {
  await act({ kind: 'pause' })
  const version = await startVersion('paused-as-a-draft-01')
  await version.finish()

  expect(await stored()).toMatchObject({ public: null, resume: null })
  await act({ kind: 'resume' })
  expect(await stored()).toMatchObject({
    public: null,
    resume: null,
    paused: null,
  })
})

test('F02-AC6: Given a draft slide, When a version is received and made ready without the author pressing publish, Then the slide stays a draft at the same revision', async () => {
  const before = await stored()

  const version = await startVersion('nobody-pressed-00001')
  await version.finish()

  expect(await stateOf(version.id)).toBe('ready')
  expect(await stored()).toEqual(before)
})
