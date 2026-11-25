import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { communities } from '../db/schema'
import { imageKey, type CommunityImage } from './image-policy'

const column = (image: CommunityImage) =>
  image === 'logo' ? 'logo_at' : 'cover_at'

/**
 * Keeps a community's logo or cover, replacing the one before. The object
 * goes first, so the row never names a picture that was not written; the
 * time in the row is the picture's version in its address. False when there
 * is no such community (the object is taken away again).
 */
export async function saveCommunityImage(
  stores: Readonly<{ database: D1Database; bucket: R2Bucket }>,
  input: Readonly<{
    communityId: number
    image: CommunityImage
    bytes: Uint8Array
    now: number
  }>,
): Promise<boolean> {
  const key = imageKey(input.communityId, input.image)
  await stores.bucket.put(key, input.bytes, {
    httpMetadata: { contentType: 'image/png' },
  })
  const result = await drizzle(stores.database)
    .update(communities)
    .set({ [column(input.image)]: input.now })
    .where(eq(communities.id, input.communityId))
    .run()
  if (result.meta.changes > 0) return true
  await stores.bucket.delete(key)
  return false
}

/**
 * Takes a community's logo or cover away, back to the initial or the
 * default pattern (F30-AC31). The row goes first: it is what says a picture
 * exists.
 */
export async function removeCommunityImage(
  stores: Readonly<{ database: D1Database; bucket: R2Bucket }>,
  input: Readonly<{ communityId: number; image: CommunityImage }>,
): Promise<void> {
  await drizzle(stores.database)
    .update(communities)
    .set({ [column(input.image)]: null })
    .where(eq(communities.id, input.communityId))
  await stores.bucket.delete(imageKey(input.communityId, input.image))
}

/** The stored picture's object, or null when it is not there. */
export const readCommunityImage = (
  bucket: R2Bucket,
  communityId: number,
  image: CommunityImage,
) => bucket.get(imageKey(communityId, image))
