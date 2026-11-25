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
