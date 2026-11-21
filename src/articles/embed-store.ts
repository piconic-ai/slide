import { desc, eq, and } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { deployments, pageScriptDeployments } from '../db/schema'
import { deckSlugSchema } from '../decks/deck-id'
import { readProfile } from '../profile/store'
import { previewImageUrl } from '../share/cover'
import { handleSchema } from '../share/handle'
import { readSharedDeployment } from '../share/store'
import { pageKey, type Embed, type PageRef } from './markdown'

/** What an image of one of the article's own pages is taken from. */
export type OwnVersion = Readonly<{
  id: string
  coverPath: string | null
  loadsPageScript: boolean
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
      pageScript: pageScriptDeployments.deployment_id,
    })
    .from(deployments)
    .leftJoin(
      pageScriptDeployments,
      eq(pageScriptDeployments.deployment_id, deployments.id),
    )
    .where(and(eq(deployments.deck_id, deckId), eq(deployments.state, 'ready')))
    .orderBy(desc(deployments.ready_at), desc(deployments.created_at))
    .limit(1)
    .get()
  return row
    ? {
        id: row.id,
        coverPath: row.coverPath,
        loadsPageScript: row.pageScript !== null,
      }
    : null
}

/** The article's own slides, which its pages are looked up against. */
export type OwnDeck = Readonly<{
  handle: string
  slug: string
  /** The version its pages are taken from; none when it has no version. */
  version: OwnVersion | null
}>

/**
 * Looks up the pages an article shows as images. A page of the article's own
 * slides is shown when it has a version to take it from. A page of other
 * slides is shown when those slides are public now and no operator hid them
 * or stopped their author (the conditions every reader's page answers to), with
 * their title and the author's name. Any other page is left out of the answer:
 * what is not public, and what does not exist, cannot be told apart, so the
 * article shows nothing of either.
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
  await Promise.all(
    pages.map(async (ref) => {
      if (ref.handle === own.handle && ref.slug === own.slug) {
        if (own.version)
          found.set(pageKey(ref), {
            kind: 'own',
            imageUrl: previewImageUrl(contentBase, own.version, ref.page),
          })
        return
      }
      const handle = handleSchema.safeParse(ref.handle)
      const slug = deckSlugSchema.safeParse(ref.slug)
      if (!handle.success || !slug.success) return
      const shared = await readSharedDeployment(
        database,
        handle.data,
        slug.data,
      )
      if (!shared) return
      const author = await readProfile(database, shared.ownerUserId)
      found.set(pageKey(ref), {
        kind: 'other',
        imageUrl: previewImageUrl(contentBase, shared, ref.page),
        title: shared.title ?? ref.slug,
        author: author?.name ?? null,
      })
    }),
  )
  return found
}
