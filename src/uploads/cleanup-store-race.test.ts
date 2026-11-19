import { isNotNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { z } from 'zod'
import { decks, deployments, uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { signIn, testEnv } from '../publication/test-support'
import { uploadsApi } from './api'
import { runUploadCleanup } from './cleanup-store'
import { DEFAULT_UPLOAD_LIMITS } from './limits'
import { startAsAuthor } from './test-start'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = drizzle(platform.env.DB)
const contentHash =
  'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'

let session = ''
beforeAll(async () => {
  await applyMigrations(platform.env.DB)
  session = await signIn(testEnv(platform.env))
})
beforeEach(async () => {
  await db.batch([
    db.delete(uploadFiles),
    db.delete(deployments),
    db.delete(decks),
    db.insert(decks).values({
      id: 'talk',
      slug: 'talk',
      owner_user_id: '722500',
      created_at: 1,
    }),
  ])
})
afterAll(() => platform.dispose())

test('given a receive that stalls past a cleanup sweep, when its body arrives, then no object is written behind the sweep', async () => {
  const started = await startAsAuthor(platform.env, session, 'talk', {
    entry: 'index.html',
    files: [{ path: 'index.html', size: 1, sha256: contentHash }],
  })
  const receipt = z
    .object({
      deploymentId: z.string(),
      credential: z.string(),
      expiresAt: z.number(),
    })
    .parse(await started.json())
  let release = () => {}
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      release = () => {
        controller.enqueue(new Uint8Array([0x61]))
        controller.close()
      }
    },
  })
  // The receive's own compensating delete fails, as in a transient outage.
  const bucket = platform.env.UPLOADS
  const flaky = {
    put: bucket.put.bind(bucket),
    head: bucket.head.bind(bucket),
    delete: () => Promise.reject(new Error('R2 unavailable')),
  } as unknown as R2Bucket
  const pending = uploadsApi.request(
    `http://localhost/${receipt.deploymentId}/files/0`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${receipt.credential}` },
      body,
      duplex: 'half',
    } as RequestInit,
    { ...platform.env, UPLOADS: flaky },
  )
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    if (
      await db
        .select({ id: deployments.id })
        .from(deployments)
        .where(isNotNull(deployments.lease_id))
        .get()
    )
      break
  }
  // The session expires and its empty prefix is swept while the body stalls.
  const later = receipt.expiresAt + 2 * DEFAULT_UPLOAD_LIMITS.orphanGraceSeconds
  await db
    .update(deployments)
    .set({ expires_at: Math.floor(Date.now() / 1000) - 1 })
  expect(await runUploadCleanup(platform.env, later)).toMatchObject({
    expired: 1,
    swept: 1,
  })
  release()
  const response = await pending
  expect(response.status).toBe(409)
  const listed = await platform.env.UPLOADS.list({
    prefix: `${receipt.deploymentId}/`,
  })
  expect(listed.objects).toEqual([])
})

test('given an object that lands after its deployment was swept, when the next periodic sweep runs, then it is collected', async () => {
  const now = Math.floor(Date.now() / 1000)
  await db.insert(deployments).values({
    id: 'late',
    idempotency_key: 'late',
    inventory_digest: 'g',
    source: 'browser',
    state: 'uploading',
    total_bytes: 1,
    token_hash: 'h',
    created_at: now - 10,
    expires_at: now - 1,
    credential_expires_at: now - 1,
  })
  const later = now + 2 * DEFAULT_UPLOAD_LIMITS.orphanGraceSeconds
  expect(await runUploadCleanup(platform.env, later)).toMatchObject({
    expired: 1,
    swept: 1,
  })
  // A write that passed its lease check finishes long after the sweep, and
  // its own compensating delete never ran.
  await platform.env.UPLOADS.put('late/0/stalled', 'a')
  expect(await runUploadCleanup(platform.env, later + 60)).toMatchObject({
    swept: 0,
  })
  const weekLater = later + 8 * 24 * 60 * 60
  expect(await runUploadCleanup(platform.env, weekLater)).toMatchObject({
    swept: 1,
    deletedObjects: 1,
  })
  expect(
    (await platform.env.UPLOADS.list({ prefix: 'late/' })).objects,
  ).toEqual([])
})
