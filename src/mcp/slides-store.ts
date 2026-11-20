import { desc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { deployments } from '../db/schema'
import type { NewestUpload } from './tools'

/**
 * The newest upload of a deck in any state. The caller has already found
 * the deck to be the asker's own.
 */
export async function readNewestUpload(
  database: D1Database,
  deckId: string,
): Promise<NewestUpload | null> {
  const row = await drizzle(database)
    .select({
      id: deployments.id,
      state: deployments.state,
      createdAt: deployments.created_at,
      readyAt: deployments.ready_at,
    })
    .from(deployments)
    .where(eq(deployments.deck_id, deckId))
    .orderBy(desc(deployments.created_at), desc(deployments.id))
    .get()
  return row ?? null
}
