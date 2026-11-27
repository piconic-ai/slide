import { parseFacePictureUrl, FACE_EDGE_KEPT } from './face'
import { servedPictureType } from './picture-policy'
import { readPictureObject } from './picture-store'

const noStore = { 'Cache-Control': 'no-store' }

/**
 * Serves the bytes of one uploaded picture for the internal cache. The
 * caller has already read D1 and found this to be the person's picture now;
 * this only maps the key to bytes. A missing object is not cached, so a
 * later upload is read again.
 */
export async function serveFacePicture(
  bucket: R2Bucket,
  request: Request,
): Promise<Response> {
  const ref = request.method === 'GET' && parseFacePictureUrl(request.url)
  if (!ref) return new Response(null, { status: 404, headers: noStore })
  const object = await readPictureObject(bucket, ref.userId)
  if (!object) return new Response(null, { status: 404, headers: noStore })
  return new Response(object.body, {
    headers: {
      'Content-Type': servedPictureType(object.httpMetadata?.contentType),
      'Cache-Control': FACE_EDGE_KEPT,
      'Cache-Tag': `face-${ref.userId}`,
    },
  })
}
