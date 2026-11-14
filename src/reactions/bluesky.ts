import { z } from 'zod'
import { didSchema } from './post'

/** Resolves handles without sign-in. */
const IDENTITY_API = 'https://public.api.bsky.app'
/** Searches posts without sign-in; the public host refuses search. */
const SEARCH_API = 'https://api.bsky.app'

/** How many posts one search reads. */
export const SEARCH_LIMIT = 50

/** How long Bluesky may take to answer before the owner's request gives up. */
const TIMEOUT_MS = 5000

const resolvedSchema = z.object({ did: didSchema })

/**
 * The fields of a found post that collection reads. Anything else Bluesky
 * sends is dropped, and a post without them is skipped by its caller.
 */
const foundPostSchema = z.object({
  uri: z.string(),
  record: z
    .object({
      createdAt: z.string().optional(),
      facets: z
        .array(
          z.object({
            features: z.array(z.object({ uri: z.string().optional() })),
          }),
        )
        .optional(),
      embed: z
        .object({
          external: z.object({ uri: z.string().optional() }).optional(),
        })
        .optional(),
    })
    .optional(),
})
export type FoundPost = z.infer<typeof foundPostSchema>

const searchSchema = z.object({ posts: z.array(z.unknown()) })

/** The DID a Bluesky handle names now, or null when nobody holds it. */
export async function resolveHandle(handle: string): Promise<string | null> {
  const response = await fetch(
    `${IDENTITY_API}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  )
  if (!response.ok) return null
  const parsed = resolvedSchema.safeParse(await response.json())
  return parsed.success ? parsed.data.did : null
}

/**
 * The latest posts matching a search, newest first. Posts of an unexpected
 * shape are left out. Throws when Bluesky does not answer the search in time.
 */
export async function searchPosts(query: string): Promise<FoundPost[]> {
  const response = await fetch(
    `${SEARCH_API}/xrpc/app.bsky.feed.searchPosts?sort=latest&limit=${SEARCH_LIMIT}&q=${encodeURIComponent(query)}`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  )
  if (!response.ok) throw new Error(`Bluesky search failed: ${response.status}`)
  return searchSchema.parse(await response.json()).posts.flatMap((post) => {
    const parsed = foundPostSchema.safeParse(post)
    return parsed.success ? [parsed.data] : []
  })
}
