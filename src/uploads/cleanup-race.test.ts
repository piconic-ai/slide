import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { z } from 'zod'
import { applyMigrations } from '../db/test-migrations'
import { uploadsApi } from './api'
import { runUploadCleanup } from './cleanup'
import { DEFAULT_UPLOAD_LIMITS } from './limits'

vi.mock('./oidc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./oidc')>()),
  verifyGitHubToken: vi.fn(async () => ({
    repository_id: '1446590227',
    repository_owner_id: '248307881',
    actor_id: '722500',
    ref: 'refs/heads/main',
    sha: 'a'.repeat(40),
    run_id: '1',
    run_attempt: '1',
    event_name: 'push',
  })),
}))

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const contentHash =
  'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await db.batch([
    db.prepare('DELETE FROM upload_files'),
    db.prepare('DELETE FROM deployments'),
  ])
})
afterAll(() => platform.dispose())

test('given a receive that stalls past a cleanup sweep, when its body arrives, then no object is written behind the sweep', async () => {
  const started = await uploadsApi.request(
    'http://localhost/',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer local-oidc-token-123456789' },
      body: JSON.stringify({
        entry: 'index.html',
        files: [{ path: 'index.html', size: 1, sha256: contentHash }],
      }),
    },
    platform.env,
  )
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
        .prepare('SELECT 1 FROM deployments WHERE lease_id IS NOT NULL')
        .first()
    )
      break
  }
  // The session expires and its empty prefix is swept while the body stalls.
  const later = receipt.expiresAt + 2 * DEFAULT_UPLOAD_LIMITS.orphanGraceSeconds
  await db
    .prepare('UPDATE deployments SET expires_at = ?')
    .bind(Math.floor(Date.now() / 1000) - 1)
    .run()
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
