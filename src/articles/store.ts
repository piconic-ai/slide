import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import { articleCitations, articles } from '../db/schema'
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
  await db.batch([
    db
      .insert(articles)
      .values({
        deck_id: deckId,
        body,
        status,
        created_at: now,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: articles.deck_id,
        set: { body, status, updated_at: now },
      }),
    db.delete(articleCitations).where(eq(articleCitations.deck_id, deckId)),
    ...(status === 'published' ? citations : []).map((citation) =>
      db
        .insert(articleCitations)
        .values({
          deck_id: deckId,
          target_handle: citation.handle,
          target_slug: citation.slug,
          target_page: citation.page,
        })
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
