import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { profilePictures } from '../db/schema'

/** Where an author's uploaded picture lives in R2. */
export const pictureKey = (userId: string) => `avatars/${userId}`

/**
 * When the author's uploaded picture was put up, or null without one. In
 * milliseconds since 0048 (seconds in rows written before): the time is the
 * picture's version in its address, so it must differ between any two
 * pictures, even ones a second apart.
 */
export async function readPictureTime(
  database: D1Database,
  userId: string,
): Promise<number | null> {
  const row = await drizzle(database)
    .select({ at: profilePictures.uploaded_at })
    .from(profilePictures)
    .where(eq(profilePictures.user_id, userId))
    .get()
  return row?.at ?? null
}

/**
 * Keeps the author's picture, replacing the one before it. The object goes
 * first, so a row never names a picture that was not written. When the row
 * then cannot be written, a picture that nobody had before is taken away
 * again, so no object is left that no row names. `now` is in milliseconds,
 * the picture's version in its address (`facePath`).
 */
export async function savePicture(
  stores: Readonly<{ database: D1Database; bucket: R2Bucket }>,
  input: Readonly<{
    userId: string
    bytes: Uint8Array
    contentType: string
    now: number
  }>,
): Promise<void> {
  const hadPicture =
    (await readPictureTime(stores.database, input.userId)) !== null
  await stores.bucket.put(pictureKey(input.userId), input.bytes, {
    httpMetadata: { contentType: input.contentType },
  })
  try {
    await drizzle(stores.database)
      .insert(profilePictures)
      .values({ user_id: input.userId, uploaded_at: input.now })
      .onConflictDoUpdate({
        target: profilePictures.user_id,
        set: { uploaded_at: input.now },
      })
  } catch (error) {
    if (!hadPicture)
      await stores.bucket.delete(pictureKey(input.userId)).catch(() => {})
    throw error
  }
}

/**
 * Takes the author's uploaded picture away. The row goes first: it is what
 * says a picture exists, so a failed delete leaves an object nothing reads.
 * Returns whether there was a picture.
 */
export async function removePicture(
  stores: Readonly<{ database: D1Database; bucket: R2Bucket }>,
  userId: string,
): Promise<boolean> {
  const removed = await drizzle(stores.database)
    .delete(profilePictures)
    .where(eq(profilePictures.user_id, userId))
    .returning({ id: profilePictures.user_id })
  await stores.bucket.delete(pictureKey(userId))
  return removed.length > 0
}

/** The stored picture's bytes, or null when the object is not there. */
export const readPictureObject = (bucket: R2Bucket, userId: string) =>
  bucket.get(pictureKey(userId))

/**
 * Erases everything R2 holds for a person's face: the picture they uploaded
 * and the Gravatar picture kept for them (F28-AC52).
 */
export const deleteFaces = (bucket: R2Bucket, userId: string) =>
  bucket.delete([pictureKey(userId), `gravatar/${userId}`])
