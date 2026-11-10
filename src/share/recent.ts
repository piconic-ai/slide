import { dateFormat, deckName } from './list-pages'
import { profilePath, sharePath } from './path'
import type { PublicDeck } from './store'

/** A recent deck as the top page shows it, ready to render as is. */
export type RecentDeck = Readonly<{
  name: string
  href: string
  handle: string
  authorHref: string
  publishedAt: string
  publishedOn: string
}>

/** The fields the top page needs, with links and the date already made. */
export const toRecentDeck = (deck: PublicDeck): RecentDeck => ({
  name: deckName(deck),
  href: sharePath(deck.handle, deck.slug),
  handle: deck.handle,
  authorHref: profilePath(deck.handle),
  publishedAt: new Date(deck.readyAt * 1000).toISOString(),
  publishedOn: dateFormat.format(deck.readyAt * 1000),
})
