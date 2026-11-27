import { html } from 'hono/html'
import { z } from 'zod'
import { GRAVATAR_KEEP_SECONDS } from './gravatar'

/** The user-id shape the service issues; anything else names nobody. */
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/

export const isUserId = (value: string) => USER_ID.test(value)

/**
 * Where a person's face comes from, in the order the service tries them:
 * the picture they uploaded, else their Gravatar picture, else none (their
 * initial). Each carries the time that changes when its picture does.
 */
export type FaceSource =
  | Readonly<{ kind: 'uploaded'; at: number }>
  /** `at` is when Gravatar was last asked; null before it was. */
  | Readonly<{ kind: 'gravatar'; at: number | null }>
  | Readonly<{ kind: 'none' }>

/** What the service keeps that decides a person's face. */
export type FaceFacts = Readonly<{
  /** When the uploaded picture was put up, or null without one. */
  uploadedAt: number | null
  useGravatar: boolean
  /** When Gravatar was last asked, or null. */
  gravatarAt: number | null
}>

/** The face the kept facts decide (D-31). */
export function faceSourceOf(facts: FaceFacts): FaceSource {
  if (facts.uploadedAt !== null)
    return { kind: 'uploaded', at: facts.uploadedAt }
  if (facts.useGravatar) return { kind: 'gravatar', at: facts.gravatarAt }
  return { kind: 'none' }
}

/**
 * A word that changes whenever the picture may: a new upload, one taken
 * away, Gravatar turned on or off, or Gravatar asked again.
 */
export function faceVersion(source: FaceSource): string {
  switch (source.kind) {
    case 'uploaded':
      return `u${source.at}`
    case 'gravatar':
      return source.at === null ? 'g' : `g${source.at}`
    case 'none':
      return 'n'
  }
}

/**
 * Where a person's picture is served from (F28-AC49), by their id and the
 * version of their face (F28-AC101). Every page and answer that shows a
 * face takes its address from here, so a changed picture is a new address
 * everywhere at once and no browser shows the one it kept before.
 */
export const facePath = (userId: string, source: FaceSource) =>
  `/avatars/${userId}?v=${faceVersion(source)}`

/**
 * Bumped whenever the bytes the internal entrypoint returns would change for
 * the same upload, so old cache entries are never read again.
 */
export const FACE_CACHE_REVISION = 'v1'

const FACE_INTERNAL_HOST = 'https://face-pictures.internal'

/**
 * The internal URL of one uploaded picture. Its path is the cache key: it
 * names the person and the upload time (the picture's version), never the
 * request host or the `v` a reader asked for. The caller builds it from the
 * version D1 gives now, so a replaced picture is a new key.
 */
export const facePictureUrl = (userId: string, uploadedAt: number) =>
  `${FACE_INTERNAL_HOST}/${FACE_CACHE_REVISION}/${userId}/${uploadedAt}`

/** The upload an internal URL names, or null for any other URL. */
export function parseFacePictureUrl(
  url: string,
): Readonly<{ userId: string; uploadedAt: number }> | null {
  const { origin, pathname } = new URL(url)
  if (origin !== FACE_INTERNAL_HOST) return null
  const parts = pathname.slice(1).split('/')
  const [revision, userId, at] = parts
  if (parts.length !== 3 || revision !== FACE_CACHE_REVISION) return null
  if (!isUserId(userId) || !/^(0|[1-9]\d{0,15})$/.test(at)) return null
  return { userId, uploadedAt: Number(at) }
}

/**
 * How long the edge may keep an uploaded picture's bytes. The key is the
 * upload's own version, so the bytes behind it never change; a day bounds
 * how long a picture that was taken away stays in the edge (the gateway
 * asks D1 first and no longer asks for that version).
 */
export const FACE_EDGE_KEPT = 'public, max-age=86400'

/** How long a browser may keep a picture: a year, without asking again. */
export const FACE_KEPT = 'public, max-age=31536000, immutable'
/** An answer a browser must ask for again each time it shows it. */
export const FACE_ASKED_AGAIN = 'no-cache'

/**
 * How long the answer to a request for a face may be kept. Only a picture
 * served under the address of its own version is kept: that address names
 * that picture and no other. An uploaded picture is kept a year. A Gravatar
 * picture is kept only until the service would ask Gravatar again (`now` in
 * seconds): the version moves only when someone asks for the picture, so a
 * browser that never asked again would show a changed Gravatar forever. An
 * address without a version (an old page, or a link from outside), one with
 * a version that is no longer the face's, and no picture at all (404) are
 * asked again each time, so they never show a picture after it changed.
 */
export function faceCacheControl(
  asked: string | undefined,
  served: FaceSource | null,
  now: number,
): string {
  if (served === null || asked !== faceVersion(served)) return FACE_ASKED_AGAIN
  if (served.kind !== 'gravatar') return FACE_KEPT
  const left =
    served.at === null ? 0 : served.at + GRAVATAR_KEEP_SECONDS.image - now
  return left > 0
    ? `public, max-age=${Math.min(left, GRAVATAR_KEEP_SECONDS.image)}`
    : FACE_ASKED_AGAIN
}

/**
 * The picture laid over a person's initial, which every place that shows a
 * face draws the same way. While it loads, and when it cannot be read (a
 * person with no picture answers 404), the initial under it shows:
 * /share.js hides an image that fails, so no broken-image mark appears.
 */
export const faceImage = (src: string, className = '') =>
  html`<img
    data-cover
    ${className ? html`class="${className}"` : ''}
    src="${src}"
    alt=""
    loading="lazy"
    referrerpolicy="no-referrer"
  />`

/**
 * What a list's query reads beside each author to decide their face: the
 * same facts as `FaceFacts`, with the author's id, as nullable columns of
 * the two tables a person may have no row in.
 */
export const authorFaceColumns = z.object({
  authorUserId: z.string(),
  uploadedAt: z.number().int().nullable(),
  useGravatar: z.number().int().nullable(),
  gravatarAt: z.number().int().nullable(),
})
export type AuthorFaceColumns = z.infer<typeof authorFaceColumns>

/**
 * Where an author's picture is served from, for a card. A person with no
 * profile row yet has Gravatar on, as everyone starts.
 */
export const authorAvatarUrl = (columns: AuthorFaceColumns): string =>
  facePath(
    columns.authorUserId,
    faceSourceOf({
      uploadedAt: columns.uploadedAt,
      useGravatar: columns.useGravatar !== 0,
      gravatarAt: columns.gravatarAt,
    }),
  )
