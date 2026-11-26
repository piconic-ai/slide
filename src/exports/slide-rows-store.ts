// Reads a person's slides as rows for their export lists. The owner is the
// first condition of every query here.
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { slideRowSchema, summarizeSlide, type SlideSummary } from './slide-rows'

/**
 * A person's live slides, the most recently changed first, as the list of
 * their slides orders them. `limit` and `offset` page through them.
 */
export async function listSlideSummaries(
  database: D1Database,
  ownerUserId: string,
  window: Readonly<{ limit: number; offset: number }> = {
    limit: -1,
    offset: 0,
  },
): Promise<readonly SlideSummary[]> {
  const rows = await drizzle(database).all(sql`
    SELECT
      d.slug, d.created_at, d.first_published_at, d.paused_at, d.hidden_at,
      d.public_deployment_id, d.resume_deployment_id,
      p.id AS pointed_id,
      COALESCE(p.ready_at, p.created_at) AS pointed_ready_at,
      p.rowid AS pointed_order,
      p.title AS pointed_title,
      n.id AS latest_id,
      COALESCE(n.ready_at, n.created_at) AS latest_ready_at,
      n.rowid AS latest_order,
      n.title AS latest_title,
      EXISTS (SELECT 1 FROM articles a WHERE a.deck_id = d.id) AS has_article
    FROM decks d
    LEFT JOIN deployments p
      ON p.id = COALESCE(d.public_deployment_id, d.resume_deployment_id)
      AND p.deck_id = d.id
    LEFT JOIN deployments n ON n.id = (
      SELECT id FROM deployments
      WHERE deck_id = d.id AND state = 'ready'
      ORDER BY COALESCE(ready_at, created_at) DESC, rowid DESC
      LIMIT 1
    )
    WHERE d.owner_user_id = ${ownerUserId}
      AND d.deleted_at IS NULL
      AND d.slug IS NOT NULL
    ORDER BY COALESCE(n.ready_at, d.created_at) DESC, d.slug
    LIMIT ${window.limit} OFFSET ${window.offset}
  `)
  return rows.map((row) => summarizeSlide(slideRowSchema.parse(row)))
}

/** How many live slides the person has. */
export async function countSlides(
  database: D1Database,
  ownerUserId: string,
): Promise<number> {
  const row = await drizzle(database).get<{ count: number }>(sql`
    SELECT count(*) AS count FROM decks
    WHERE owner_user_id = ${ownerUserId}
      AND deleted_at IS NULL AND slug IS NOT NULL`)
  return row?.count ?? 0
}
