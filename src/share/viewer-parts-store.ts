import { readViewerCitations } from '../citations/store'
import { listShownLinks } from '../links/link-page-store'
import { listLinks, type StoredLink } from '../links/store'
import { readProfile } from '../profile/store'
import type { DeckSlug } from '../decks/deck-id'
import { listDeckEvents } from '../events/store'
import { readViewerTalks } from './viewer-talks-store'

/**
 * A related link as the viewer shows it: with the path of the page of links
 * its slide is listed on, while that page shows (F45-AC18).
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
  // Which links have a page is asked only of a slide that has links, so a
  // slide with none costs the query nothing (src/cost/per-use.test.ts).
  const linksAndPages = listLinks(database, deck.deckId).then(
    async (stored) => ({
      stored,
      shown:
        stored.length > 0 ? await listShownLinks(database, deck.deckId) : [],
    }),
  )
  const [author, citations, { stored, shown }, { events, talks }] =
    await Promise.all([
      readProfile(database, deck.ownerUserId),
      readViewerCitations(database, deck, viewer),
      linksAndPages,
      eventsAndTalks,
    ])
  const paths = new Map(shown.map((link) => [link.linkId, link.path]))
  const links: readonly ViewerLink[] = stored.map((link) => {
    const pagePath = paths.get(link.id)
    return pagePath ? { ...link, pagePath } : link
  })
  return { author, citations, links, events, talks }
}
