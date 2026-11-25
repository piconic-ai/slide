import { and, desc, eq, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { accounts, decks, deployments, profiles } from '../db/schema'
import { personNamedBy } from '../handles/store'
import { notHidden } from '../publication/takedown-store'
import { deckSlugSchema } from '../decks/deck-id'
import { previewImageUrl } from '../share/cover'
import { handleSchema } from '../share/handle'
import { decksOf, pagesWithinLimit, type DeckName } from './embed-decks'
import { pageKey, type Embed, type PageRef } from './markdown'

/** What an image of one of the article's own pages is taken from. */
export type OwnVersion = Readonly<{
  id: string
  coverPath: string | null
}>

/**
 * The newest received version of a deck, which the editing page takes the
 * article's own pages from before any version is public.
 */
export async function readNewestVersion(
  database: D1Database,
  deckId: string,
): Promise<OwnVersion | null> {
  const row = await drizzle(database)
    .select({
      id: deployments.id,
      coverPath: deployments.cover_path,
    })
    .from(deployments)
    .where(and(eq(deployments.deck_id, deckId), eq(deployments.state, 'ready')))
    .orderBy(desc(deployments.ready_at), desc(deployments.created_at))
    .limit(1)
    .get()
  return row ?? null
}

/** The article's own slides, which its pages are looked up against. */
export type OwnDeck = Readonly<{
  handle: string
  slug: string
  /** The version its pages are taken from; none when it has no version. */
  version: OwnVersion | null
}>

/**
 * What the slides an article names are shown from: who the handle names now
 * (`current`, which differs from `asked` after an operator changed it), and,
 * for each of their public slides asked for, the version and its author.
 */
const namedRowSchema = z.object({
  asked: z.string(),
  current: handleSchema,
  slug: deckSlugSchema.nullable(),
  id: z.string().nullable(),
  title: z.string().nullable(),
  coverPath: z.string().nullable(),
  author: z.string().nullable(),
})

/**
 * The people the given handles name, and their public slides among the
 * given ones, with their author's display name, in one query (an article
 * asks for at most `MAX_OTHER_DECKS` slides). The caller names each slides
 * once, not once per page. A handle an operator changed still names its
 * person, as its URL redirects there. The conditions on slides are the
 * viewer's: a public version, no operator's hiding, no stopped author.
 */
async function readNamedDecks(
  database: D1Database,
  names: readonly DeckName[],
) {
  if (names.length === 0) return []
  const asked = [...new Set(names.map(({ handle }) => handle))]
  const wanted = or(
    ...names.map(({ handle, slug }) =>
      and(sql`named.asked = ${handle}`, eq(decks.slug, slug)),
    ),
  )
  const rows = await drizzle(database).all(sql`
    SELECT named.asked AS asked,
      ${accounts.handle} AS current,
      ${decks.slug} AS slug,
      ${deployments.id} AS id,
      ${deployments.title} AS title,
      ${deployments.cover_path} AS coverPath,
      ${profiles.name} AS author
    FROM ${personNamedBy(asked)} AS named
    JOIN ${accounts} ON ${accounts.user_id} = named.user_id
    LEFT JOIN ${decks} ON ${decks.owner_user_id} = named.user_id
      AND ${wanted} AND ${notHidden}
    LEFT JOIN ${deployments} ON ${deployments.id} = ${decks.public_deployment_id}
      AND ${deployments.deck_id} = ${decks.id}
      AND ${deployments.state} = 'ready'
    LEFT JOIN ${profiles} ON ${profiles.user_id} = named.user_id`)
  return namedRowSchema.array().parse(rows)
}

/**
 * Looks up the pages an article shows as images. A page of the article's own
 * slides is shown when it has a version to take it from. A page of other
 * slides is shown when those slides are public now and no operator hid them
 * or stopped their author (the conditions every reader's page answers to), with
 * their title and the author's name. Any other page is left out of the answer:
 * what is not public, and what does not exist, cannot be told apart, so the
 * article shows nothing of either. A page named under a handle an operator
 * changed is looked up under the handle it moved to, so the article shows
 * the same before and after the change. All the slides are read by one query;
 * past `MAX_OTHER_DECKS` of them, their pages are left out unasked.
 */
export async function resolveEmbeds(
  database: D1Database,
  input: Readonly<{
    pages: readonly PageRef[]
    own: OwnDeck
    contentBase: URL | null
  }>,
): Promise<Map<string, Embed>> {
  const { own, contentBase } = input
  const found = new Map<string, Embed>()
  if (!contentBase) return found
  const pages = pagesWithinLimit(input.pages, own)
  const named = await readNamedDecks(
    database,
    decksOf(
      pages.filter((ref) => ref.handle !== own.handle || ref.slug !== own.slug),
    ),
  )
  const currentOf = (handle: string) =>
    named.find((row) => row.asked === handle)?.current ?? handle
  const isOwn = (ref: PageRef) =>
    currentOf(ref.handle) === own.handle && ref.slug === own.slug
  for (const ref of pages) {
    const key = pageKey(ref)
    if (isOwn(ref)) {
      if (own.version)
        found.set(key, {
          kind: 'own',
          imageUrl: previewImageUrl(contentBase, own.version, ref.page),
        })
      continue
    }
    const deck = named.find(
      (row) => row.asked === ref.handle && row.slug === ref.slug,
    )
    if (!deck?.id) continue
    found.set(key, {
      kind: 'other',
      imageUrl: previewImageUrl(
        contentBase,
        { id: deck.id, coverPath: deck.coverPath },
        ref.page,
      ),
      title: deck.title ?? ref.slug,
      author: deck.author,
    })
  }
  return found
}
