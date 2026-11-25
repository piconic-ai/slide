import type { GravatarAnswer } from './gravatar-client'
import type { KeptGravatar } from './gravatar'

const keyOf = (userId: string) => `gravatar/${userId}`

/** An answer kept earlier: what it said, when, and the picture if it had one. */
export type CachedGravatar = Readonly<{
  kept: KeptGravatar
  /** The picture, for a kept `image`; null for `none`. */
  picture: Readonly<{ body: ReadableStream; contentType: string }> | null
}>

/** The answer kept for a person, fresh or not; null when none is kept. */
export async function readCachedGravatar(
  bucket: R2Bucket,
  userId: string,
): Promise<CachedGravatar | null> {
  const object = await bucket.get(keyOf(userId))
  if (!object) return null
  const at = Number(object.customMetadata?.at)
  if (!Number.isInteger(at)) return null
  if (object.customMetadata?.kind === 'none')
    return { kept: { kind: 'none', at }, picture: null }
  return {
    kept: { kind: 'image', at },
    picture: {
      body: object.body,
      contentType: object.httpMetadata?.contentType ?? 'image/jpeg',
    },
  }
}

/**
 * Keeps an answer that settled something: a picture, or that there is none.
 * An answer that could not be had is not kept, so the next look asks again.
 */
export async function keepGravatar(
  bucket: R2Bucket,
  userId: string,
  answer: GravatarAnswer,
  now: number,
): Promise<void> {
  if (answer.kind === 'unreachable') return
  await bucket.put(keyOf(userId), answer.kind === 'image' ? answer.bytes : '', {
    httpMetadata:
      answer.kind === 'image' ? { contentType: answer.contentType } : undefined,
    customMetadata: { kind: answer.kind, at: String(now) },
  })
}

/** Forgets what was kept for a person (when they leave or turn Gravatar off). */
export const forgetGravatar = (bucket: R2Bucket, userId: string) =>
  bucket.delete(keyOf(userId))
