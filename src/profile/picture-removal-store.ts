import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { pictureRemovals, profilePictures } from '../db/schema'
import { pictureKey, readPictureTime } from './picture-store'

export type PictureRemoval = 'removed' | 'no_picture'

/**
 * Takes a person's uploaded picture down on the operator's word, and records
 * who did it, why and when. The record and the removal are one batch, and
 * nothing is recorded where no picture existed. The person's face is then
 * their Gravatar picture or their initial.
 */
export async function removePictureAsOperator(
  stores: Readonly<{ database: D1Database; bucket: R2Bucket }>,
  input: Readonly<{
    userId: string
    operator: string
    reason: string
    now: number
  }>,
): Promise<PictureRemoval> {
  if ((await readPictureTime(stores.database, input.userId)) === null)
    return 'no_picture'
  const db = drizzle(stores.database)
  await db.batch([
    db.insert(pictureRemovals).values({
      user_id: input.userId,
      removed_by: input.operator,
      reason: input.reason,
      removed_at: input.now,
    }),
    db.delete(profilePictures).where(eq(profilePictures.user_id, input.userId)),
  ])
  // The object goes after the row: nothing reads an object the row denies.
  await stores.bucket.delete(pictureKey(input.userId))
  return 'removed'
}
