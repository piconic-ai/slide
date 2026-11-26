import { z } from 'zod'
import { deckSlugSchema } from '../decks/deck-id'
import { handleSchema } from '../share/handle'
import {
  HOME_MORE_STEP,
  type CommunityAfter,
  type DeckAfter,
} from './home-more'

/**
 * The most cards a list of the top page may ask for at once: a press of
 * "show more" asks for its step and one more (src/site/home-more.ts).
 */
export const HOME_MORE_LIMIT = HOME_MORE_STEP + 1

/** A query's values as Hono reads them: one string or none per name. */
export type QueryValues = Readonly<Record<string, string | undefined>>

const limitSchema = z.coerce.number().int().min(1).max(HOME_MORE_LIMIT)
const atSchema = z.coerce.number().int().nonnegative()

/** One page of a list: how many to read, and after which card. */
export type ListPage<After> = Readonly<{
  limit: number
  after: After | null
}>

/**
 * The limit the query names, or the list's own when it names none. Null
 * for a limit that is not a whole number from 1 to HOME_MORE_LIMIT.
 */
const limitOf = (raw: string | undefined, fallback: number): number | null => {
  if (raw === undefined) return fallback
  const parsed = limitSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/**
 * Reads a page from the query: every key of `after` or none of them. Null
 * when the query is malformed, which the route answers with 400.
 */
const pageOf = <After>(
  query: QueryValues,
  names: readonly string[],
  schema: z.ZodType<After>,
  fallback: number,
): ListPage<After> | null => {
  const limit = limitOf(query.limit, fallback)
  if (limit === null) return null
  const given = names.filter((name) => query[name] !== undefined)
  if (given.length === 0) return { limit, after: null }
  if (given.length !== names.length) return null
  const parsed = schema.safeParse(
    Object.fromEntries(names.map((name) => [name, query[name]])),
  )
  return parsed.success ? { limit, after: parsed.data } : null
}

const deckAfterSchema: z.ZodType<DeckAfter> = z.object({
  at: atSchema,
  handle: handleSchema,
  slug: deckSlugSchema,
})

const communityAfterSchema: z.ZodType<CommunityAfter> = z.object({
  at: atSchema,
  id: z.coerce.number().int().positive(),
})

/** A page of a list of slides: `?at=&handle=&slug=&limit=`. */
export const parseDeckPage = (
  query: QueryValues,
  fallback: number,
): ListPage<DeckAfter> | null =>
  pageOf(query, ['at', 'handle', 'slug'], deckAfterSchema, fallback)

/** A page of the list of communities: `?at=&id=&limit=`. */
export const parseCommunityPage = (
  query: QueryValues,
  fallback: number,
): ListPage<CommunityAfter> | null =>
  pageOf(query, ['at', 'id'], communityAfterSchema, fallback)
