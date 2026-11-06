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

/**
 * Serves the bytes of one stored file for the internal cache. Callers have
 * already authorized the request; this only maps a key to immutable bytes.
 * Misses are not cached, so a later upload of the same key is read again.
 */
export async function serveStoredFile(
  bucket: R2Bucket,
  request: Request,
): Promise<Response> {
  const ref = request.method === 'GET' && parseStoredFileUrl(request.url)
  if (!ref) return new Response(null, { status: 404, headers: noStore })
  const object = await bucket.get(ref.objectKey)
  if (!object) return new Response(null, { status: 404, headers: noStore })
  return new Response(object.body, {
    headers: {
      // The bytes behind a key never change; readers revalidate at the
      // gateway, which applies authorization before this is consulted.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Cache-Tag': `deployment-${ref.deploymentId}`,
    },
  })
}

const noStore = { 'Cache-Control': 'no-store' }
