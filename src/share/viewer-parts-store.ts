import { readViewerCitations } from '../citations/store'
import { linkPagePath } from '../links/link-address'
import { listShownLinks } from '../links/link-page-store'
import { listLinks, type StoredLink } from '../links/store'
import { readProfile } from '../profile/store'
import type { DeckSlug } from '../decks/deck-id'
import { listDeckEvents } from '../events/store'
import { readViewerTalks } from './viewer-talks-store'

/**
 * A related link as the viewer shows it: with the path of its page of links
 * while that page shows (F45-AC18).
 */
export type ViewerLink = StoredLink & Readonly<{ pagePath?: string }>

/**
 * What the viewer shows around the slides besides the article: their author,
 * the slides on both sides of a citation, the related links (each with its
 * page of links, when that shows), the events
 * the slides were presented at, and the other talks of the first of them and
 * of its community. The viewer of readers and the author's
 * preview of an article read them the same way, so they look the same.
 */
export async function readViewerParts(
  database: D1Database,
  deck: Readonly<{
    deckId: string
    deploymentId: string
    handle: string
    slug: DeckSlug
    ownerUserId: string
  }>,
  viewer: string | null,
) {
  const eventsAndTalks = listDeckEvents(database, deck.deckId).then(
    async (events) => ({
      events,
      talks: await readViewerTalks(database, {
        deckId: deck.deckId,
        events,
        viewer,
      }),
    }),
  )
  const [author, citations, stored, shown, { events, talks }] =
    await Promise.all([
      readProfile(database, deck.ownerUserId),
      readViewerCitations(database, deck, viewer),
      listLinks(database, deck.deckId),
      listShownLinks(database, deck.deckId),
      eventsAndTalks,
    ])
  const pages = new Set(shown.map((link) => link.linkId))
  const links: readonly ViewerLink[] = stored.map((link) =>
    pages.has(link.id) ? { ...link, pagePath: linkPagePath(link.href) } : link,
  )
  return { author, citations, links, events, talks }
}
