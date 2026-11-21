import { and, eq, isNull, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import { articleCitations, articles, decks } from '../db/schema'
import type { Citation } from '../citations/citation'
import type { ArticleStatus } from './article'

const rowSchema = z.object({
  body: z.string(),
  status: z.enum(['draft', 'published']),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
})

/** The article under a deck. */
export type StoredArticle = Readonly<z.infer<typeof rowSchema>>

/** The deck's article, or null while it has none. */
export async function readArticle(
  database: D1Database,
  deckId: string,
): Promise<StoredArticle | null> {
  const row = await drizzle(database)
    .select({
      body: articles.body,
      status: articles.status,
      createdAt: articles.created_at,
      updatedAt: articles.updated_at,
    })
    .from(articles)
    .where(eq(articles.deck_id, deckId))
    .get()
  return row ? rowSchema.parse(row) : null
}

/**
 * Keeps the article's body in the given state, in one batch with the links it
 * makes to share URLs: a published article holds them, a draft holds none.
 * The first save makes the article; later ones keep when it was made.
 */
export async function keepArticle(
  database: D1Database,
  input: Readonly<{
    deckId: string
    body: string
    status: ArticleStatus
    /** The links of the body, already without the deck's own. */
    citations: readonly Citation[]
    now: number
  }>,
) {
  const { deckId, body, status, citations, now } = input
  const db = drizzle(database)
  // Every write names the deck and holds only while the deck is not deleted:
  // a deletion that lands first leaves no row behind (the deletion removes
  // the deck's article and citations in its own batch, once).
  const live = and(eq(decks.id, deckId), isNull(decks.deleted_at))
  const liveDeck = sql`EXISTS (SELECT 1 FROM ${decks} WHERE ${live})`
  await db.batch([
    db
      .insert(articles)
      .select(
        db
          .select({
            deck_id: decks.id,
            body: sql<string>`${body}`.as('body'),
            status: sql<string>`${status}`.as('status'),
            created_at: sql<number>`${now}`.as('created_at'),
            updated_at: sql<number>`${now}`.as('updated_at'),
          })
          .from(decks)
          .where(live),
      )
      .onConflictDoNothing(),
    db
      .update(articles)
      .set({ body, status, updated_at: now })
      .where(and(eq(articles.deck_id, deckId), liveDeck)),
    db.delete(articleCitations).where(eq(articleCitations.deck_id, deckId)),
    ...(status === 'published' ? citations : []).map((citation) =>
      db
        .insert(articleCitations)
        .select(
          db
            .select({
              deck_id: decks.id,
              target_handle: sql<string>`${citation.handle}`.as(
                'target_handle',
              ),
              target_slug: sql<string>`${citation.slug}`.as('target_slug'),
              target_page: sql<number>`${citation.page}`.as('target_page'),
            })
            .from(decks)
            .where(live),
        )
        .onConflictDoNothing(),
    ),
  ])
}

/**
 * Makes a published article a draft again and takes its links away, as one
 * batch. The text and the day it was last saved stay as they were. Nothing
 * changes for a deck with no article.
 */
export async function unpublishArticle(database: D1Database, deckId: string) {
  const db = drizzle(database)
  await db.batch([
    db
      .update(articles)
      .set({ status: 'draft' })
      .where(eq(articles.deck_id, deckId)),
    db.delete(articleCitations).where(eq(articleCitations.deck_id, deckId)),
  ])
}
