import { parseStoredFileUrl } from './stored-file'

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
