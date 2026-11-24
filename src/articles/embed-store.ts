import { and, desc, eq, or } from 'drizzle-orm'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { accounts, decks, deployments, profiles } from '../db/schema'
import { notHidden } from '../publication/takedown-store'
import { deckSlugSchema } from '../decks/deck-id'
import { previewImageUrl } from '../share/cover'
import { handleSchema } from '../share/handle'
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

/** What an embedded page of other slides is shown from. */
const otherRowSchema = z.object({
  handle: handleSchema,
  slug: deckSlugSchema,
  id: z.string(),
  title: z.string().nullable(),
  coverPath: z.string().nullable(),
  author: z.string().nullable(),
})

/**
 * The public slides among the given ones, with their author's display name,
 * in one query however many are asked for (an article names at most
 * `MAX_EMBEDS`). The conditions are the viewer's: a public version, no
 * operator's hiding, no stopped author.
 */
async function readPublicDecks(
  database: D1Database,
  names: readonly Readonly<{ handle: string; slug: string }>[],
) {
  if (names.length === 0) return []
  const rows = await drizzle(database)
    .select({
      handle: accounts.handle,
      slug: decks.slug,
      id: deployments.id,
      title: deployments.title,
      coverPath: deployments.cover_path,
      author: profiles.name,
    })
    .from(accounts)
    .innerJoin(decks, and(eq(decks.owner_user_id, accounts.user_id), notHidden))
    .innerJoin(
      deployments,
      and(
        eq(deployments.id, decks.public_deployment_id),
        eq(deployments.deck_id, decks.id),
        eq(deployments.state, 'ready'),
      ),
    )
    .leftJoin(profiles, eq(profiles.user_id, accounts.user_id))
    .where(
      or(
        ...names.map(({ handle, slug }) =>
          and(eq(accounts.handle, handle), eq(decks.slug, slug)),
        ),
      ),
    )
  return otherRowSchema.array().parse(rows)
}

/**
 * Looks up the pages an article shows as images. A page of the article's own
 * slides is shown when it has a version to take it from. A page of other
 * slides is shown when those slides are public now and no operator hid them
 * or stopped their author (the conditions every reader's page answers to), with
 * their title and the author's name. Any other page is left out of the answer:
 * what is not public, and what does not exist, cannot be told apart, so the
 * article shows nothing of either. All the other slides are read by one query.
 */
export async function resolveEmbeds(
  database: D1Database,
  input: Readonly<{
    pages: readonly PageRef[]
    own: OwnDeck
    contentBase: URL | null
  }>,
): Promise<Map<string, Embed>> {
  const { pages, own, contentBase } = input
  const found = new Map<string, Embed>()
  if (!contentBase) return found
  const isOwn = (ref: PageRef) =>
    ref.handle === own.handle && ref.slug === own.slug
  for (const ref of pages)
    if (isOwn(ref) && own.version)
      found.set(pageKey(ref), {
        kind: 'own',
        imageUrl: previewImageUrl(contentBase, own.version, ref.page),
      })
  const others = await readPublicDecks(
    database,
    pages.filter((ref) => !isOwn(ref)),
  )
  for (const ref of pages) {
    const deck = others.find(
      (row) => row.handle === ref.handle && row.slug === ref.slug,
    )
    if (isOwn(ref) || !deck) continue
    found.set(pageKey(ref), {
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
