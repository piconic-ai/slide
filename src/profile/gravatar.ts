/** How big a picture to ask Gravatar for, in pixels (twice the largest shown). */
export const GRAVATAR_SIDE = 256

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')

/**
 * The identifier Gravatar knows an address by: the address with the white
 * space at its ends taken off and every letter lower-cased, hashed with
 * SHA-256 and written in hexadecimal (docs.gravatar.com/rest/hash/).
 */
export async function gravatarHash(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase()
  return hex(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized)),
  )
}

/**
 * Where Gravatar's picture for a hash is. `d=404` makes Gravatar answer 404
 * where the address has none, instead of drawing a stand-in of its own.
 */
export const gravatarUrl = (hash: string) =>
  `https://gravatar.com/avatar/${hash}?s=${GRAVATAR_SIDE}&d=404`

/** How long an answer from Gravatar is kept, in seconds. */
export const GRAVATAR_KEEP_SECONDS = {
  /** A picture changes seldom. */
  image: 24 * 60 * 60,
  /** Short, so a Gravatar made later shows within the hour. */
  none: 60 * 60,
} as const

/** What was kept of an answer, and when. */
export type KeptGravatar = Readonly<{
  kind: 'image' | 'none'
  /** When it was fetched, in seconds. */
  at: number
}>

/** Whether a kept answer may still be used at `now`. */
export const isFresh = (kept: KeptGravatar, now: number) =>
  now >= kept.at && now - kept.at < GRAVATAR_KEEP_SECONDS[kept.kind]
