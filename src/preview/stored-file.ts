import { z } from 'zod'

/**
 * Bumped whenever the bytes the internal entrypoint returns would change for
 * the same stored file, so old cache entries are never read again.
 */
export const CONTENT_CACHE_REVISION = 'v1'

const INTERNAL_HOST = 'https://content-files.internal'

export type StoredFileRef = Readonly<{
  deploymentId: string
  sha256: string
  objectKey: string
}>

/**
 * The internal URL of one stored file. Its path is the cache key: it names
 * the deployment, the file's digest and its object, never the request host,
 * so two deployments' `/index.html` never share an entry.
 */
export function storedFileUrl(file: StoredFileRef): string {
  const parts = [
    CONTENT_CACHE_REVISION,
    file.deploymentId,
    file.sha256,
    file.objectKey,
  ].map(encodeURIComponent)
  return `${INTERNAL_HOST}/${parts.join('/')}`
}

const refSchema = z.object({
  deploymentId: z.uuid(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  objectKey: z.string().min(1),
})

/** The stored file an internal URL names, or null for any other URL. */
export function parseStoredFileUrl(url: string): StoredFileRef | null {
  const { origin, pathname } = new URL(url)
  if (origin !== INTERNAL_HOST) return null
  const parts = pathname.slice(1).split('/')
  if (parts.length !== 4 || parts[0] !== CONTENT_CACHE_REVISION) return null
  let decoded: string[]
  try {
    decoded = parts.map(decodeURIComponent)
  } catch {
    return null
  }
  const parsed = refSchema.safeParse({
    deploymentId: decoded[1],
    sha256: decoded[2],
    objectKey: decoded[3],
  })
  return parsed.success ? parsed.data : null
}
