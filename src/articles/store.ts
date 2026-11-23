import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import { articleCitations, articles, decks } from '../db/schema'
import type { Citation } from '../citations/citation'
import type { ArticleStatus } from './article'

const rowSchema = z.object({
  body: z.string(),
  draftBody: z.string().nullable(),
  revision: z.number().int(),
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
      draftBody: articles.draft_body,
      revision: articles.revision,
      status: articles.status,
      createdAt: articles.created_at,
      updatedAt: articles.updated_at,
    })
    .from(articles)
    .where(eq(articles.deck_id, deckId))
    .get()
  return row ? rowSchema.parse(row) : null
}

/** Whether a deck is there and not deleted, as an SQL condition. */
const liveDeckOf = (deckId: string) =>
  and(eq(decks.id, deckId), isNull(decks.deleted_at))

const liveDeckExists = (deckId: string) =>
  sql`EXISTS (SELECT 1 FROM ${decks} WHERE ${liveDeckOf(deckId)})`

/**
 * Replaces the links a published article makes with these (a draft holds
 * none), once the article itself was written. Readers' queries also ask for
 * a published article, so a gap between the two writes shows nothing wrong.
 */
async function replaceCitations(
  database: D1Database,
  deckId: string,
  citations: readonly Citation[],
) {
  const db = drizzle(database)
  const live = liveDeckOf(deckId)
  await db.batch([
    db.delete(articleCitations).where(eq(articleCitations.deck_id, deckId)),
    ...citations.map((citation) =>
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
 * Keeps the article's text in the given state and holds no pending edit: a
 * draft, or a publication with these links (a draft holds none). The first
 * write makes the article; later ones keep when it was made.
 *
 * Every write is one statement that names the deck and holds only while the
 * deck is not deleted, so a deletion that lands first leaves no row. With
 * `expectedRevision` it also holds only while the article is still at that
 * revision (null: still none), so a write from an out-of-date screen is
 * refused, as 'not_kept'.
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
    /**
     * Writes only while the article is not published, in the same
     * statement: a publication that lands first is kept as it is.
     */
    unlessPublished?: boolean
    /** The revision the writer saw; left out, any is accepted. */
    expectedRevision?: number | null
  }>,
): Promise<'kept' | 'not_kept'> {
  const { deckId, body, status, citations, now, expectedRevision } = input
  const db = drizzle(database)
  const creating = expectedRevision === undefined || expectedRevision === null
  const updating = expectedRevision !== null
  const results = await db.batch([
    db
      .insert(articles)
      .select(
        db
          .select({
            deck_id: decks.id,
            body: sql<string>`${creating ? body : ''}`.as('body'),
            draft_body: sql<string | null>`NULL`.as('draft_body'),
            revision: sql<number>`1`.as('revision'),
            status: sql<string>`${status}`.as('status'),
            created_at: sql<number>`${now}`.as('created_at'),
            updated_at: sql<number>`${now}`.as('updated_at'),
          })
          .from(decks)
          .where(and(liveDeckOf(deckId), creating ? undefined : sql`0`)),
      )
      .onConflictDoNothing(),
    db
      .update(articles)
      .set({
        body,
        draft_body: null,
        status,
        updated_at: now,
        revision: sql`${articles.revision} + 1`,
      })
      .where(
        and(
          eq(articles.deck_id, deckId),
          liveDeckExists(deckId),
          updating ? undefined : sql`0`,
          expectedRevision === undefined || expectedRevision === null
            ? undefined
            : eq(articles.revision, expectedRevision),
          input.unlessPublished ? ne(articles.status, 'published') : undefined,
        ),
      ),
  ])
  const [inserted, updated] = results
  if (inserted.meta.changes + updated.meta.changes === 0) return 'not_kept'
  await replaceCitations(
    database,
    deckId,
    status === 'published' ? citations : [],
  )
  return 'kept'
}

/**
 * Saves the text as the author types, where readers do not see it: into the
 * draft's own text, or for a published article into its pending edit (none
 * when the text equals the published one). `known` is the revision the
 * screen loaded (null: no article yet); a write from a screen that is behind
 * is 'conflict'. Nothing is written for a deck that is gone.
 */
export async function autosaveArticle(
  database: D1Database,
  input: Readonly<{
    deckId: string
    body: string
    known: number | null
    now: number
  }>,
): Promise<
  | Readonly<{ result: 'saved'; revision: number; pending: boolean }>
  | Readonly<{ result: 'conflict' }>
> {
  const { deckId, body, known, now } = input
  const db = drizzle(database)
  if (known === null) {
    const created = await db
      .insert(articles)
      .select(
        db
          .select({
            deck_id: decks.id,
            body: sql<string>`${body}`.as('body'),
            draft_body: sql<string | null>`NULL`.as('draft_body'),
            revision: sql<number>`1`.as('revision'),
            status: sql<string>`'draft'`.as('status'),
            created_at: sql<number>`${now}`.as('created_at'),
            updated_at: sql<number>`${now}`.as('updated_at'),
          })
          .from(decks)
          .where(liveDeckOf(deckId)),
      )
      .onConflictDoNothing()
    return created.meta.changes > 0
      ? { result: 'saved', revision: 1, pending: false }
      : { result: 'conflict' }
  }
  const rows = await db
    .update(articles)
    .set({
      body: sql`CASE WHEN ${articles.status} = 'draft' THEN ${body} ELSE ${articles.body} END`,
      draft_body: sql`CASE WHEN ${articles.status} = 'published' AND ${body} <> ${articles.body} THEN ${body} ELSE NULL END`,
      updated_at: now,
      revision: sql`${articles.revision} + 1`,
    })
    .where(
      and(
        eq(articles.deck_id, deckId),
        eq(articles.revision, known),
        liveDeckExists(deckId),
      ),
    )
    .returning({
      revision: articles.revision,
      draftBody: articles.draft_body,
    })
  const [row] = rows
  return row
    ? {
        result: 'saved',
        revision: row.revision,
        pending: row.draftBody !== null,
      }
    : { result: 'conflict' }
}

/**
 * Drops the pending edit of a published article: the published text stands.
 * Held only at the revision the screen saw. 'not_kept' otherwise.
 */
export async function discardPendingEdit(
  database: D1Database,
  input: Readonly<{ deckId: string; known: number; now: number }>,
): Promise<'kept' | 'not_kept'> {
  const db = drizzle(database)
  const rows = await db
    .update(articles)
    .set({
      draft_body: null,
      updated_at: input.now,
      revision: sql`${articles.revision} + 1`,
    })
    .where(
      and(
        eq(articles.deck_id, input.deckId),
        eq(articles.status, 'published'),
        eq(articles.revision, input.known),
        liveDeckExists(input.deckId),
      ),
    )
    .returning({ revision: articles.revision })
  return rows.length > 0 ? 'kept' : 'not_kept'
}

/**
 * Makes a published article a draft again, holding the text the author was
 * editing (the text sent with the button; else the pending edit, else the
 * published text), and takes its links away. Held only at the revision the screen saw. 'not_kept' otherwise.
 */
export async function unpublishArticle(
  database: D1Database,
  input: Readonly<{
    deckId: string
    known: number
    now: number
    /** The text the author had in the box; left out, the stored edit stands. */
    body?: string
  }>,
): Promise<'kept' | 'not_kept'> {
  const db = drizzle(database)
  const rows = await db
    .update(articles)
    .set({
      status: 'draft',
      body:
        input.body === undefined
          ? sql`COALESCE(${articles.draft_body}, ${articles.body})`
          : sql`${input.body}`,
      draft_body: null,
      updated_at: input.now,
      revision: sql`${articles.revision} + 1`,
    })
    .where(
      and(
        eq(articles.deck_id, input.deckId),
        eq(articles.status, 'published'),
        eq(articles.revision, input.known),
        liveDeckExists(input.deckId),
      ),
    )
    .returning({ revision: articles.revision })
  if (rows.length === 0) return 'not_kept'
  await replaceCitations(database, input.deckId, [])
  return 'kept'
}
