import { and, desc, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { decks, deployments } from '../db/schema'
import { publicationFields } from '../publication/store'
import {
  parseDeckPublication,
  type DeckPublication,
} from '../publication/state'
import { notHidden } from '../publication/takedown-store'
import type { ReadyVersion } from './owner-view'

/** The most received versions the owner's viewer looks at. */
const VERSIONS_LOOKED_AT = 50

export type OwnerDeck = Readonly<{
  deckId: string
  state: DeckPublication
  /** Received versions, the newest first. */
  versions: readonly ReadyVersion[]
}>

/**
 * The owner's live deck of that slug, as its owner's viewer needs it. Null
 * for a deck that is not the owner's, is deleted, or an operator hid; the
 * viewer then answers as it does for anyone else.
 */
export async function readOwnerDeck(
  database: D1Database,
  input: Readonly<{ ownerUserId: string; slug: string }>,
): Promise<OwnerDeck | null> {
  const db = drizzle(database)
  const deck = await db
    .select({ id: decks.id, ...publicationFields })
    .from(decks)
    .where(
      and(
        eq(decks.owner_user_id, input.ownerUserId),
        eq(decks.slug, input.slug),
        isNull(decks.deleted_at),
        notHidden,
      ),
    )
    .get()
  if (!deck) return null
  const versions = await db
    .select({ id: deployments.id, readyAt: deployments.ready_at })
    .from(deployments)
    .where(
      and(eq(deployments.deck_id, deck.id), eq(deployments.state, 'ready')),
    )
    .orderBy(desc(deployments.ready_at))
    .limit(VERSIONS_LOOKED_AT)
  return {
    deckId: deck.id,
    state: parseDeckPublication(deck),
    versions: versions.map((row) => ({
      id: row.id,
      readyAt: row.readyAt ?? 0,
    })),
  }
}

/** What the viewer shows of one received version of the deck. */
export async function readVersionCard(
  database: D1Database,
  deckId: string,
  deploymentId: string,
) {
  const row = await drizzle(database)
    .select({
      title: deployments.title,
      description: deployments.description,
      coverPath: deployments.cover_path,
    })
    .from(deployments)
    .where(
      and(
        eq(deployments.id, deploymentId),
        eq(deployments.deck_id, deckId),
        eq(deployments.state, 'ready'),
      ),
    )
    .get()
  return row ?? null
}
