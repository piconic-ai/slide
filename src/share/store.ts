import { and, desc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import {
  deckIdSchema,
  deckSlugSchema,
  type DeckId,
  type DeckSlug,
} from '../decks/deck-id'
import {
  accounts,
  decks,
  deployments,
  follows,
  profilePictures,
  profiles,
} from '../db/schema'
import { authorFaceFields } from '../profile/author-face-store'
import {
  authorAvatarUrl,
  authorFaceColumns,
  type AuthorFaceColumns,
} from '../profile/face'
import { notBlockedBy } from '../blocks/store'
import { notMutedBy } from '../mutes/store'
import { handleSchema, type Handle } from './handle'
import type { DeckAfter } from '../site/home-more'
import { readSuspension } from '../publication/suspension-store'
import { notHidden } from '../publication/takedown-store'

/**
 * The deployment a share URL shows now: the deck's public deployment, still
 * ready and of the same deck. Drafts, paused and missing decks give null.
 */
export async function readSharedDeployment(
  database: D1Database,
  handle: Handle,
  slug: DeckSlug,
): Promise<{
  id: string
  /** The deck's key, for what is stored under it. */
  deckId: DeckId
  ownerUserId: string
  title: string | null
  description: string | null
  coverPath: string | null
} | null> {
  const row = await drizzle(database)
    .select({
      id: deployments.id,
      deckId: decks.id,
      ownerUserId: decks.owner_user_id,
      title: deployments.title,
      description: deployments.description,
      coverPath: deployments.cover_path,
    })
    .from(accounts)
    .innerJoin(
      decks,
      and(
        eq(decks.owner_user_id, accounts.user_id),
        eq(decks.slug, slug),
        notHidden,
      ),
    )
    .innerJoin(
      deployments,
      and(
        eq(deployments.id, decks.public_deployment_id),
        eq(deployments.deck_id, decks.id),
        eq(deployments.state, 'ready'),
      ),
    )
    .where(eq(accounts.handle, handle))
    .get()
  if (!row) return null
  return { ...row, deckId: deckIdSchema.parse(row.deckId) }
}

/** The handle of an owner, or null before their first sign-in records it. */
export async function readHandle(
  database: D1Database,
  userId: string,
): Promise<Handle | null> {
  const row = await drizzle(database)
    .select({ handle: accounts.handle })
    .from(accounts)
    .where(eq(accounts.user_id, userId))
    .get()
  return (row?.handle as Handle | undefined) ?? null
}

/** The user an author's handle names, or null when nobody holds it. */
export async function readHandleOwner(
  database: D1Database,
  handle: Handle,
): Promise<string | null> {
  const row = await drizzle(database)
    .select({ userId: accounts.user_id })
    .from(accounts)
    .where(eq(accounts.handle, handle))
    .get()
  return row?.userId ?? null
}

/** Releases still identify an author whose profile is now hidden. */
export async function findAuthor(database: D1Database, input: unknown) {
  const handle = handleSchema.safeParse(input)
  if (!handle.success) return null
  const userId = await readHandleOwner(database, handle.data)
  return userId === null ? null : { handle: handle.data, userId }
}

/** Readers see the same result for a suspended and an unknown author. */
export async function findVisibleAuthor(database: D1Database, input: unknown) {
  const author = await findAuthor(database, input)
  if (!author || (await readSuspension(database, author.userId))) return null
  return author
}

const publicDeckRow = z.object({
  handle: handleSchema,
  slug: deckSlugSchema,
  title: z.string().nullable(),
  readyAt: z.number().int(),
  /** The deployment readers see. */
  deploymentId: z.string(),
  /** The image file the deck names as its cover, from the deck's root. */
  coverPath: z.string().nullable(),
  ...authorFaceColumns.shape,
})
export type PublicDeck = Readonly<
  Omit<z.infer<typeof publicDeckRow>, keyof AuthorFaceColumns> & {
    /** Where the author's picture is served from. */
    authorAvatarUrl: string
  }
>

/** A row of a list, with the author's face made into the address a card uses. */
const toPublicDeck = ({
  authorUserId,
  uploadedAt,
  useGravatar,
  gravatarAt,
  ...deck
}: z.infer<typeof publicDeckRow>): PublicDeck => ({
  ...deck,
  authorAvatarUrl: authorAvatarUrl({
    authorUserId,
    uploadedAt,
    useGravatar,
    gravatarAt,
  }),
})

/**
 * The decks sorted after `after`: published before it, or in the same
 * second and after it by handle, then by slug.
 */
const sortedAfter = (after: DeckAfter) => sql`(
  ${deployments.ready_at} < ${after.at}
  OR (${deployments.ready_at} = ${after.at} AND (
    ${accounts.handle} > ${after.handle}
    OR (${accounts.handle} = ${after.handle} AND ${decks.slug} > ${after.slug})
  ))
)`

/**
 * Public decks, newest first. The recent list supplies a viewer to apply
 * their mutes. A profile supplies only the author's handle. `followedBy`
 * narrows the list to the decks of the people that person follows, under
 * the same rules as the recent list.
 */
export async function listPublicDecks(
  database: D1Database,
  {
    handle,
    limit,
    viewer = null,
    followedBy,
    after,
  }: {
    handle?: Handle
    limit: number
    viewer?: string | null
    followedBy?: string
    /** Read only the decks sorted after this one (F03-AC163). */
    after?: DeckAfter | null
  },
): Promise<PublicDeck[]> {
  const rows = await drizzle(database)
    .select({
      handle: accounts.handle,
      slug: decks.slug,
      title: deployments.title,
      readyAt: deployments.ready_at,
      deploymentId: deployments.id,
      coverPath: deployments.cover_path,
      ...authorFaceFields,
    })
    .from(accounts)
    .leftJoin(profiles, eq(profiles.user_id, accounts.user_id))
    .leftJoin(profilePictures, eq(profilePictures.user_id, accounts.user_id))
    .innerJoin(decks, and(eq(decks.owner_user_id, accounts.user_id), notHidden))
    .innerJoin(
      deployments,
      and(
        eq(deployments.id, decks.public_deployment_id),
        eq(deployments.deck_id, decks.id),
        eq(deployments.state, 'ready'),
      ),
    )
    .where(
      and(
        handle === undefined ? undefined : eq(accounts.handle, handle),
        notMutedBy(viewer),
        notBlockedBy(viewer),
        followedBy === undefined
          ? undefined
          : sql`EXISTS (SELECT 1 FROM ${follows}
              WHERE ${follows.follower_user_id} = ${followedBy}
                AND ${follows.followee_user_id} = ${decks.owner_user_id})`,
        after ? sortedAfter(after) : undefined,
      ),
    )
    // Decks published in the same second keep one order across pages.
    .orderBy(desc(deployments.ready_at), accounts.handle, decks.slug)
    .limit(limit)
  return publicDeckRow.array().parse(rows).map(toPublicDeck)
}

/**
 * How many public decks an author has: every deck a profile could list,
 * past the number it shows.
 */
export async function countPublicDecks(
  database: D1Database,
  handle: Handle,
): Promise<number> {
  const row = await drizzle(database)
    .select({ count: sql<number>`count(*)` })
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
    .where(eq(accounts.handle, handle))
    .get()
  return row?.count ?? 0
}

/** Whether the deployment is the one a share URL shows now. */
export async function isPublicDeployment(
  database: D1Database,
  deploymentId: string,
): Promise<boolean> {
  const row = await drizzle(database)
    .select({ id: deployments.id })
    .from(decks)
    .innerJoin(
      deployments,
      and(
        eq(deployments.id, decks.public_deployment_id),
        eq(deployments.deck_id, decks.id),
        eq(deployments.state, 'ready'),
      ),
    )
    // The join already ties the deployment to the deck's public pointer.
    .where(and(eq(deployments.id, deploymentId), notHidden))
    .get()
  return row !== undefined
}
