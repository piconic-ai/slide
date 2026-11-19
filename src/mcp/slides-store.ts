import { and, desc, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { decks, deployments } from '../db/schema'
import type { NewestUpload } from './tools'

/**
 * The newest upload of a deck in any state, and the version readers see,
 * if any. The caller has already found the deck to be the asker's own.
 */
export async function readUploadStatus(
  database: D1Database,
  deckId: string,
): Promise<
  Readonly<{ newest: NewestUpload | null; publicUploadId: string | null }>
> {
  const db = drizzle(database)
  const [uploads, pointers] = await db.batch([
    db
      .select({
        id: deployments.id,
        state: deployments.state,
        createdAt: deployments.created_at,
        readyAt: deployments.ready_at,
      })
      .from(deployments)
      .where(eq(deployments.deck_id, deckId))
      .orderBy(desc(deployments.created_at), desc(deployments.id))
      .limit(1),
    db
      .select({ publicUploadId: decks.public_deployment_id })
      .from(decks)
      .where(eq(decks.id, deckId)),
  ])
  return {
    newest: uploads[0] ?? null,
    publicUploadId: pointers[0]?.publicUploadId ?? null,
  }
}

/**
 * The URL name of the owner's own live slide that an upload belongs to, or
 * null: an upload of someone else's slide is the same as none.
 */
export async function readUploadSlide(
  database: D1Database,
  ownerUserId: string,
  uploadId: string,
): Promise<string | null> {
  const row = await drizzle(database)
    .select({ slug: decks.slug })
    .from(deployments)
    .innerJoin(decks, eq(decks.id, deployments.deck_id))
    .where(
      and(
        eq(deployments.id, uploadId),
        eq(decks.owner_user_id, ownerUserId),
        isNull(decks.deleted_at),
      ),
    )
    .get()
  return row?.slug ?? null
}
