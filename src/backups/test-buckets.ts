import { getPlatformProxy } from 'wrangler'
import { applyMigrations } from '../db/test-migrations'

/**
 * A local D1 and two local R2 buckets, for the tests of the backup: the
 * source (`UPLOADS`) and the backup (`UPLOADS_BACKUP`). Nothing leaves the
 * machine and nothing is kept after `dispose`.
 */
export async function openBuckets() {
  const platform = await getPlatformProxy<{
    DB: D1Database
    UPLOADS: R2Bucket
    UPLOADS_BACKUP: R2Bucket
  }>({
    configPath: new URL('./test-wrangler.jsonc', import.meta.url).pathname,
    persist: false,
  })
  await applyMigrations(platform.env.DB)
  return platform
}

/** Every key in a bucket, in key order. */
export async function keysOf(bucket: R2Bucket): Promise<string[]> {
  const keys: string[] = []
  let cursor: string | undefined
  do {
    const page = await bucket.list({ cursor })
    keys.push(...page.objects.map(({ key }) => key))
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return keys
}

/** The hex SHA-256 of an object's bytes, or null for a key that is not there. */
export async function sha256Of(
  bucket: R2Bucket,
  key: string,
): Promise<string | null> {
  const object = await bucket.get(key)
  if (!object) return null
  const digest = await crypto.subtle.digest(
    'SHA-256',
    await object.arrayBuffer(),
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

/** Empties a bucket. */
export async function emptyBucket(bucket: R2Bucket) {
  const keys = await keysOf(bucket)
  for (let start = 0; start < keys.length; start += 1000)
    await bucket.delete(keys.slice(start, start + 1000))
}
