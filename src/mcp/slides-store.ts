import { desc, eq } from 'drizzle-orm'
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
