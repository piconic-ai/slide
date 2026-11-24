import { html } from 'hono/html'

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

/** How long a browser may keep a picture: a year, without asking again. */
export const FACE_KEPT = 'public, max-age=31536000, immutable'
/** An answer a browser must ask for again each time it shows it. */
export const FACE_ASKED_AGAIN = 'no-cache'

/**
 * How long the answer to a request for a face may be kept. Only a picture
 * served under the address of its own version is kept: that address names
 * that picture and no other. An address without a version (an old page, or a
 * link from outside), one with a version that is no longer the face's, and
 * no picture at all (404) are asked again each time, so they never show a
 * picture after it changed.
 */
export const faceCacheControl = (
  asked: string | undefined,
  served: FaceSource | null,
) =>
  served !== null && asked === faceVersion(served)
    ? FACE_KEPT
    : FACE_ASKED_AGAIN

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
