import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { ownDeckRowSchema, toOwnDeck, type OwnDeck } from './own-decks'

/**
 * The author's own live slides, the most recently changed first. A slide
 * needs no repository to be listed. Each comes with the version its card
 * shows: the public one, or else the newest that finished receiving.
 * `slug` narrows the list to one slide.
 */
export async function listOwnDecks(
  database: D1Database,
  ownerUserId: string,
  slug?: string,
): Promise<OwnDeck[]> {
  const rows = await drizzle(database).all(sql`
    SELECT
      d.slug,
      d.created_at,
      d.public_deployment_id,
      d.paused_at,
      d.hidden_at,
      shown.id AS shown_id,
      shown.title AS shown_title,
      shown.cover_path AS shown_cover_path,
      newest.ready_at AS newest_ready_at
    FROM decks d
    LEFT JOIN deployments newest ON newest.id = (
      SELECT id FROM deployments
      WHERE deck_id = d.id AND state = 'ready'
      ORDER BY ready_at DESC, id DESC
      LIMIT 1
    )
    LEFT JOIN deployments shown
      ON shown.id = coalesce(d.public_deployment_id, newest.id)
    WHERE d.owner_user_id = ${ownerUserId}
      AND d.deleted_at IS NULL
      AND d.slug IS NOT NULL
      AND (${slug ?? null} IS NULL OR d.slug = ${slug ?? null})
    ORDER BY coalesce(newest.ready_at, d.created_at) DESC, d.slug
  `)
  return rows.map((row) => toOwnDeck(ownDeckRowSchema.parse(row)))
}
