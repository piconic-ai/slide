import { coverUrl } from './cover'
import { deckName } from './list-pages'
import { profilePath, sharePath } from './path'
import type { PublicDeck } from './store'

/** A recent deck as the top page shows it, ready to render as is. */
export type RecentDeck = Readonly<{
  name: string
  href: string
  handle: string
  /** With the handle and the time, the keys the list is sorted on. */
  slug: string
  authorHref: string
  /** The author's picture, or null before the page knows it; the card then shows the initial. */
  authorAvatarUrl: string | null
  /** ISO 8601; the page writes the day in its own language. */
  publishedAt: string
  /** The cover image; without one the card shows the name alone. */
  coverUrl: string | null
  /** How many decks cite it, as the reader may see them; 0 shows nothing. */
  citedBy: number
}>

/**
 * The fields the top page needs, with links already made. Without a content
 * origin there is nothing to load, and the cover shows the name alone.
 */
export const toRecentDeck = (
  deck: PublicDeck,
  contentBase: URL | null,
  citedBy = 0,
  authorAvatarUrl: string | null = null,
): RecentDeck => ({
  name: deckName(deck),
  href: sharePath(deck.handle, deck.slug),
  handle: deck.handle,
  slug: deck.slug,
  authorHref: profilePath(deck.handle),
  authorAvatarUrl,
  publishedAt: new Date(deck.readyAt * 1000).toISOString(),
  coverUrl: contentBase
    ? coverUrl(contentBase, deck.deploymentId, deck.coverPath)
    : null,
  citedBy,
})
