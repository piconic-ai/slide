import {
  and,
  countDistinct,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  sql,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import { accounts, citations, decks, deployments, profiles } from '../db/schema'
import { deckSlugSchema } from '../decks/deck-id'
import { notMutedByOf } from '../mutes/store'
import { notHiddenOf } from '../publication/takedown-store'
import { handleSchema } from '../share/handle'

/**
 * Which side of the pairs a profile lists: `cited` are the pairs whose cited
 * deck is the author's, `citing` those whose citing deck is.
 */
export type PairSide = 'citing' | 'cited'

/** How many rows one page of a profile's citation list shows. */
export const PAIRS_PER_PAGE = 50

const rowSchema = z.object({
  /** The deck on the other side: the one that is not the author's. */
  handle: handleSchema,
  slug: deckSlugSchema,
  title: z.string().nullable(),
  authorName: z.string().nullable(),
  deploymentId: z.string(),
  coverPath: z.string().nullable(),
  /** The title of the author's own deck of the pair. */
  ownTitle: z.string().nullable(),
  /** The day the pair began, in seconds. */
  at: z.number().int(),
})
/** One pair of a profile's list, seen from the author's side. */
export type PairRow = Readonly<z.infer<typeof rowSchema>>

/**
 * The citation pairs (citing deck -> cited deck) a reader may see, each once
 * however many places the citing deck links the cited one. This is the one
 * place that decides which pairs count, for the lists, the profile's numbers
 * and the cards' numbers alike (F24-AC25 to F24-AC28):
 *
 * - the citing deck counts through its public version only; both decks are
 *   public, not deleted, not hidden and not owned by a suspended author;
 * - decks of one author never pair;
 * - the owner of the deck on the far side from the profile is not someone
 *   the viewer muted.
 *
 * The day of a pair is the day the citing deck's public version became
 * ready. A published article's links join as a second source of the same
 * pairs; the pair is then the earliest of its days.
 */
function pairs(database: D1Database, viewer: string | null, side: PairSide) {
  const citing = alias(decks, 'citing_deck')
  const citingVersion = alias(deployments, 'citing_version')
  const citingAuthor = alias(accounts, 'citing_author')
  const cited = alias(decks, 'cited_deck')
  const citedVersion = alias(deployments, 'cited_version')
  const citedAuthor = alias(accounts, 'cited_author')
  const far = side === 'cited' ? citing : cited
  const farAuthor = side === 'cited' ? citingAuthor : citedAuthor
  const farVersion = side === 'cited' ? citingVersion : citedVersion
  const near = side === 'cited' ? cited : citing
  const nearVersion = side === 'cited' ? citedVersion : citingVersion
  const db = drizzle(database)
  const base = db
    .select({
      handle: farAuthor.handle,
      slug: far.slug,
      title: farVersion.title,
      authorName: profiles.name,
      deploymentId: farVersion.id,
      coverPath: farVersion.cover_path,
      ownTitle: nearVersion.title,
      at: citingVersion.ready_at,
      citedHandle: citedAuthor.handle,
      citedSlug: cited.slug,
      // Aggregates: for one pair they are 1, over a group they count.
      pairs: countDistinct(sql`${citing.id} || '/' || ${cited.id}`),
      citingDecks: countDistinct(citing.id),
    })
    .from(citations)
    .innerJoin(citing, eq(citing.public_deployment_id, citations.deployment_id))
    .innerJoin(
      citingVersion,
      and(
        eq(citingVersion.id, citations.deployment_id),
        eq(citingVersion.deck_id, citing.id),
        eq(citingVersion.state, 'ready'),
      ),
    )
    .innerJoin(citingAuthor, eq(citingAuthor.user_id, citing.owner_user_id))
    .innerJoin(citedAuthor, eq(citedAuthor.handle, citations.target_handle))
    .innerJoin(
      cited,
      and(
        eq(cited.owner_user_id, citedAuthor.user_id),
        eq(cited.slug, citations.target_slug),
      ),
    )
    .innerJoin(
      citedVersion,
      and(
        eq(citedVersion.id, cited.public_deployment_id),
        eq(citedVersion.deck_id, cited.id),
        eq(citedVersion.state, 'ready'),
      ),
    )
    .leftJoin(profiles, eq(profiles.user_id, farAuthor.user_id))
  const visible = and(
    isNull(citing.deleted_at),
    isNull(cited.deleted_at),
    ne(citing.owner_user_id, cited.owner_user_id),
    notHiddenOf(citing),
    notHiddenOf(cited),
    notMutedByOf(far, viewer),
  )
  return {
    base,
    visible,
    far,
    farAuthor,
    farVersion,
    near,
    nearVersion,
    citing,
    cited,
    citedAuthor,
    citingVersion,
  }
}

type PairQuery = Readonly<{
  side: PairSide
  /** The profile author, whose side of the pairs is listed. */
  author: string
  /** The signed-in reader, whose mutes shape what they see. */
  viewer: string | null
}>

/** One page of a profile's list of pairs, the newest pair first. */
export async function listPairs(
  database: D1Database,
  query: PairQuery & Readonly<{ limit: number; offset: number }>,
): Promise<PairRow[]> {
  const p = pairs(database, query.viewer, query.side)
  const rows = await p.base
    .where(and(p.visible, eq(p.near.owner_user_id, query.author)))
    .groupBy(p.citing.id, p.cited.id)
    .orderBy(desc(p.citingVersion.ready_at), p.citing.id, p.cited.id)
    .limit(query.limit)
    .offset(query.offset)
  return rowSchema.array().parse(rows)
}

/** How many pairs the profile's list shows to this reader, over all pages. */
export async function countPairs(
  database: D1Database,
  query: PairQuery,
): Promise<number> {
  const p = pairs(database, query.viewer, query.side)
  const row = await p.base
    .where(and(p.visible, eq(p.near.owner_user_id, query.author)))
    .get()
  return row?.pairs ?? 0
}

const countedSchema = z.object({
  citedHandle: z.string(),
  citedSlug: z.string(),
  citingDecks: z.number().int(),
})

/**
 * How many decks cite each public deck of the given authors, as this reader
 * may see them, by `handle/slug`. A deck nobody cites has no entry. It counts
 * the same pairs a profile counts, so a card's number and a list agree.
 */
export async function readCitedCounts(
  database: D1Database,
  handles: readonly string[],
  viewer: string | null,
): Promise<ReadonlyMap<string, number>> {
  if (handles.length === 0) return new Map()
  const p = pairs(database, viewer, 'cited')
  const rows = await p.base
    .where(and(p.visible, inArray(p.citedAuthor.handle, [...handles])))
    .groupBy(p.citedAuthor.handle, p.cited.slug)
  return new Map(
    countedSchema
      .array()
      .parse(rows)
      .map((row) => [`${row.citedHandle}/${row.citedSlug}`, row.citingDecks]),
  )
}
