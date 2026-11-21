import { PICTURE_MAX_BYTES } from './picture-policy'
import { gravatarUrl } from './gravatar'

/** What Gravatar said about an address. */
export type GravatarAnswer =
  | Readonly<{ kind: 'image'; bytes: Uint8Array; contentType: string }>
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'unreachable' }>

/** How long to wait for Gravatar before giving up, in milliseconds. */
const WAIT_MILLISECONDS = 3000

/** The kinds of image Gravatar serves, and so the only ones passed on. */
const IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

/**
 * Asks Gravatar for the picture of an address's hash. There are three
 * answers: a picture, none (404), and anything else, which is `unreachable`:
 * a failure to connect, no answer in time, a server error, a rate limit, a
 * reply that is not an image or is over 1 MB. The reply is read as bytes and
 * kept; nothing of it reaches a page except as an image.
 */
export async function fetchGravatar(
  hash: string,
  fetcher: typeof fetch = fetch,
): Promise<GravatarAnswer> {
  try {
    const response = await fetcher(gravatarUrl(hash), {
      signal: AbortSignal.timeout(WAIT_MILLISECONDS),
      // The service's own address is never sent: no referrer, no cookies.
      referrerPolicy: 'no-referrer',
      credentials: 'omit',
    })
    if (response.status === 404) return { kind: 'none' }
    if (response.status !== 200) return { kind: 'unreachable' }
    const contentType = (response.headers.get('content-type') ?? '')
      .split(';', 1)[0]!
      .trim()
      .toLowerCase()
    if (!IMAGE_TYPES.has(contentType)) return { kind: 'unreachable' }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length === 0 || bytes.length > PICTURE_MAX_BYTES)
      return { kind: 'unreachable' }
    return { kind: 'image', bytes, contentType }
  } catch {
    return { kind: 'unreachable' }
  }
}
