import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import { readZipDirectory } from '../drops/zip'
import {
  resetTables,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { drizzle } from 'drizzle-orm/d1'
import { uploadFiles } from '../db/schema'
import {
  bodyBytes,
  placeFiles,
  publish,
  sha256Hex,
  type TestFiles,
} from './test-upload'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const counted = { gets: 0, heads: 0, puts: 0 }
// Every call the export makes on the bucket is a subrequest in a Worker.
const bucket = new Proxy(platform.env.UPLOADS, {
  get(target, property) {
    const value = Reflect.get(target, property, target)
    if (typeof value !== 'function') return value
    return (...args: unknown[]) => {
      if (property === 'get') counted.gets++
      if (property === 'head') counted.heads++
      if (property === 'put') counted.puts++
      return value.apply(target, args)
    }
  },
})
const env = {
  ...testEnv(platform.env),
  UPLOADS: bucket,
  UPLOAD_LIMITS: {
    activeSessions: 20,
    startsPerDay: 1000,
    files: 500,
    fileBytes: 6 * 1024 * 1024,
    deploymentBytes: 48 * 1024 * 1024,
    authorBytes: 96 * 1024 * 1024,
  },
} as unknown as Env
await applyMigrations(database)
afterAll(() => platform.dispose())

let alice = ''
beforeAll(async () => {
  await resetTables(database)
  alice = await signIn(env, 'alice')
}, 30_000)

/** 450 small scripts, eight images of 5 MiB, and the page: 459 files, 40 MiB. */
const big: TestFiles = {
  'index.html': '<!doctype html><title>Big</title>',
  ...Object.fromEntries(
    Array.from({ length: 450 }, (_, i) => [
      `parts/${String(i).padStart(3, '0')}.js`,
      `export const n = ${i}\n`.repeat(40),
    ]),
  ),
  ...Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [
      `media/${i}.png`,
      Uint8Array.from(
        { length: 5 * 1024 * 1024 },
        (_, at) => (at * (i + 3)) % 251,
      ),
    ]),
  ),
}

/**
 * Adds files to a received version directly, in R2 and in D1, as finalize
 * leaves them. Sending 459 files over HTTP would take over a minute and
 * measure the upload, not the export.
 */
async function addFiles(deploymentId: string, more: TestFiles) {
  const orm = drizzle(database)
  const rows: (typeof uploadFiles.$inferInsert)[] = []
  for (const [path, value] of Object.entries(more)) {
    if (path === 'index.html') continue
    const bytes =
      typeof value === 'string' ? new TextEncoder().encode(value) : value
    const key: string = `${deploymentId}/${rows.length + 100}/lease`
    await platform.env.UPLOADS.put(key, bytes)
    rows.push({
      deployment_id: deploymentId,
      id: String(rows.length + 100),
      path,
      size: bytes.length,
      sha256: await sha256Hex(bytes),
      media_type: path.endsWith('.png') ? 'image/png' : 'text/javascript',
      object_key: key,
    })
  }
  for (let at = 0; at < rows.length; at += 14)
    await orm.insert(uploadFiles).values(rows.slice(at, at + 14))
}

describe('a version near the upload limits', () => {
  it('F35-AC10: Given a version of 459 files and 40 MiB, When its zip is taken, Then it is complete, and R2 is read once per file with no other call', async () => {
    const placed = await placeFiles(env, alice, {
      'index.html': big['index.html']!,
    })
    await addFiles(placed.deploymentId, big)
    await publish(database, placed.slug, placed.deploymentId)
    counted.gets = counted.heads = counted.puts = 0

    const started = performance.now()
    const response = await server.fetch(
      new Request(
        `${TEST_ORIGIN}/my/slides/${placed.slug}/export/published.zip`,
        {
          headers: { Cookie: alice },
        },
      ),
      env,
    )
    const zip = await bodyBytes(response)
    const seconds = (performance.now() - started) / 1000

    expect(response.status).toBe(200)
    const directory = readZipDirectory(zip)
    if (!directory.ok) throw new Error('not a zip')
    expect(directory.entries).toHaveLength(Object.keys(big).length)
    // The subrequests of R2: one `get` per file, and the lease's put, head
    // and delete. Far under the 10,000 of a Worker on the paid plan.
    expect(counted.gets).toBe(Object.keys(big).length)
    expect(counted.puts).toBe(1)
    expect(counted.gets + counted.heads + counted.puts).toBeLessThan(
      Object.keys(big).length + 10,
    )
    expect(seconds).toBeLessThan(30)
  }, 180_000)
})
