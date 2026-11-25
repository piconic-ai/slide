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
 * in one article (the author's choice in issue 454).
 */
export const MAX_OTHER_DECKS = 40

/**
 * The pages an article shows as images, if their slides allow: every page of
 * its own slides, and the pages of the first `MAX_OTHER_DECKS` other slides
 * in the order they are first written. The rest stay plain links. Every slides
 * written counts, those that turn out not to be public, or not to exist, as
 * well. `nameOf` gives the name slides go by now (a handle an operator
 * changed names its new holder), so the own slides written under an old
 * handle are still the own, and other slides count once under both names.
 */
export function pagesWithinLimit(
  pages: readonly PageRef[],
  own: DeckName,
  nameOf: (ref: PageRef) => DeckName = (ref) => ref,
): PageRef[] {
  const keyOf = (ref: PageRef) => deckKey(nameOf(ref))
  const isOwn = (ref: PageRef) => keyOf(ref) === deckKey(own)
  const counted = new Set(
    decksOf(
      pages
        .filter((ref) => !isOwn(ref))
        .map((ref) => ({ ...nameOf(ref), page: ref.page })),
    )
      .slice(0, MAX_OTHER_DECKS)
      .map(deckKey),
  )
  return pages.filter((ref) => isOwn(ref) || counted.has(keyOf(ref)))
}
