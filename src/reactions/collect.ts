import type { FoundPost } from './bluesky'
import { citationOfHref } from './citation'
import { didSchema, postedAtOf, type Post } from './post'

/** A found post to show under a deck; page 0 is the whole deck. */
export type Collected = Readonly<{
  post: Post & { service: 'bluesky' }
  page: number
  postedAt: number | null
}>

const AT_URI =
  /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([A-Za-z0-9._~-]{1,64})$/

/** What a deck's owner searches for when they name nothing else. */
export const defaultQuery = (shareUrl: string) => {
  const url = new URL(shareUrl)
  return `${url.host}${url.pathname}`
}

const linksOf = (post: FoundPost) => [
  ...(post.record?.facets ?? []).flatMap((facet) =>
    facet.features.flatMap((feature) => (feature.uri ? [feature.uri] : [])),
  ),
  ...(post.record?.embed?.external?.uri
    ? [post.record.embed.external.uri]
    : []),
]

const secondsOf = (time: string | undefined) => {
  const milliseconds = time === undefined ? NaN : Date.parse(time)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : null
}

/**
 * The page of the deck a found post links to: the first link to one of its
 * pages, else 0 for the whole deck. A search can match posts that never link
 * to the deck, such as a hashtag's, and those count for the whole deck too.
 */
function pageOf(
  post: FoundPost,
  deck: Readonly<{ handle: string; slug: string }>,
  publicOrigin: string,
) {
  for (const link of linksOf(post)) {
    const citation = citationOfHref(link, publicOrigin)
    if (
      citation &&
      citation.page > 0 &&
      citation.handle === deck.handle &&
      citation.slug === deck.slug
    )
      return citation.page
  }
  return 0
}

/**
 * Turns found posts into reactions to a deck, in the order found and without
 * repeats. A post whose address is not a post record of a known account is
 * left out.
 */
export function collectedFrom(
  found: readonly FoundPost[],
  deck: Readonly<{ handle: string; slug: string }>,
  publicOrigin: string,
): Collected[] {
  const seen = new Set<string>()
  return found.flatMap((item) => {
    const match = AT_URI.exec(item.uri)
    const [did, rkey] = [match?.[1], match?.[2]]
    if (!did || !rkey || !didSchema.safeParse(did).success) return []
    if (seen.has(item.uri)) return []
    seen.add(item.uri)
    const post = { service: 'bluesky', did, rkey } as const
    return [
      {
        post,
        page: pageOf(item, deck, publicOrigin),
        postedAt: secondsOf(item.record?.createdAt) ?? postedAtOf(post),
      },
    ]
  })
}
