import type { PageRef } from './markdown'

/** Slides an article's pages belong to, by the share name of the slides. */
export type DeckName = Readonly<{ handle: string; slug: string }>

/** The key slides are looked up by. */
export const deckKey = (deck: DeckName) => `${deck.handle}/${deck.slug}`

/** The slides the pages belong to, each once, in the order first written. */
export function decksOf(pages: readonly PageRef[]): DeckName[] {
  const found = new Map<string, DeckName>()
  for (const { handle, slug } of pages)
    if (!found.has(deckKey({ handle, slug })))
      found.set(deckKey({ handle, slug }), { handle, slug })
  return [...found.values()]
}

/**
 * How many slides other than the article's own may show their pages as images
 * in one article. They are looked up by one D1 query, which takes at most 100
 * bound values, and each deck takes two.
 */
export const MAX_OTHER_DECKS = 40

/**
 * The pages an article looks up to show as images: every page of its own
 * slides, which need no query, and the pages of the first `MAX_OTHER_DECKS`
 * other slides in the order they are first written. The rest stay plain
 * links. Slides are counted before they are looked up, so slides that turn
 * out not to be public, or not to exist, count as well.
 */
export function pagesWithinLimit(
  pages: readonly PageRef[],
  own: DeckName,
): PageRef[] {
  const isOwn = (ref: PageRef) => deckKey(ref) === deckKey(own)
  const counted = new Set(
    decksOf(pages.filter((ref) => !isOwn(ref)))
      .slice(0, MAX_OTHER_DECKS)
      .map(deckKey),
  )
  return pages.filter((ref) => isOwn(ref) || counted.has(deckKey(ref)))
}
