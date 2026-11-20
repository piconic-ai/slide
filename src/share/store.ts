import { and, desc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import {
  deckIdSchema,
  deckSlugSchema,
  type DeckId,
  type DeckSlug,
} from '../decks/binding'
import {
  accounts,
  decks,
  deployments,
  follows,
  pageScriptDeployments,
} from '../db/schema'
import { notMutedBy } from '../mutes/store'
import { handleSchema, type Handle } from './handle'
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
  /** Whether the deck pages by number, so its pages can be taken as images. */
  loadsPageScript: boolean
} | null> {
  const row = await drizzle(database)
    .select({
      id: deployments.id,
      deckId: decks.id,
      ownerUserId: decks.owner_user_id,
      title: deployments.title,
      description: deployments.description,
      coverPath: deployments.cover_path,
      pageScript: pageScriptDeployments.deployment_id,
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
    .leftJoin(
      pageScriptDeployments,
      eq(pageScriptDeployments.deployment_id, deployments.id),
    )
    .where(eq(accounts.handle, handle))
    .get()
  if (!row) return null
  const { pageScript, ...shared } = row
  return {
    ...shared,
    deckId: deckIdSchema.parse(row.deckId),
    loadsPageScript: pageScript !== null,
  }
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

const publicDeckSchema = z.object({
  handle: handleSchema,
  slug: deckSlugSchema,
  title: z.string().nullable(),
  readyAt: z.number().int(),
  /** The deployment readers see. */
  deploymentId: z.string(),
  /** The image file the deck names as its cover, from the deck's root. */
  coverPath: z.string().nullable(),
})
export type PublicDeck = Readonly<z.infer<typeof publicDeckSchema>>

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
  }: {
    handle?: Handle
    limit: number
    viewer?: string | null
    followedBy?: string
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
    .where(
      and(
        handle === undefined ? undefined : eq(accounts.handle, handle),
        notMutedBy(viewer),
        followedBy === undefined
          ? undefined
          : sql`EXISTS (SELECT 1 FROM ${follows}
              WHERE ${follows.follower_user_id} = ${followedBy}
                AND ${follows.followee_user_id} = ${decks.owner_user_id})`,
      ),
    )
    .orderBy(desc(deployments.ready_at), decks.slug)
    .limit(limit)
  return publicDeckSchema.array().parse(rows)
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
