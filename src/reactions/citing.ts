import type { DeckLink } from './store'

/** A public deck that links to another, and the deployment holding the link. */
export type CitingDeck = Readonly<{
  handle: string
  slug: string
  title: string | null
  deploymentId: string
}>

/**
 * The decks behind a list of links, each once however many pages it links
 * to, the most recently published first.
 */
export function citingDecks(citedBy: readonly DeckLink[]): CitingDeck[] {
  const decks = new Map<string, DeckLink>()
  for (const link of citedBy) {
    const key = `${link.handle}/${link.slug}`
    if (!decks.has(key)) decks.set(key, link)
  }
  return [...decks.values()]
    .sort((a, b) => b.at - a.at)
    .map(({ handle, slug, title, deploymentId }) => ({
      handle,
      slug,
      title,
      deploymentId,
    }))
}

/** How many decks each side of a citation shows as running frames. */
export const DECKS_SHOWN = 4

/** The first few of a list, and how many more there are. */
export type Shortened<T> = Readonly<{ shown: readonly T[]; more: number }>

/**
 * Keeps the first `limit` items. Every shown deck is a running frame, so a
 * much-cited deck shows only its latest few and counts the rest.
 */
export function shorten<T>(
  items: readonly T[],
  limit = DECKS_SHOWN,
): Shortened<T> {
  const shown = items.slice(0, Math.max(0, limit))
  return { shown, more: items.length - shown.length }
}
