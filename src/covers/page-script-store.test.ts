import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { deployments, pageScriptDeployments, uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  seedDeck,
  seedDeployment,
} from '../publication/test-support'
import { recordPageScript } from './page-script-store'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const bucket = platform.env.UPLOADS
await applyMigrations(db)

const TAG = '<script src="/_preview/pages.js"></script>'

/** Whether the deployment was noted as loading the page script. */
const isNoted = async (id: string) =>
  (await drizzle(db).select().from(pageScriptDeployments)).some(
    (row) => row.deployment_id === id,
  )

/** A ready deployment whose index.html is stored as uploads store it. */
async function deploymentWith(html: string | null) {
  const id = await seedDeployment(db, 'talk')
  const key = `${id}/files/0`
  if (html !== null) await bucket.put(key, html)
  await drizzle(db)
    .insert(uploadFiles)
    .values({
      deployment_id: id,
      id: '0',
      path: 'index.html',
      size: 1,
      sha256: 'a'.repeat(64),
      media_type: 'text/html; charset=utf-8',
      object_key: html === null ? null : key,
    })
  return id
}

beforeEach(async () => {
  await drizzle(db).delete(pageScriptDeployments)
  await resetTables(db)
  await seedDeck(db, 'talk')
})
afterAll(() => platform.dispose())

test.each([
  ['in a short head', `<!doctype html><head>${TAG}</head>`],
  [
    // Marp writes its theme into the head, past what is read for the title.
    'after a head longer than the title scan',
    `<!doctype html><head><style>${'a{}'.repeat(30000)}</style>${TAG}</head>`,
  ],
])(
  'Given an index.html that loads the page script %s, When the deployment is noted, Then it is known to load it',
  async (_case, html) => {
    const id = await deploymentWith(html)

    await recordPageScript(db, bucket, id)

    expect(await isNoted(id)).toBe(true)
  },
)

test.each([
  ['has no script', '<!doctype html><title>T</title>'],
  ['spells the tag in a comment', `<!doctype html><!-- ${TAG} -->`],
  ['is empty', ''],
  ['was never received', null],
])(
  'Given an index.html that %s, When the deployment is noted, Then it is not known to load the page script',
  async (_case, html) => {
    const id = await deploymentWith(html)

    await recordPageScript(db, bucket, id)

    expect(await isNoted(id)).toBe(false)
  },
)

test('Given a deployment with no index.html, When it is noted, Then it is not known to load the page script', async () => {
  const id = await seedDeployment(db, 'talk')

  await recordPageScript(db, bucket, id)

  expect(await isNoted(id)).toBe(false)
})

test('Given a deployment already noted, When it is noted again, Then it is still known once', async () => {
  const id = await deploymentWith(TAG)

  await recordPageScript(db, bucket, id)
  await recordPageScript(db, bucket, id)

  expect(await drizzle(db).select().from(pageScriptDeployments)).toEqual([
    { deployment_id: id },
  ])
})

test('Given storage that fails, When a deployment is noted, Then nothing is thrown and it is not known to load the page script', async () => {
  const id = await deploymentWith(TAG)
  const failing = {
    get: async () => {
      throw new Error('storage is down')
    },
  } as unknown as R2Bucket

  await expect(recordPageScript(db, failing, id)).resolves.toBeUndefined()

  expect(await isNoted(id)).toBe(false)
})

test('Given a noted deployment, When the deployment is deleted, Then its note goes with it', async () => {
  const id = await deploymentWith(TAG)
  await recordPageScript(db, bucket, id)
  const orm = drizzle(db)

  await orm.batch([
    orm.delete(uploadFiles).where(eq(uploadFiles.deployment_id, id)),
    orm.delete(deployments).where(eq(deployments.id, id)),
  ])

  expect(await orm.select().from(pageScriptDeployments)).toEqual([])
})

test('Given two deployments, When one is noted, Then the other is not known to load the page script', async () => {
  const noted = await deploymentWith(TAG)
  const other = await seedDeployment(db, 'talk')

  await recordPageScript(db, bucket, noted)

  expect(await isNoted(other)).toBe(false)
})
